// Sauvegarde de Lucien, faite à chaud (VACUUM INTO, sans arrêter le service) : la base SQLite, les fichiers déposés
// et la clé du coffre. Usage : node scripts/sauvegarde.mjs [dossier]   (défaut : $LUCIEN_DATA/sauvegardes).
//  - avec LUCIEN_SAUVEGARDE_CLE : une archive chiffrée (AES-256-GCM) remplace la copie en clair sur le serveur ;
//  - avec en plus LUCIEN_S3_ENDPOINT, LUCIEN_S3_BUCKET, LUCIEN_S3_ACCESS_KEY, LUCIEN_S3_SECRET_KEY (et LUCIEN_S3_REGION) :
//    l'archive chiffrée est envoyée hors du serveur. Rien n'est jamais envoyé en clair.
// Sur un hébergeur sans cron (Render), le serveur fait lui-même cette sauvegarde chaque jour (dist/sauvegardeJob.js).
import { faireSauvegarde } from "../dist/sauvegardeJob.js";
import { s3Config } from "../dist/sauvegarde.js";

const data = process.env.LUCIEN_DATA ?? process.env.NIDOU_DATA ?? "/data";
try {
  const r = await faireSauvegarde({
    data, out: process.argv[2], cle: process.env.LUCIEN_SAUVEGARDE_CLE ?? "", s3: s3Config(),
    garder: Number(process.env.LUCIEN_SAUVEGARDES_GARDER ?? process.env.NIDOU_SAUVEGARDES_GARDER ?? 14),
  });
  if (r.envoyee) console.log(`[sauvegarde] envoyée hors du serveur : ${r.envoyee} (${(r.octets / 1e6).toFixed(1)} Mo)`);
  if (!r.chiffree) console.warn("[sauvegarde] ATTENTION : copie en clair, sur le même serveur seulement. Réglez LUCIEN_SAUVEGARDE_CLE et LUCIEN_S3_*.");
  console.log(`[sauvegarde] ${r.nom} faite (${r.gardees} conservées sur le serveur)`);
} catch (e) {
  console.error(`[sauvegarde] ÉCHEC : ${e.message}`);
  process.exitCode = 1;
}
