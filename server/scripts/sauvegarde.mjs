// Sauvegarde quotidienne de Lucien, faite à chaud (VACUUM INTO, sans arrêter le service) : la base SQLite et les fichiers déposés.
// Usage : node scripts/sauvegarde.mjs [dossier]   (défaut : $LUCIEN_DATA/sauvegardes). Garde les 14 dernières sur le serveur.
//  - avec LUCIEN_SAUVEGARDE_CLE : une archive chiffrée (AES-256-GCM) remplace la copie en clair sur le serveur ;
//  - avec en plus LUCIEN_S3_ENDPOINT, LUCIEN_S3_BUCKET, LUCIEN_S3_ACCESS_KEY, LUCIEN_S3_SECRET_KEY (et LUCIEN_S3_REGION) :
//    l'archive chiffrée est envoyée hors du serveur. Rien n'est jamais envoyé en clair.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync, rmSync, existsSync, cpSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { chiffrer, envoyerS3, s3Config, tar } from "../dist/sauvegarde.js";

const data = process.env.LUCIEN_DATA ?? process.env.NIDOU_DATA ?? "/data";
const out = process.argv[2] ?? join(data, "sauvegardes");
const garder = Number(process.env.LUCIEN_SAUVEGARDES_GARDER ?? process.env.NIDOU_SAUVEGARDES_GARDER ?? 14);
const cle = process.env.LUCIEN_SAUVEGARDE_CLE ?? "";
const s3 = s3Config();
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join(out, stamp);
mkdirSync(dir, { recursive: true });

try {
  // 1. instantané cohérent
  const base = existsSync(join(data, "lucien.sqlite")) ? "lucien.sqlite" : "nidou.sqlite";
  const db = new DatabaseSync(join(data, base));
  db.exec(`VACUUM INTO '${join(dir, "lucien.sqlite").replace(/'/g, "''")}'`);
  db.close();
  if (existsSync(join(data, "uploads"))) cpSync(join(data, "uploads"), join(dir, "uploads"), { recursive: true });

  // 2. archive chiffrée, puis envoi hors du serveur
  if (cle) {
    const fichiers = [];
    const parcourir = (d) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) parcourir(p); else fichiers.push({ nom: relative(dir, p), contenu: readFileSync(p) }); } };
    parcourir(dir);
    const archive = chiffrer(tar(fichiers), cle);
    const nomArchive = `${stamp}.lucienbk`;
    writeFileSync(join(out, nomArchive), archive);
    rmSync(dir, { recursive: true, force: true }); // plus de copie en clair sur le serveur
    if (s3) {
      await envoyerS3(s3, `lucien/${nomArchive}`, archive);
      console.log(`[sauvegarde] envoyée hors du serveur : ${s3.bucket}/lucien/${nomArchive} (${(archive.length / 1e6).toFixed(1)} Mo)`);
    }
  } else if (s3) {
    throw new Error("LUCIEN_S3_* est réglé mais pas LUCIEN_SAUVEGARDE_CLE : rien n'est envoyé hors du serveur sans chiffrement.");
  } else {
    console.warn("[sauvegarde] ATTENTION : copie en clair, sur le même serveur seulement. Réglez LUCIEN_SAUVEGARDE_CLE et LUCIEN_S3_*.");
  }

  // 3. on garde les dernières sur le serveur
  const anciennes = readdirSync(out).filter((n) => /^\d{4}-/.test(n)).sort();
  for (const n of anciennes.slice(0, Math.max(0, anciennes.length - garder))) rmSync(join(out, n), { recursive: true, force: true });
  console.log(`[sauvegarde] ${stamp} faite (${Math.min(anciennes.length, garder)} conservées sur le serveur)`);
} catch (e) {
  console.error(`[sauvegarde] ÉCHEC : ${e.message}`);
  process.exitCode = 1;
}
