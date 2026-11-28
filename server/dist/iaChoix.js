const RE_IDENTITE = /passeport|passport|carte[\s_-]*(nationale|d['’e]?[\s_-]*identit)|\bcni\b|pi[eè]ce[\s_-]*d['’e]?[\s_-]*identit|permis[\s_-]*de[\s_-]*conduire|titre[\s_-]*de[\s_-]*s[eé]jour|livret[\s_-]*de[\s_-]*famille/i;
export function semblePieceIdentite(p) {
    return p.categorie === "identite" || RE_IDENTITE.test(`${(p.nomFichier ?? "").replace(/[_.-]+/g, " ")} ${(p.texte ?? "").slice(0, 3000)}`);
}
/** May this paper be read by the AI? `raison`: why not (the household reads without AI / an identity paper). */
export function iaPourPapier(h, p) {
    if (h && h.ia_papiers === 0)
        return { ia: false, raison: "foyer" };
    if (!h?.ia_identite && semblePieceIdentite(p))
        return { ia: false, raison: "identite" };
    return { ia: true, raison: null };
}
export const RESUME_SANS_IA = {
    foyer: "Papier lu sans IA, comme vous l'avez choisi dans Réglages : il n'a pas quitté Lucien. Vérifiez et complétez les champs.",
    identite: "Pièce d'identité : rangée sans passer par l'IA, elle n'a pas quitté Lucien. Indiquez sa date d'expiration pour être prévenu à temps.",
};
