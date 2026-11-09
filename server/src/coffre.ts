/**
 * Coffre-fort: the files of the household (papers, photos, signed leases) are encrypted on the server's disk
 * (AES-256-GCM). A copy of the disk, a misplaced backup or a wrong file path never shows a paper in clear.
 *
 * Key: LUCIEN_CLE_COFFRE (set in the host's settings, never in the code) or, until it is set, a key generated once
 * and kept on the disk next to the database. Every encrypted file names its key (8 bytes of its hash), so files
 * written with the disk key stay readable once the server key is set. Files written before encryption existed are
 * read as they are (and can be encrypted in place by `chiffrerExistants`).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";

const MAGIC = Buffer.from("LUCIENC1");
let dossier = process.env.LUCIEN_DATA ?? join(tmpdir(), "lucien-coffre"); // set by initCoffre at start-up
type Cle = { id: Buffer; cle: Buffer; source: "serveur" | "disque" };
let cles: Cle[] | null = null;

/** Where the disk key lives (the data folder). Called once at start-up. */
export function initCoffre(dataDir: string) { dossier = dataDir; cles = null; }

const empreinte = (k: Buffer) => createHash("sha256").update(k).digest().subarray(0, 8);
function lesCles(): Cle[] {
  if (cles) return cles;
  const out: Cle[] = [];
  const env = process.env.LUCIEN_CLE_COFFRE?.trim();
  if (env && env.length >= 16) { const k = createHash("sha256").update(`lucien-coffre:${env}`).digest(); out.push({ id: empreinte(k), cle: k, source: "serveur" }); }
  const fichier = join(dossier, "cle-coffre");
  let disque: Buffer | null = null;
  try { if (existsSync(fichier)) disque = Buffer.from(readFileSync(fichier, "utf8").trim(), "base64"); } catch { disque = null; }
  if (!disque && !env) { // first start without a server key: one key, generated here, kept with the data
    disque = randomBytes(32);
    try { mkdirSync(dossier, { recursive: true }); writeFileSync(fichier, disque.toString("base64"), { mode: 0o600 }); } catch { /* read-only disk: memory only */ }
  }
  if (disque?.length === 32) out.push({ id: empreinte(disque), cle: disque, source: "disque" });
  return (cles = out);
}

/** State shown in Réglages > Sécurité (no secret in it). */
export function etatCoffre() {
  const c = lesCles();
  return { chiffrement: c.length > 0, cle: c[0]?.source ?? null };
}

export const estChiffre = (buf: Buffer) => buf.length > 44 && buf.subarray(0, 8).equals(MAGIC);

/** Encrypts a file's content; the file name is bound to it (a file cannot be swapped for another). */
export function chiffrer(nom: string, clair: Buffer | Uint8Array): Buffer {
  const k = lesCles()[0];
  if (!k) return Buffer.from(clair);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k.cle, iv);
  c.setAAD(Buffer.from(basename(nom)));
  const ct = Buffer.concat([c.update(clair), c.final()]);
  return Buffer.concat([MAGIC, k.id, iv, c.getAuthTag(), ct]);
}

export function dechiffrer(nom: string, buf: Buffer): Buffer {
  if (!estChiffre(buf)) return buf; // written before encryption existed (read as it is)
  const id = buf.subarray(8, 16), iv = buf.subarray(16, 28), tag = buf.subarray(28, 44);
  const k = lesCles().find((x) => x.id.equals(id));
  if (!k) throw new Error("Clé du coffre introuvable pour ce fichier");
  const d = createDecipheriv("aes-256-gcm", k.cle, iv);
  d.setAAD(Buffer.from(basename(nom)));
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(44)), d.final()]);
}

/** writeFile / readFile for the household's files, encrypted on the disk. */
export const ecrireFichier = (chemin: string, contenu: Buffer | Uint8Array) => writeFile(chemin, chiffrer(chemin, contenu));
export async function lireFichier(chemin: string): Promise<Buffer<ArrayBuffer>> { const b = dechiffrer(chemin, await readFile(chemin)); return Buffer.from(b) as Buffer<ArrayBuffer>; }

/** Encrypts in place the files written before encryption existed. Returns how many were encrypted. */
export async function chiffrerExistants(uploadDir: string): Promise<{ chiffres: number; deja: number }> {
  let chiffres = 0, deja = 0;
  if (!existsSync(uploadDir)) return { chiffres, deja };
  for (const nom of readdirSync(uploadDir)) {
    const p = join(uploadDir, nom);
    if (!statSync(p).isFile() || nom === "cle-coffre" || nom.endsWith(".tmp")) continue;
    const buf = await readFile(p);
    if (estChiffre(buf)) { deja++; continue; }
    const enc = chiffrer(p, buf);
    if (!dechiffrer(p, enc).equals(buf)) throw new Error(`Vérification impossible pour ${nom}`); // never replace a file we could not read back
    await writeFile(`${p}.tmp`, enc);
    await rename(`${p}.tmp`, p);
    chiffres++;
  }
  return { chiffres, deja };
}
