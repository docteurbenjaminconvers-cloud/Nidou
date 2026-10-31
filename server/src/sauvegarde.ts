/**
 * Encrypted off-site backups.
 * archive  : a .tar of the SQLite snapshot (VACUUM INTO, consistent while the app runs) and the uploaded files, gzipped;
 * chiffrement : AES-256-GCM, key derived with scrypt from LUCIEN_SAUVEGARDE_CLE (a long passphrase kept OUTSIDE the
 *               server: without it a backup cannot be read, by anyone — including us);
 * envoi    : S3-compatible object storage (OVH, Scaleway, AWS…) with a SigV4-signed PUT, no extra dependency.
 * Retention off-site is set on the bucket itself (lifecycle rule), so a compromised server cannot erase old copies.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

// ---------- tar (ustar, files only) ----------
export interface EntreeTar { nom: string; contenu: Buffer }

function entete(nom: string, taille: number): Buffer {
  const h = Buffer.alloc(512);
  const n = Buffer.from(nom, "utf8");
  if (n.length > 100) { // long names: ustar prefix (155) + name (100)
    const coupe = nom.lastIndexOf("/", 155);
    if (coupe <= 0 || Buffer.byteLength(nom.slice(coupe + 1)) > 100) throw new Error(`Nom trop long pour l'archive : ${nom}`);
    h.write(nom.slice(coupe + 1), 0, "utf8"); h.write(nom.slice(0, coupe), 345, "utf8");
  } else n.copy(h, 0);
  h.write("0000644\0", 100); h.write("0000000\0", 108); h.write("0000000\0", 116);
  h.write(taille.toString(8).padStart(11, "0") + "\0", 124);
  h.write(Math.floor(Date.now() / 1000).toString(8).padStart(11, "0") + "\0", 136);
  h.write("        ", 148); h.write("0", 156); h.write("ustar\0", 257); h.write("00", 263);
  let somme = 0; for (const b of h) somme += b;
  h.write(somme.toString(8).padStart(6, "0") + "\0 ", 148);
  return h;
}

export function tar(entrees: EntreeTar[]): Buffer {
  const parts: Buffer[] = [];
  for (const e of entrees) {
    parts.push(entete(e.nom, e.contenu.length), e.contenu);
    const pad = (512 - (e.contenu.length % 512)) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}

export function lireTar(buf: Buffer): EntreeTar[] {
  const out: EntreeTar[] = [];
  let i = 0;
  while (i + 512 <= buf.length) {
    const h = buf.subarray(i, i + 512);
    if (h.every((b) => b === 0)) break;
    const champ = (a: number, l: number) => h.subarray(a, a + l).toString("utf8").replace(/\0.*$/s, "");
    const prefixe = champ(345, 155);
    const nom = prefixe ? `${prefixe}/${champ(0, 100)}` : champ(0, 100);
    const taille = parseInt(champ(124, 12).trim() || "0", 8);
    out.push({ nom, contenu: Buffer.from(buf.subarray(i + 512, i + 512 + taille)) });
    i += 512 + Math.ceil(taille / 512) * 512;
  }
  return out;
}

// ---------- encryption ----------
const MAGIC = Buffer.from("LUCIENBK1");

export function chiffrer(donnees: Buffer, cle: string): Buffer {
  if (cle.length < 20) throw new Error("LUCIEN_SAUVEGARDE_CLE trop courte : au moins 20 caractères");
  const sel = randomBytes(16), iv = randomBytes(12);
  const k = scryptSync(cle, sel, 32);
  const c = createCipheriv("aes-256-gcm", k, iv);
  const corps = Buffer.concat([c.update(gzipSync(donnees)), c.final()]);
  return Buffer.concat([MAGIC, sel, iv, c.getAuthTag(), corps]);
}

export function dechiffrer(fichier: Buffer, cle: string): Buffer {
  if (!fichier.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Ce fichier n'est pas une sauvegarde Lucien");
  let o = MAGIC.length;
  const sel = fichier.subarray(o, (o += 16)), iv = fichier.subarray(o, (o += 12)), tag = fichier.subarray(o, (o += 16));
  const d = createDecipheriv("aes-256-gcm", scryptSync(cle, sel, 32), iv);
  d.setAuthTag(tag);
  try { return gunzipSync(Buffer.concat([d.update(fichier.subarray(o)), d.final()])); }
  catch { throw new Error("Clé incorrecte ou sauvegarde abîmée"); }
}

// ---------- S3 (SigV4) ----------
export interface S3Config { endpoint: string; region: string; bucket: string; accessKey: string; secretKey: string }

export function s3Config(): S3Config | null {
  const e = process.env;
  if (!e.LUCIEN_S3_ENDPOINT || !e.LUCIEN_S3_BUCKET || !e.LUCIEN_S3_ACCESS_KEY || !e.LUCIEN_S3_SECRET_KEY) return null;
  return { endpoint: e.LUCIEN_S3_ENDPOINT.replace(/\/$/, ""), region: e.LUCIEN_S3_REGION ?? "gra", bucket: e.LUCIEN_S3_BUCKET, accessKey: e.LUCIEN_S3_ACCESS_KEY, secretKey: e.LUCIEN_S3_SECRET_KEY };
}

const sha256 = (d: Buffer | string) => createHash("sha256").update(d).digest("hex");
const hmac = (k: Buffer | string, d: string) => createHmac("sha256", k).update(d).digest();
const encoder = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

/** AWS Signature V4 for one request; returns the headers to send (Authorization included). */
export function signerV4(o: { method: string; host: string; chemin: string; region: string; accessKey: string; secretKey: string; hashCorps: string; date: Date; entetes?: Record<string, string> }): Record<string, string> {
  const amz = o.date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const jour = amz.slice(0, 8);
  const entetes: Record<string, string> = { host: o.host, "x-amz-content-sha256": o.hashCorps, "x-amz-date": amz, ...Object.fromEntries(Object.entries(o.entetes ?? {}).map(([k, v]) => [k.toLowerCase(), v])) };
  const noms = Object.keys(entetes).sort();
  const canonique = [o.method, o.chemin.split("/").map(encoder).join("/"), "", ...noms.map((n) => `${n}:${String(entetes[n]).trim()}`), "", noms.join(";"), o.hashCorps].join("\n");
  const portee = `${jour}/${o.region}/s3/aws4_request`;
  const aSigner = ["AWS4-HMAC-SHA256", amz, portee, sha256(canonique)].join("\n");
  const cle = hmac(hmac(hmac(hmac(`AWS4${o.secretKey}`, jour), o.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", cle).update(aSigner).digest("hex");
  return { ...entetes, authorization: `AWS4-HMAC-SHA256 Credential=${o.accessKey}/${portee}, SignedHeaders=${noms.join(";")}, Signature=${signature}` };
}

/** Uploads one object (path-style URL: endpoint/bucket/key). */
export async function envoyerS3(cfg: S3Config, cle: string, corps: Buffer, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${cle}`);
  const headers = signerV4({ method: "PUT", host: url.host, chemin: url.pathname, region: cfg.region, accessKey: cfg.accessKey, secretKey: cfg.secretKey, hashCorps: sha256(corps), date: new Date(), entetes: { "content-type": "application/octet-stream" } });
  delete headers.host;
  const r = await fetchImpl(url, { method: "PUT", headers, body: new Uint8Array(corps) });
  if (!r.ok) throw new Error(`Envoi de la sauvegarde refusé par le stockage : ${r.status} ${await r.text().catch(() => "")}`.slice(0, 400));
}

/** Downloads one object (for the restore script). */
export async function telechargerS3(cfg: S3Config, cle: string, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  const url = new URL(`${cfg.endpoint}/${cfg.bucket}/${cle}`);
  const headers = signerV4({ method: "GET", host: url.host, chemin: url.pathname, region: cfg.region, accessKey: cfg.accessKey, secretKey: cfg.secretKey, hashCorps: sha256(""), date: new Date() });
  delete headers.host;
  const r = await fetchImpl(url, { headers });
  if (!r.ok) throw new Error(`Sauvegarde introuvable sur le stockage : ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
