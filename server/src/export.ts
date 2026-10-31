/**
 * « Exporter tout » (RGPD, droit d'accès et portabilité) : everything the household holds in Lucien, in one .zip —
 * one JSON file per kind of data, the original papers and portraits, and a short "lisez-moi".
 * Secrets that would open an account or a connection (session and login tokens, connector token, bank and push keys)
 * are left out: they are not the user's data, and a lost export must not become a way in.
 */
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Db } from "./db.js";
import { zip, type FichierZip } from "./zip.js";

/** Technical tables with nothing personal, or holding only access secrets. */
const TABLES_EXCLUES = new Set(["sessions", "auth_links", "rappels_envoyes", "ia_depense", "waitlist", "cabinets"]);
/** Columns never exported, whatever the table. */
const COLONNE_SECRETE = /(^|_)(token|jeton|secret|password|p256dh|auth|access|refresh|cle_api|api_key|curseur|user_uuid|external_user_id)($|_)/i;

const colonnes = (db: Db, table: string) => (db.raw.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[]).map((c) => c.name);

function lignes(db: Db, table: string, where: string, args: unknown[]): Record<string, unknown>[] {
  const cols = colonnes(db, table).filter((c) => !COLONNE_SECRETE.test(c));
  if (!cols.length) return [];
  return db.raw.prepare(`SELECT ${cols.map((c) => `"${c}"`).join(", ")} FROM ${table} WHERE ${where}`).all(...(args as never[])) as Record<string, unknown>[];
}

export function donneesFoyer(db: Db, householdId: string): Record<string, Record<string, unknown>[]> {
  const tables = (db.raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as unknown as { name: string }[]).map((t) => t.name);
  const out: Record<string, Record<string, unknown>[]> = {};
  for (const t of tables) {
    if (TABLES_EXCLUES.has(t)) continue;
    const cols = colonnes(db, t);
    if (t === "households") out[t] = lignes(db, t, "id = ?", [householdId]);
    else if (t === "users") out[t] = lignes(db, t, "id IN (SELECT user_id FROM household_users WHERE household_id = ?)", [householdId]);
    else if (cols.includes("household_id")) out[t] = lignes(db, t, "household_id = ?", [householdId]);
    else if (cols.includes("veille_id")) out[t] = lignes(db, t, "veille_id IN (SELECT id FROM veilles WHERE household_id = ?)", [householdId]);
  }
  // module data is stored as JSON text: give it back as JSON
  for (const r of out.module_data ?? []) if (typeof r.donnees === "string") { try { r.donnees = JSON.parse(r.donnees); } catch { /* left as text */ } }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.length));
}

const propre = (s: string, n: number) => s.replace(/[^\p{L}\p{N} ._'-]+/gu, " ").replace(/\s+/g, " ").trim().slice(0, n) || "sans titre";

export async function exporterFoyer(db: Db, householdId: string, uploadDir: string, maintenant = new Date()): Promise<Buffer> {
  const donnees = donneesFoyer(db, householdId);
  const fichiers: FichierZip[] = [];
  const manquants: string[] = [];
  let n = 1;
  for (const d of (donnees.documents ?? []) as { id: string; title?: string; fichier?: string | null }[]) {
    if (!d.fichier) continue;
    const buf = await readFile(join(uploadDir, basename(d.fichier))).catch(() => null);
    if (!buf) { manquants.push(d.title ?? d.id); continue; }
    fichiers.push({ nom: `papiers/${String(n++).padStart(3, "0")} - ${propre(d.title ?? "", 70)}${extname(d.fichier)}`, contenu: buf });
  }
  for (const m of (donnees.members ?? []) as { prenom?: string; photo?: string | null }[]) {
    if (!m.photo) continue;
    const buf = await readFile(join(uploadDir, basename(m.photo))).catch(() => null);
    if (buf) fichiers.push({ nom: `photos/${propre(m.prenom ?? "membre", 40)}${extname(m.photo) || ".jpg"}`, contenu: buf });
  }
  for (const [table, rows] of Object.entries(donnees)) fichiers.push({ nom: `donnees/${table}.json`, contenu: Buffer.from(JSON.stringify(rows, null, 2), "utf8") });
  const resume = Object.entries(donnees).map(([t, r]) => `- ${t} : ${r.length}`).join("\n");
  fichiers.unshift({ nom: "LISEZ-MOI.txt", contenu: Buffer.from(
    `Export Lucien du ${maintenant.toLocaleDateString("fr-FR")}\n\n` +
    "papiers/  les fichiers d'origine de vos papiers\nphotos/   les portraits des membres\ndonnees/  toutes vos données, un fichier JSON par sorte (lisible par un tableur ou un autre service)\n\n" +
    `Contenu :\n${resume}\n` +
    (manquants.length ? `\nFichiers introuvables sur le serveur (seules les informations lues sont exportées) :\n${manquants.map((x) => `- ${x}`).join("\n")}\n` : "") +
    "\nLes codes d'accès (sessions, connecteur, banque) ne sont pas exportés : ils ouvriraient votre compte.\n", "utf8") });
  return zip(fichiers, maintenant);
}
