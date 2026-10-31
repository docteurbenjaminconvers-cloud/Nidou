// Restaure une sauvegarde chiffrée de Lucien dans un dossier (sans toucher aux données en service).
// Usage : node scripts/restaurer.mjs <fichier.lucienbk | s3:lucien/AAAA-...lucienbk> <dossier-destination>
// Il faut LUCIEN_SAUVEGARDE_CLE (et LUCIEN_S3_* pour une sauvegarde sur le stockage).
// Ensuite : arrêter l'appli, remplacer /data/lucien.sqlite et /data/uploads par ceux du dossier, relancer.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { dechiffrer, lireTar, s3Config, telechargerS3 } from "../dist/sauvegarde.js";

const [source, destination] = process.argv.slice(2);
const cle = process.env.LUCIEN_SAUVEGARDE_CLE;
if (!source || !destination || !cle) { console.error("Usage : LUCIEN_SAUVEGARDE_CLE=… node scripts/restaurer.mjs <fichier|s3:clé> <dossier>"); process.exit(2); }
const racine = resolve(destination);
if (existsSync(racine) && readdirSync(racine).length) { console.error(`Le dossier ${racine} n'est pas vide : choisissez un dossier neuf.`); process.exit(2); }

let brut;
if (source.startsWith("s3:")) {
  const cfg = s3Config();
  if (!cfg) { console.error("LUCIEN_S3_* manquant"); process.exit(2); }
  brut = await telechargerS3(cfg, source.slice(3));
} else brut = readFileSync(source);

const entrees = lireTar(dechiffrer(brut, cle));
for (const e of entrees) {
  const cible = resolve(racine, e.nom);
  if (!cible.startsWith(racine + "/")) throw new Error(`Chemin refusé dans l'archive : ${e.nom}`);
  mkdirSync(dirname(cible), { recursive: true });
  writeFileSync(cible, e.contenu);
}
console.log(`[restauration] ${entrees.length} fichiers dans ${racine} (base : ${join(racine, "lucien.sqlite")})`);
