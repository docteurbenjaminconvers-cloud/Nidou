const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function compiler(d) {
    // indice: the longest fixed part of the pattern, a cheap test before the regular expression (hundreds of patterns)
    return d.motifs.map(([de, vers]) => ({
        // {2#} stands for a number (« et {2#} autres »), so the parts around it are not cut in the wrong place
        re: new RegExp(`^${echapper(de).replace(/\\\{(\d+)#\\\}/g, "([\\d\\s\u202f\u00a0]+)").replace(/\\\{(\d+)\\\}/g, "(.+?)")}$`, "s"), vers,
        indice: de.split(/\{\d+#?\}/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0] ?? "",
    }));
}
export function traducteur(d) {
    const motifs = compiler(d);
    const t = (texte, profondeur = 0) => {
        const brut = texte.trim();
        if (!brut || !/\p{L}/u.test(brut))
            return null;
        const direct = d.textes[brut];
        if (direct !== undefined)
            return texte.replace(brut, direct);
        // a name used in the middle of a sentence, without its capital (« louer un logement »)
        const majuscule = brut[0].toUpperCase() + brut.slice(1);
        const enMajuscule = majuscule !== brut ? d.textes[majuscule] : undefined;
        if (enMajuscule)
            return texte.replace(brut, enMajuscule[0].toLowerCase() + enMajuscule.slice(1));
        if (profondeur > 2)
            return null;
        for (const m of motifs) {
            if (m.indice && !brut.includes(m.indice))
                continue;
            const r = brut.match(m.re);
            if (!r)
                continue;
            // a variable part that is a whole untranslated French phrase means the pattern caught a sentence it was not made
            // for: better leave the sentence in French than mix the two languages
            let melange = false;
            const sortie = m.vers.replace(/\{(\d+)\}/g, (_, i) => {
                const v = r[Number(i) + 1] ?? "";
                const tv = t(v, profondeur + 1);
                if (tv === null && (v.match(/\p{L}{2,}/gu) ?? []).length > 3)
                    melange = true;
                return tv ?? v; // keeps the spaces around the part (" La cantine est notée…" after a full stop)
            });
            if (melange)
                continue;
            return texte.replace(brut, sortie);
        }
        // a list built by the app (« A, B et 2 autres »): translated when every item is
        const morceaux = brut.split(/(, | et )/);
        if (morceaux.length > 1) {
            const sortie = morceaux.map((m, i) => (i % 2 ? (m === " et " ? " and " : m) : t(m, profondeur)));
            if (sortie.every((m, i) => i % 2 || m !== null || !/\p{L}{2,}/u.test(morceaux[i]))) {
                return texte.replace(brut, sortie.map((m, i) => m ?? morceaux[i]).join(""));
            }
        }
        return null;
    };
    return t;
}
