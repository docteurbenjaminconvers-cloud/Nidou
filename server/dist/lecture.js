/**
 * « Remplir tout seul » : a payslip or a lease, photographed or as a PDF, is read by the AI and fills the Vie pro or
 * Patrimoine locatif space — no typing. Without AI (no key, or the household's monthly budget used up) a local reading
 * picks up the usual labels (« Net à payer », « Loyer »…) and the person completes the rest.
 * The pure parts (local reading, applying to the space data) are tested without any AI.
 */
import { z } from "zod";
import { provider, structured } from "./ia.js";
// ---------- what is read ----------
export const BulletinLu = z.object({
    employeur: z.string().nullable(), poste: z.string().nullable(), mois: z.string().regex(/^\d{4}-\d{2}$/).nullable(),
    brut: z.number().nullable(), net_paye: z.number().nullable(), net_imposable: z.number().nullable(),
    type_contrat: z.enum(["CDI", "CDD", "interim", "apprentissage", "autre"]).nullable(), date_entree: z.string().nullable(), convention: z.string().nullable(),
    confiance: z.number().min(0).max(1),
});
export const BailLu = z.object({
    locataire: z.string().nullable(), adresse: z.string().nullable(), type: z.enum(["appartement", "maison", "studio", "local", "parking"]).nullable(),
    meuble: z.boolean().nullable(), surface: z.number().nullable(), loyer_hc: z.number().nullable(), charges: z.number().nullable(),
    depot_garantie: z.number().nullable(), debut: z.string().nullable(), jour_paiement: z.number().int().min(1).max(31).nullable(),
    irl_trimestre: z.number().int().min(1).max(4).nullable(), dpe: z.enum(["A", "B", "C", "D", "E", "F", "G"]).nullable(),
    confiance: z.number().min(0).max(1),
});
const SYSTEME_BULLETIN = `Tu lis un bulletin de salaire français. Extrais : l'employeur (raison sociale), l'intitulé du poste, le mois de paie (AAAA-MM),
le salaire brut, le net payé (« net à payer », après impôt), le net imposable (« net imposable » ou « net fiscal ») du mois, le type de contrat,
la date d'entrée (AAAA-MM-JJ) et la convention collective. Montants en euros, nombres décimaux. Si une information manque, null. N'invente rien.`;
const SYSTEME_BAIL = `Tu lis un contrat de location (bail d'habitation ou commercial) français. Extrais : le nom du ou des locataires, l'adresse du logement,
le type de bien, s'il est meublé, la surface en m², le loyer mensuel hors charges, la provision ou le forfait de charges mensuel, le dépôt de garantie,
la date de prise d'effet (AAAA-MM-JJ), le jour de paiement du loyer, le trimestre de l'IRL de référence (1 à 4) et la classe du DPE.
Montants en euros. Si une information manque, null. N'invente rien.`;
const schemaOutil = (s) => {
    // a small JSON schema from the zod object (nullable numbers, strings, booleans, enums)
    const props = {};
    for (const [k, v] of Object.entries(s.shape)) {
        let t = v;
        let nullable = false;
        if (t instanceof z.ZodNullable) {
            nullable = true;
            t = t.unwrap();
        }
        const base = t instanceof z.ZodNumber ? { type: "number" } : t instanceof z.ZodBoolean ? { type: "boolean" } : t instanceof z.ZodEnum ? { type: "string", enum: t.options } : { type: "string" };
        props[k] = nullable ? { anyOf: [base, { type: "null" }] } : base;
    }
    return { type: "object", required: Object.keys(props), properties: props };
};
// ---------- local reading (no AI) ----------
const montant = (t, re) => {
    const m = t.match(re);
    if (!m)
        return null;
    const n = Number(m[1].replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : null;
};
const NB = "(\\d{1,3}(?:[ .]\\d{3})*(?:,\\d{1,2})?|\\d+(?:,\\d{1,2})?)";
const MOIS = { janvier: "01", fevrier: "02", février: "02", mars: "03", avril: "04", mai: "05", juin: "06", juillet: "07", aout: "08", août: "08", septembre: "09", octobre: "10", novembre: "11", decembre: "12", décembre: "12" };
export function lireBulletinLocal(texte) {
    const t = texte.replace(/ /g, " ");
    const mm = t.toLowerCase().match(/(janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\s+(20\d{2})/);
    const brut = montant(t, new RegExp(`salaire brut[^\\d\\n]{0,30}${NB}`, "i"));
    const net = montant(t, new RegExp(`net (?:à|a) payer[^\\d\\n]{0,40}${NB}`, "i"));
    const imp = montant(t, new RegExp(`net (?:imposable|fiscal)[^\\d\\n]{0,30}${NB}`, "i"));
    const found = [brut, net, imp].filter((x) => x !== null).length;
    return {
        employeur: null, poste: null, mois: mm ? `${mm[2]}-${MOIS[mm[1]] ?? MOIS[mm[1].normalize("NFD").replace(/\p{M}/gu, "")]}` : null,
        brut, net_paye: net, net_imposable: imp, type_contrat: /\bCDD\b/.test(t) ? "CDD" : /\bCDI\b/.test(t) ? "CDI" : null, date_entree: null, convention: null,
        confiance: Math.min(0.6, found * 0.2),
    };
}
export function lireBailLocal(texte) {
    const t = texte.replace(/ /g, " ");
    const loyer = montant(t, new RegExp(`loyer(?: mensuel)?(?: hors charges)?[^\\d\\n]{0,40}${NB}`, "i"));
    const charges = montant(t, new RegExp(`(?:provisions? (?:sur|pour) (?:les )?charges|forfait de charges|^\\s*charges\\b)[^\\d\\n]{0,40}${NB}`, "im"));
    const depot = montant(t, new RegExp(`d[ée]p[ôo]t de garantie[^\\d\\n]{0,40}${NB}`, "i"));
    const debut = t.match(/(?:prend effet|prise d'effet|à compter du|a compter du)[^\d\n]{0,20}(\d{2})\/(\d{2})\/(\d{4})/i);
    const dpe = t.match(/(?:classe (?:énergie|energie|DPE)|\bDPE)\s*[:\-]?\s*([A-G])\b/i);
    const found = [loyer, charges, depot, debut].filter(Boolean).length;
    return {
        locataire: null, adresse: null, type: /\bstudio\b/i.test(t) ? "studio" : /\bmaison\b/i.test(t) ? "maison" : /appartement/i.test(t) ? "appartement" : null,
        meuble: /meubl[ée]/i.test(t) ? true : /non meubl|vide/i.test(t) ? false : null, surface: montant(t, new RegExp(`${NB}\\s*m(?:²|2)`, "i")),
        loyer_hc: loyer, charges, depot_garantie: depot, debut: debut ? `${debut[3]}-${debut[2]}-${debut[1]}` : null,
        jour_paiement: null, irl_trimestre: null, dpe: dpe?.[1]?.toUpperCase() ?? null, confiance: Math.min(0.6, found * 0.15),
    };
}
const contenu = (e) => {
    const c = [];
    if (e.base64 && e.mime === "application/pdf")
        c.push({ type: "pdf", base64: e.base64 });
    else if (e.base64 && e.mime?.startsWith("image/"))
        c.push({ type: "image", mime: e.mime, base64: e.base64 });
    if (e.texte)
        c.push({ type: "text", text: e.texte.slice(0, 20000) });
    return c;
};
export async function lire(quoi, e, avecIa) {
    const local = () => (quoi === "bulletin" ? lireBulletinLocal(e.texte ?? "") : lireBailLocal(e.texte ?? ""));
    if (!avecIa || !provider())
        return { lu: local(), ia: false };
    const schema = quoi === "bulletin" ? BulletinLu : BailLu;
    try {
        const r = await structured({
            tier: "precis", system: quoi === "bulletin" ? SYSTEME_BULLETIN : SYSTEME_BAIL, content: contenu(e),
            tool: { name: quoi === "bulletin" ? "bulletin" : "bail", description: quoi === "bulletin" ? "Champs du bulletin de salaire." : "Champs du bail.", schema: schemaOutil(schema) },
            maxTokens: 1200,
        });
        return { lu: schema.parse(r.data), ia: true };
    }
    catch (err) {
        console.error(`[lecture ${quoi}]`, err.message);
        return { lu: local(), ia: false };
    }
}
// ---------- applying to the spaces ----------
/** Adds (or replaces) the month's payslip for one person; creates the employee record if there is none. */
export function appliquerBulletin(d, personne, lu) {
    if (!lu.mois || lu.net_paye === null)
        throw new Error("Le mois ou le net payé n'ont pas pu être lus : ajoutez ce bulletin à la main.");
    const personnes = d.personnes.map((p) => ({ ...p }));
    let p = personnes.find((x) => (personne.member_id ? x.member_id === personne.member_id : x.prenom === personne.prenom));
    if (!p) {
        p = { member_id: personne.member_id, prenom: personne.prenom, salarie: null, independant: null };
        personnes.push(p);
    }
    const s = p.salarie ? { ...p.salarie, bulletins: [...p.salarie.bulletins] }
        : { employeur: lu.employeur ?? "Employeur", poste: lu.poste ?? "", type_contrat: lu.type_contrat ?? "CDI", date_entree: lu.date_entree ?? `${lu.mois}-01`, convention: lu.convention, bulletins: [] };
    if (!p.salarie) {
        if (lu.employeur)
            s.employeur = lu.employeur;
    }
    const b = { mois: lu.mois, brut: lu.brut ?? lu.net_paye, net_paye: lu.net_paye, net_imposable: lu.net_imposable ?? lu.net_paye };
    s.bulletins = [...s.bulletins.filter((x) => x.mois !== lu.mois), b].sort((a, c) => a.mois.localeCompare(c.mois));
    p.salarie = s;
    const mois = new Date(`${lu.mois}-15`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
    return { donnees: { ...d, personnes }, resume: `Bulletin de ${mois} ajouté : net payé ${lu.net_paye.toLocaleString("fr-FR")} €` };
}
const nouvelId = () => Math.random().toString(36).slice(2, 10);
/** Adds a lease: to an existing property, or creates the property from what the lease says. */
export function appliquerBail(d, lu, bienId) {
    if (lu.loyer_hc === null || !lu.debut)
        throw new Error("Le loyer ou la date de début n'ont pas pu être lus : ajoutez ce bail à la main.");
    const biens = [...d.biens];
    let bien = bienId ? biens.find((b) => b.id === bienId) : undefined;
    if (!bien) {
        bien = { id: nouvelId(), nom: lu.adresse ? lu.adresse.split(",")[0].slice(0, 40) : `${lu.type ?? "Logement"} loué`, adresse: lu.adresse ?? "", type: lu.type ?? "appartement",
            meuble: lu.meuble ?? false, surface: lu.surface, prix_achat: 0, dpe: lu.dpe, taxe_fonciere: 0, assurance_pno: 0, charges_non_recuperables: 0 };
        biens.push(bien);
    }
    else if (lu.dpe && !bien.dpe) {
        bien = { ...bien, dpe: lu.dpe };
        biens.splice(biens.findIndex((b) => b.id === bienId), 1, bien);
    }
    const debut = lu.debut;
    const bail = { id: nouvelId(), bien_id: bien.id, locataire: lu.locataire ?? "Locataire", loyer_hc: lu.loyer_hc, charges: lu.charges ?? 0, debut,
        irl_trimestre: (lu.irl_trimestre ?? (Math.floor((Number(debut.slice(5, 7)) - 1) / 3) + 1)), depot_garantie: lu.depot_garantie ?? 0, jour_paiement: lu.jour_paiement ?? 5 };
    // a new lease on the same property ends the previous one
    const baux = d.baux.map((x) => (x.bien_id === bien.id && !x.fin && x.debut < debut ? { ...x, fin: debut } : x));
    return { donnees: { ...d, biens, baux: [...baux, bail] }, bien_id: bien.id,
        resume: `Bail de ${bail.locataire} ajouté : ${lu.loyer_hc.toLocaleString("fr-FR")} € hors charges depuis le ${debut.split("-").reverse().join("/")}` };
}
