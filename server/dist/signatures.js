import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { z } from "zod";
import { cleJeton } from "./db.js";
import { contenuBail, contenuEdl } from "./documentsLocation.js";
import { envoyerEmail } from "./mail.js";
import { empreinte, pdfDocument } from "./pdfLocation.js";
export function ensureSignaturesSchema(db) {
    db.raw.exec(`CREATE TABLE IF NOT EXISTS documents_location (
    id TEXT PRIMARY KEY, household_id TEXT NOT NULL, bien_id TEXT NOT NULL, bail_id TEXT, type TEXT NOT NULL, statut TEXT NOT NULL,
    donnees TEXT NOT NULL, empreinte TEXT, entree_id TEXT, document_id TEXT, fichier TEXT, cree_le TEXT NOT NULL, maj_le TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS documents_location_foyer ON documents_location(household_id);
  CREATE TABLE IF NOT EXISTS signatures_location (
    id TEXT PRIMARY KEY, doc_id TEXT NOT NULL, household_id TEXT NOT NULL, role TEXT NOT NULL, nom TEXT NOT NULL, email TEXT, jeton TEXT,
    signe_le TEXT, ip TEXT, user_agent TEXT, image TEXT, cree_le TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS signatures_location_doc ON signatures_location(doc_id);`);
}
const now = () => new Date().toISOString();
const getDoc = (db, id) => db.raw.prepare("SELECT * FROM documents_location WHERE id = ?").get(id);
const signatures = (db, docId) => db.raw.prepare("SELECT * FROM signatures_location WHERE doc_id = ? ORDER BY role, cree_le").all(docId);
/** The text of a document as it is (or will be) signed. */
export function contenu(db, d) {
    const donnees = JSON.parse(d.donnees);
    if (d.type === "bail")
        return contenuBail(donnees);
    const entree = d.entree_id ? getDoc(db, d.entree_id) : null;
    return contenuEdl(donnees, entree && entree.household_id === d.household_id ? JSON.parse(entree.donnees) : null);
}
const vue = (db, d) => ({
    id: d.id, bien_id: d.bien_id, bail_id: d.bail_id, type: d.type, statut: d.statut, donnees: JSON.parse(d.donnees), entree_id: d.entree_id,
    document_id: d.document_id, cree_le: d.cree_le, maj_le: d.maj_le, empreinte: d.empreinte,
    signatures: signatures(db, d.id).map((s) => ({ id: s.id, role: s.role, nom: s.nom, email: s.email, signe_le: s.signe_le })),
});
const sigPdf = (ss) => ss.map((s) => ({ role: s.role, nom: s.nom, signe_le: s.signe_le, ip: s.ip, image: s.image }));
/** Once everyone has signed: the PDF is written, filed in Papiers, and the document is marked signed. */
async function finaliser(db, d, uploadDir) {
    const ss = signatures(db, d.id);
    if (ss.some((s) => !s.signe_le))
        return;
    const c = contenu(db, d);
    const pdf = await pdfDocument(c, sigPdf(ss), { id: d.id, empreinte: d.empreinte ?? empreinte(c) });
    await mkdir(uploadDir, { recursive: true });
    const nom = `${randomUUID()}.pdf`;
    await writeFile(join(uploadDir, nom), pdf);
    const donnees = JSON.parse(d.donnees);
    const locataires = d.type === "bail" ? donnees.locataires.map((l) => l.nom).join(", ") : donnees.locataires.join(", ");
    const doc = db.insertDocument({
        household_id: d.household_id, member_id: null, title: `${c.titre} signé — ${locataires}`, category: "logement", organisme: null, numero_contrat: null,
        montant: d.type === "bail" ? donnees.loyer_hc + donnees.charges : null, periodicite: d.type === "bail" ? "mensuel" : null,
        date_document: now().slice(0, 10), date_debut: d.type === "bail" ? donnees.debut : donnees.date, date_fin: null, preavis_jours: null,
        resume: `${c.titre}, ${c.sous_titre}. Signé électroniquement par ${ss.map((s) => s.nom).join(" et ")}.`, texte: c.sections.map((s) => `${s.titre}\n${s.paragraphes.join("\n")}`).join("\n\n"),
        fichier: nom, mime: "application/pdf", confiance: 1, verifie: 1, source: "app",
    });
    db.raw.prepare("UPDATE documents_location SET statut = 'signe', fichier = ?, document_id = ?, maj_le = ? WHERE id = ?").run(nom, doc.id, now(), d.id);
}
const ipDe = (c) => (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || c.req.header("x-real-ip") || null;
const imageSchema = z.string().max(300_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/);
export function monterSignatures(api, db, ctx) {
    ensureSignaturesSchema(db);
    const duFoyer = (c, id) => { const d = getDoc(db, id); return d && d.household_id === ctx.household(c).id ? d : null; };
    api.get("/locatif/documents", (c) => {
        if (!ctx.verifier(c))
            return ctx.refus(c);
        const rows = db.raw.prepare("SELECT * FROM documents_location WHERE household_id = ? AND statut != 'annule' ORDER BY cree_le DESC").all(ctx.household(c).id);
        return c.json({ documents: rows.map((d) => vue(db, d)) });
    });
    const donneesSchema = z.record(z.string(), z.unknown());
    api.post("/locatif/documents", async (c) => {
        if (!ctx.verifier(c))
            return ctx.refus(c);
        const b = z.object({ type: z.enum(["bail", "edl_entree", "edl_sortie"]), bien_id: z.string().max(40), bail_id: z.string().max(40).nullable().optional(), entree_id: z.string().max(40).nullable().optional(), donnees: donneesSchema }).parse(await c.req.json());
        if (JSON.stringify(b.donnees).length > 200_000)
            return c.json({ error: "taille" }, 413);
        const id = randomUUID();
        db.raw.prepare("INSERT INTO documents_location (id, household_id, bien_id, bail_id, type, statut, donnees, entree_id, cree_le, maj_le) VALUES (?, ?, ?, ?, ?, 'brouillon', ?, ?, ?, ?)")
            .run(id, ctx.household(c).id, b.bien_id, b.bail_id ?? null, b.type, JSON.stringify(b.donnees), b.entree_id ?? null, now(), now());
        return c.json(vue(db, getDoc(db, id)), 201);
    });
    api.put("/locatif/documents/:id", async (c) => {
        const d = duFoyer(c, c.req.param("id"));
        if (!d)
            return c.json({ error: "introuvable" }, 404);
        if (d.statut !== "brouillon")
            return c.json({ error: "fige", message: "Ce document est déjà envoyé pour signature : annulez-le pour le modifier." }, 409);
        const b = z.object({ donnees: donneesSchema }).parse(await c.req.json());
        db.raw.prepare("UPDATE documents_location SET donnees = ?, maj_le = ? WHERE id = ?").run(JSON.stringify(b.donnees), now(), d.id);
        return c.json(vue(db, getDoc(db, d.id)));
    });
    /** Cancelling: a draft disappears; a document sent for signature is kept as cancelled (its links stop working). */
    api.delete("/locatif/documents/:id", (c) => {
        const d = duFoyer(c, c.req.param("id"));
        if (!d)
            return c.json({ error: "introuvable" }, 404);
        if (d.statut === "signe")
            return c.json({ error: "signe", message: "Un document signé se garde : il est rangé dans vos papiers." }, 409);
        if (d.statut === "brouillon")
            db.raw.prepare("DELETE FROM documents_location WHERE id = ?").run(d.id);
        else {
            db.raw.prepare("UPDATE documents_location SET statut = 'annule', maj_le = ? WHERE id = ?").run(now(), d.id);
            db.raw.prepare("UPDATE signatures_location SET jeton = NULL WHERE doc_id = ?").run(d.id);
        }
        return c.json({ ok: true });
    });
    api.get("/locatif/documents/:id/pdf", async (c) => {
        const d = duFoyer(c, c.req.param("id"));
        if (!d)
            return c.json({ error: "introuvable" }, 404);
        const buf = d.fichier ? await readFile(join(ctx.uploadDir, basename(d.fichier))).catch(() => null) : null;
        const pdf = buf ?? await pdfDocument(contenu(db, d), sigPdf(signatures(db, d.id)), d.empreinte ? { id: d.id, empreinte: d.empreinte } : undefined);
        return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": "inline", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    });
    /** Freezes the text and opens the signatures: the landlord's, and one personal link per tenant. */
    api.post("/locatif/documents/:id/envoyer", async (c) => {
        const d = duFoyer(c, c.req.param("id"));
        if (!d)
            return c.json({ error: "introuvable" }, 404);
        if (d.statut !== "brouillon")
            return c.json({ error: "deja", message: "Ce document est déjà envoyé." }, 409);
        const b = z.object({ envoyer_email: z.boolean().default(true) }).parse(await c.req.json().catch(() => ({})));
        const donnees = JSON.parse(d.donnees);
        const bailleur = d.type === "bail" ? donnees.bailleur.nom : donnees.bailleur;
        const locs = d.type === "bail"
            ? donnees.locataires.map((l) => ({ nom: l.nom, email: l.email ?? null }))
            : (donnees.locataires).map((nom, i) => ({ nom, email: donnees.emails?.[i] ?? null }));
        if (!locs.length || locs.some((l) => !l.nom.trim()))
            return c.json({ error: "locataire", message: "Indiquez le nom de chaque locataire." }, 400);
        const c0 = contenu(db, d);
        db.raw.prepare("UPDATE documents_location SET statut = 'a_signer', empreinte = ?, maj_le = ? WHERE id = ?").run(empreinte(c0), now(), d.id);
        db.raw.prepare("INSERT INTO signatures_location (id, doc_id, household_id, role, nom, email, cree_le) VALUES (?, ?, ?, 'bailleur', ?, ?, ?)").run(randomUUID(), d.id, d.household_id, bailleur, ctx.email(c), now());
        const liens = [];
        for (const l of locs) {
            const jeton = randomBytes(24).toString("base64url");
            db.raw.prepare("INSERT INTO signatures_location (id, doc_id, household_id, role, nom, email, jeton, cree_le) VALUES (?, ?, ?, 'locataire', ?, ?, ?, ?)").run(randomUUID(), d.id, d.household_id, l.nom, l.email, cleJeton(jeton), now());
            const lien = `${ctx.publicUrl()}/#/signer/${jeton}`;
            let envoye = false;
            if (b.envoyer_email && l.email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(l.email)) {
                envoye = await envoyerEmail({ to: l.email, subject: `${bailleur} vous propose de signer : ${c0.titre.toLowerCase()}`,
                    text: `Bonjour ${l.nom},\n\n${bailleur} vous propose de lire et de signer en ligne le document suivant : ${c0.titre.toLowerCase()} (${c0.sous_titre}).\n\nLire et signer : ${lien}\n\nCe lien vous est personnel. Une fois toutes les signatures recueillies, vous pourrez y télécharger le document signé.\n\nLucien, pour le compte de ${bailleur}` }).catch(() => false);
            }
            liens.push({ nom: l.nom, email: l.email, lien, envoye });
        }
        return c.json({ ...vue(db, getDoc(db, d.id)), liens });
    });
    /** The landlord signs in the app. */
    api.post("/locatif/documents/:id/signer", async (c) => {
        const d = duFoyer(c, c.req.param("id"));
        if (!d)
            return c.json({ error: "introuvable" }, 404);
        if (d.statut !== "a_signer")
            return c.json({ error: "statut", message: "Envoyez d'abord le document pour signature." }, 409);
        const b = z.object({ image: imageSchema, accepte: z.literal(true) }).parse(await c.req.json());
        const s = signatures(db, d.id).find((x) => x.role === "bailleur" && !x.signe_le);
        if (!s)
            return c.json({ error: "deja", message: "Vous avez déjà signé." }, 409);
        db.raw.prepare("UPDATE signatures_location SET signe_le = ?, ip = ?, user_agent = ?, image = ? WHERE id = ?").run(now(), ipDe(c), (c.req.header("user-agent") ?? "").slice(0, 300), b.image, s.id);
        await finaliser(db, d, ctx.uploadDir);
        return c.json(vue(db, getDoc(db, d.id)));
    });
    // ---------- public: the tenant's personal link ----------
    const parJeton = (jeton) => {
        const s = db.raw.prepare("SELECT * FROM signatures_location WHERE jeton = ?").get(cleJeton(jeton));
        const d = s ? getDoc(db, s.doc_id) : undefined;
        return s && d && d.statut !== "annule" ? { s, d } : null;
    };
    api.get("/signature/p/:jeton", (c) => {
        const r = parJeton(c.req.param("jeton"));
        if (!r)
            return c.json({ error: "introuvable", message: "Ce lien de signature n'est plus valable." }, 404);
        const ct = contenu(db, r.d);
        return c.json({ titre: ct.titre, sous_titre: ct.sous_titre, sections: ct.sections, statut: r.d.statut, moi: { nom: r.s.nom, signe_le: r.s.signe_le },
            signatures: signatures(db, r.d.id).map((x) => ({ role: x.role, nom: x.nom, signe_le: x.signe_le })), empreinte: r.d.empreinte });
    });
    api.get("/signature/p/:jeton/pdf", async (c) => {
        const r = parJeton(c.req.param("jeton"));
        if (!r)
            return c.json({ error: "introuvable" }, 404);
        const buf = r.d.fichier ? await readFile(join(ctx.uploadDir, basename(r.d.fichier))).catch(() => null) : null;
        const pdf = buf ?? await pdfDocument(contenu(db, r.d), sigPdf(signatures(db, r.d.id)));
        return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": "inline", "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
    });
    api.post("/signature/p/:jeton/signer", async (c) => {
        const r = parJeton(c.req.param("jeton"));
        if (!r)
            return c.json({ error: "introuvable", message: "Ce lien de signature n'est plus valable." }, 404);
        if (r.s.signe_le)
            return c.json({ error: "deja", message: "Vous avez déjà signé ce document." }, 409);
        if (r.d.statut !== "a_signer")
            return c.json({ error: "statut", message: "Ce document n'est pas ouvert à la signature." }, 409);
        const b = z.object({ image: imageSchema, accepte: z.literal(true), empreinte: z.string() }).parse(await c.req.json());
        if (b.empreinte !== r.d.empreinte)
            return c.json({ error: "modifie", message: "Le document a changé depuis votre lecture : rechargez la page." }, 409);
        db.raw.prepare("UPDATE signatures_location SET signe_le = ?, ip = ?, user_agent = ?, image = ? WHERE id = ?").run(now(), ipDe(c), (c.req.header("user-agent") ?? "").slice(0, 300), b.image, r.s.id);
        await finaliser(db, getDoc(db, r.d.id), ctx.uploadDir);
        return c.json({ ok: true, statut: getDoc(db, r.d.id).statut });
    });
}
