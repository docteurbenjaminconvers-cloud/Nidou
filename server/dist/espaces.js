import { z } from "zod";
import { devis, droits, ESPACES, MODULES, PACKS, SOCLE, SOCLE_INCLUT } from "./offre.js";
import { DONNEES_BUDGET_VIDES, grandLivre, rapportBudget } from "./budgetExpert.js";
import { livreCsv, rapportIndependant, rapportPro } from "./viePro.js";
import { randomBytes } from "node:crypto";
import { rapportLocatif } from "./locatif.js";
import { monterSignatures } from "./signatures.js";
import { appliquerBail, appliquerBulletin, lire } from "./lecture.js";
import { budgetIa, coutAppel } from "./iaBudget.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changerModules, paiementDisponible, PaiementIndisponible, ConsentementRequis } from "./abonnement.js";
const MODULE_IDS = Object.keys(MODULES);
const num = z.number().finite();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const txt = (n = 200) => z.string().max(n);
export const schemas = {
    budget: z.object({
        previsionnel: z.record(z.string(), num.min(0).max(1e6)),
        patrimoine: z.object({
            actifs: z.array(z.object({ id: txt(40), libelle: txt(), type: z.enum(["compte", "epargne", "placement", "immobilier", "vehicule", "autre"]), valeur: num.min(0).max(1e9) })).max(100),
            passifs: z.array(z.object({ id: txt(40), libelle: txt(), type: z.enum(["credit_immo", "credit_conso", "autre"]), capital_restant: num.min(0).max(1e9), mensualite: num.min(0).max(1e6) })).max(50),
        }),
        comptes_exclus: z.array(txt(80)).max(20).optional(),
    }),
    pro: z.object({
        personnes: z.array(z.object({
            member_id: z.string().max(60).nullable(), prenom: txt(80),
            salarie: z.object({
                employeur: txt(), poste: txt(), type_contrat: z.enum(["CDI", "CDD", "interim", "apprentissage", "autre"]), date_entree: date, convention: txt().nullable().optional(),
                bulletins: z.array(z.object({ mois: z.string().regex(/^\d{4}-\d{2}$/), brut: num.min(0).max(1e6), net_paye: num.min(0).max(1e6), net_imposable: num.min(0).max(1e6) })).max(600),
            }).nullable().optional(),
            independant: z.object({ activite: txt(), regime: z.enum(["bnc_2035", "micro_bnc", "micro_entrepreneur"]), compte_pro: txt(80), debut_activite: date.nullable().optional(), rubriques: z.record(z.string(), z.string()).optional(),
                micro: z.object({ type: z.enum(["vente", "services_bic", "bnc_ssi", "bnc_cipav"]), periodicite: z.enum(["mensuelle", "trimestrielle"]), versement_liberatoire: z.boolean() }).nullable().optional() }).nullable().optional(),
        })).max(10),
    }),
    locatif: z.object({
        bailleur: txt(), adresse_bailleur: txt().nullable().optional(),
        biens: z.array(z.object({
            id: txt(40), nom: txt(), adresse: txt(300), type: z.enum(["appartement", "maison", "studio", "local", "parking"]), meuble: z.boolean(), surface: num.min(0).max(1e5).nullable().optional(),
            prix_achat: num.min(0).max(1e9), date_achat: date.nullable().optional(), dpe: z.enum(["A", "B", "C", "D", "E", "F", "G"]).nullable().optional(), dpe_date: date.nullable().optional(),
            taxe_fonciere: num.min(0).max(1e6), assurance_pno: num.min(0).max(1e6), charges_non_recuperables: num.min(0).max(1e6),
            credit_mensualite: num.min(0).max(1e6).nullable().optional(), interets_annuels: num.min(0).max(1e7).nullable().optional(), travaux_annee: num.min(0).max(1e7).nullable().optional(),
            structure_id: txt(40).nullable().optional(), tourisme: z.enum(["classe", "non_classe"]).nullable().optional(), part_terrain: num.min(0).max(0.9).nullable().optional(),
        })).max(200),
        structures: z.array(z.object({ id: txt(40), nom: txt(), regime: z.enum(["ir", "is"]), parts_foyer: num.min(0).max(100) })).max(20).optional(),
        baux: z.array(z.object({ id: txt(40), bien_id: txt(40), locataire: txt(), loyer_hc: num.min(0).max(1e6), charges: num.min(0).max(1e6), debut: date, fin: date.nullable().optional(), irl_trimestre: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]), irl_base: z.string().regex(/^\d{4}T[1-4]$/).nullable().optional(), depot_garantie: num.min(0).max(1e6), jour_paiement: z.number().int().min(1).max(31) })).max(400),
        encaissements_manuels: z.array(z.object({ bail_id: txt(40), mois: z.string().regex(/^\d{4}-\d{2}$/), montant: num.min(0).max(1e6), date })).max(5000).optional(),
    }),
};
export function monterEspaces(api, db, ctx) {
    const actifs = (c) => {
        const h = ctx.household(c);
        return droits({ plan: h.plan, essai_actif: h.plan_souscrit === "gratuit" && !!h.essai_fin && (h.essai_jours_restants ?? 0) > 0, modules: db.getModules(h.id) });
    };
    api.get("/offre", (c) => {
        const h = ctx.household(c);
        return c.json({ socle: SOCLE, socle_inclut: SOCLE_INCLUT, modules: MODULES, packs: PACKS, souscrits: db.getModules(h.id), actifs: [...actifs(c)], paiement: paiementDisponible() });
    });
    api.post("/offre/devis", async (c) => {
        const b = z.object({ formule: z.enum(["solo", "duo", "tribu"]), periode: z.enum(["mensuel", "annuel"]), modules: z.array(z.enum(MODULE_IDS)).max(10), pack: z.string().max(30).nullable().optional(), biens: z.number().int().min(0).max(200).optional(), proches: z.number().int().min(0).max(10).optional() }).parse(await c.req.json());
        return c.json(devis(b));
    });
    /** Choosing modules is a payment: Stripe (checkout or subscription update), or simulated on a test instance only. */
    api.post("/offre/modules", async (c) => {
        if (!ctx.isOwner(c))
            return c.json({ error: "proprietaire", message: "Seul le propriétaire du foyer gère l'abonnement." }, 403);
        const b = z.object({
            modules: z.array(z.enum(MODULE_IDS)).max(10), pack: z.string().max(30).nullable().optional(),
            formule: z.enum(["solo", "duo", "tribu"]).optional(), periode: z.enum(["mensuel", "annuel"]).optional(),
            biens: z.number().int().min(0).max(200).optional(), proches: z.number().int().min(0).max(10).optional(),
            demarrage_immediat: z.boolean().optional(),
        }).parse(await c.req.json());
        const h = db.getHousehold(ctx.household(c).id);
        const formule = b.formule ?? h.formule ?? "duo";
        const periode = b.periode ?? h.abonnement_periode ?? "mensuel";
        if (b.pack && !PACKS.some((p) => p.id === b.pack))
            return c.json({ error: "saisie_invalide" }, 400);
        try {
            const r = await changerModules(db, h, { formule, periode, modules: b.modules, pack: b.pack ?? null, biens: b.biens, proches: b.proches }, ctx.email(c), b.demarrage_immediat === true);
            return c.json({ ...r, souscrits: r.modules, actifs: [...actifs(c)] });
        }
        catch (e) {
            if (e instanceof PaiementIndisponible)
                return c.json({ error: "paiement_indisponible", message: e.message }, 503);
            if (e instanceof ConsentementRequis)
                return c.json({ error: "demarrage_immediat", message: e.message }, 400);
            return c.json({ error: "paiement", message: e.message }, 400);
        }
    });
    const verifier = (c, e) => actifs(c).has(ESPACES[e]); // Salarié is contained in Micro and Indépendant
    const refus = (c, e) => c.json({ error: "module", module: ESPACES[e], message: `Cet espace fait partie du module ${MODULES[ESPACES[e]].nom}.` }, 402);
    // Bail et état des lieux signés en ligne (Patrimoine locatif)
    monterSignatures(api, db, {
        household: ctx.household, email: ctx.email, prenom: () => null, verifier: (c) => verifier(c, "locatif"), refus: (c) => refus(c, "locatif"),
        uploadDir: ctx.uploadDir ?? "data/uploads", publicUrl: () => (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, ""),
    });
    const transactions = (hid) => db.listTransactions(hid).map((t) => ({ date: t.date, libelle: t.libelle, montant: t.montant, categorie: t.categorie, compte: t.compte }));
    const donnees = (hid, e, nom) => {
        const d = db.getModuleData(hid, e);
        if (d)
            return d;
        if (e === "budget")
            return DONNEES_BUDGET_VIDES;
        if (e === "pro")
            return { personnes: db.listMembers(hid).filter((m) => m.role === "adulte").map((m) => ({ member_id: m.id, prenom: m.prenom, salarie: null, independant: null })) };
        return { bailleur: nom.replace(/\s*\(démo\)$/, ""), biens: [], baux: [] };
    };
    api.get("/espaces/:espace", (c) => {
        const e = c.req.param("espace");
        if (!(e in ESPACES))
            return c.json({ error: "introuvable" }, 404);
        if (!verifier(c, e))
            return refus(c, e);
        const h = ctx.household(c);
        const d = donnees(h.id, e, h.nom);
        const txs = transactions(h.id);
        const rapport = e === "budget" ? rapportBudget(txs, { ...d, comptes_exclus: [...db.comptesPro(h.id)] })
            : e === "pro" ? rapportPro(d, txs, db.listDocuments(h.id).map((x) => ({ id: x.id, title: x.title, category: x.category })))
                : rapportLocatif(d, txs);
        if (e === "pro") {
            // A 2035 needs the Indépendant module; a micro-business needs Micro-entrepreneur (or Indépendant).
            const a = actifs(c);
            const dp = d;
            rapport.personnes.forEach((p, i) => {
                const reg = dp.personnes[i]?.independant?.regime;
                const besoin = !reg ? null : reg === "micro_entrepreneur" ? "vie_pro_micro" : "vie_pro_independant";
                if (besoin && !a.has(besoin)) {
                    p.independant = null;
                    p.module_requis = besoin;
                }
            });
        }
        return c.json({ donnees: d, rapport, comptes: [...new Set(txs.map((t) => t.compte).filter(Boolean))] });
    });
    api.put("/espaces/:espace", async (c) => {
        const e = c.req.param("espace");
        if (!(e in ESPACES))
            return c.json({ error: "introuvable" }, 404);
        if (!verifier(c, e))
            return refus(c, e);
        const d = schemas[e].parse(await c.req.json());
        db.setModuleData(ctx.household(c).id, e, d);
        return c.json({ ok: true });
    });
    /**
     * « Remplir tout seul » : a payslip (Vie pro) or a lease (Patrimoine locatif) is read and added to the space;
     * the original is kept in Papiers. Form fields: file, and member_id (payslip) or bien_id (lease, optional).
     */
    api.post("/espaces/:espace/lire", async (c) => {
        const e = c.req.param("espace");
        if (e !== "pro" && e !== "locatif")
            return c.json({ error: "introuvable" }, 404);
        if (!verifier(c, e))
            return refus(c, e);
        const h = ctx.household(c);
        const form = await c.req.formData();
        const f = form.get("file");
        if (!(f instanceof File))
            return c.json({ error: "fichier", message: "Ajoutez une photo ou un PDF." }, 400);
        const mime = f.type || "application/octet-stream";
        if (!/^(application\/pdf|image\/(jpeg|png|webp|heic|heif)|text\/plain)$/.test(mime))
            return c.json({ error: "type_fichier", message: "Une photo ou un PDF, s'il vous plaît." }, 415);
        const buf = Buffer.from(await f.arrayBuffer());
        const entree = mime.startsWith("text/") ? { texte: buf.toString("utf8") } : { base64: buf.toString("base64"), mime };
        const budget = budgetIa(db, h.id);
        const quoi = e === "pro" ? "bulletin" : "bail";
        const { lu, ia } = await lire(quoi, entree, budget.ok(coutAppel("precis")));
        if (ia)
            budget.compter(coutAppel("precis"), true);
        try {
            let resume, titre;
            if (e === "pro") {
                const mid = String(form.get("member_id") ?? "") || null;
                const m = mid ? db.getMember(mid) : undefined;
                if (mid && (!m || m.household_id !== h.id))
                    return c.json({ error: "introuvable" }, 404);
                const r = appliquerBulletin(donnees(h.id, "pro", h.nom), { member_id: mid, prenom: m?.prenom ?? "Moi" }, lu);
                db.setModuleData(h.id, "pro", r.donnees);
                resume = r.resume;
                const l = lu;
                titre = `Bulletin de salaire ${l.mois ? new Date(`${l.mois}-15`).toLocaleDateString("fr-FR", { month: "long", year: "numeric" }) : ""}${l.employeur ? ` — ${l.employeur}` : ""}`.trim();
            }
            else {
                const r = appliquerBail(donnees(h.id, "locatif", h.nom), lu, String(form.get("bien_id") ?? "") || null);
                db.setModuleData(h.id, "locatif", r.donnees);
                resume = r.resume;
                const l = lu;
                titre = `Bail${l.locataire ? ` de ${l.locataire}` : ""}${l.adresse ? ` — ${l.adresse.split(",")[0]}` : ""}`;
            }
            // the original goes to Papiers (a payslip is kept until retirement)
            if (ctx.uploadDir) {
                await mkdir(ctx.uploadDir, { recursive: true });
                const fichier = `${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
                await writeFile(join(ctx.uploadDir, fichier), buf);
                db.insertDocument({ household_id: h.id, member_id: null, title: titre.slice(0, 120), category: e === "pro" ? "autre" : "logement", organisme: null, numero_contrat: null,
                    montant: null, periodicite: null, date_document: null, date_debut: null, date_fin: null, preavis_jours: null, resume, texte: entree.texte ?? null, fichier, mime, confiance: lu.confiance });
            }
            return c.json({ ok: true, resume, ia, lu });
        }
        catch (err) {
            return c.json({ error: "lecture_incomplete", message: err.message, ia, lu }, 422);
        }
    });
    api.get("/espaces/budget/grand-livre.csv", (c) => {
        if (!verifier(c, "budget"))
            return refus(c, "budget");
        const h = ctx.household(c);
        const d = donnees(h.id, "budget", h.nom);
        return new Response(grandLivre(transactions(h.id), { comptes_exclus: [...db.comptesPro(h.id)] }), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="grand-livre-lucien.csv"`, "x-content-type-options": "nosniff" } });
    });
    // ---------- accès comptable (lecture seule, révocable, un an) ----------
    api.get("/espaces/pro/partages", (c) => {
        if (!verifier(c, "pro"))
            return refus(c, "pro");
        return c.json(db.listPartages(ctx.household(c).id));
    });
    api.post("/espaces/pro/partages", async (c) => {
        if (!verifier(c, "pro"))
            return refus(c, "pro");
        const b = z.object({ member_id: z.string().max(60).nullable(), nom: z.string().max(120).nullable().optional() }).parse(await c.req.json());
        const h = ctx.household(c);
        const d = donnees(h.id, "pro", h.nom);
        if (!d.personnes.some((p) => p.member_id === b.member_id && p.independant))
            return c.json({ error: "saisie_invalide", message: "Seule une activité d'indépendant se partage avec un comptable." }, 400);
        return c.json(db.creerPartage(h.id, b.member_id, b.nom?.trim() || null, randomBytes(24).toString("hex")), 201);
    });
    api.delete("/espaces/pro/partages/:token", (c) => {
        db.revoquerPartage(ctx.household(c).id, c.req.param("token"));
        return c.json({ ok: true });
    });
    /** The accountant's view: no session, only the secret link; the independent activity only (never payslips or the family). */
    const vueComptable = (token) => {
        const p = db.getPartage(token);
        if (!p || p.revoque || p.expire_le < new Date().toISOString())
            return null;
        const h = db.getHousehold(p.household_id);
        if (!h)
            return null;
        const ok = droits({ plan: db.effectivePlan(h), essai_actif: db.effectivePlan(h) === "famille" && h.plan !== "famille", modules: db.getModules(h.id) });
        if (!ok.has("vie_pro_micro"))
            return null; // Micro-entrepreneur or Indépendant
        const d = db.getModuleData(h.id, "pro");
        const pers = d?.personnes.find((x) => x.member_id === p.member_id && x.independant);
        if (!pers?.independant)
            return null;
        const txs = transactions(h.id);
        return { prenom: pers.prenom, nom_comptable: p.nom, expire_le: p.expire_le, independant: rapportIndependant(pers.independant, txs, new Date().toISOString().slice(0, 10)) };
    };
    api.get("/comptable/:token", (c) => {
        const v = vueComptable(c.req.param("token"));
        return v ? c.json(v) : c.json({ error: "introuvable", message: "Ce lien n'est plus valable : demandez-en un nouveau à votre client." }, 404);
    });
    api.get("/comptable/:token/livre.csv", (c) => {
        const v = vueComptable(c.req.param("token"));
        if (!v)
            return c.json({ error: "introuvable" }, 404);
        return new Response(livreCsv(v.independant), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="livre-${v.independant.annee}.csv"`, "x-content-type-options": "nosniff" } });
    });
}
