/**
 * Compatibilité avec l'ancien nom (Nidou) : les variables NIDOU_* déjà réglées sur un serveur
 * (Render, VPS) restent prises en compte sous leur nouveau nom LUCIEN_*, sans rien changer à la configuration.
 * Ce module doit être importé en premier, avant tout module qui lit process.env au chargement.
 */
for (const [cle, valeur] of Object.entries(process.env)) {
    if (!cle.startsWith("NIDOU_") || valeur === undefined)
        continue;
    const nouvelle = "LUCIEN_" + cle.slice("NIDOU_".length);
    if (process.env[nouvelle] === undefined)
        process.env[nouvelle] = valeur;
}
export {};
