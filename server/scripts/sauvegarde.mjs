// Sauvegarde cohérente de la base SQLite (VACUUM INTO, sans arrêter le service) et des fichiers déposés.
// Usage : node scripts/sauvegarde.mjs [dossier]   (défaut : $NIDOU_DATA/sauvegardes). Garde les 14 dernières.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, rmSync, existsSync, cpSync } from "node:fs";
import { join } from "node:path";

const data = process.env.NIDOU_DATA ?? "/data";
const out = process.argv[2] ?? join(data, "sauvegardes");
const garder = Number(process.env.NIDOU_SAUVEGARDES_GARDER ?? 14);
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(out, stamp);
mkdirSync(dir, { recursive: true });

const db = new DatabaseSync(join(data, "nidou.sqlite"));
db.exec(`VACUUM INTO '${join(dir, "nidou.sqlite").replace(/'/g, "''")}'`);
db.close();
if (existsSync(join(data, "uploads"))) cpSync(join(data, "uploads"), join(dir, "uploads"), { recursive: true });

const anciennes = readdirSync(out).filter((n) => /^\d{4}-/.test(n)).sort();
for (const n of anciennes.slice(0, Math.max(0, anciennes.length - garder))) rmSync(join(out, n), { recursive: true, force: true });
console.log(`[sauvegarde] ${dir} (${Math.min(anciennes.length, garder)} conservées)`);
