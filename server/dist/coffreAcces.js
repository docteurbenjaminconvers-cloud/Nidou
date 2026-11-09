/**
 * The coffre-fort: the most sensitive papers (identity, health, taxes, bank) open only after a fresh check of who
 * is holding the phone — Face ID / fingerprint / Windows Hello (a passkey) or a 6-digit code sent by email — and
 * stay open 10 minutes. Every opening is written in a journal the household can read. Until then, their file, full
 * text and numbers are hidden (the title, the organisation and the dates stay visible, so reminders keep working).
 */
import { createHash, randomInt, randomUUID } from "node:crypto";
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse } from "@simplewebauthn/server";
import { sessionToken } from "./auth.js";
import { envoyerEmail } from "./mail.js";
import { etatCoffre } from "./coffre.js";
export const CATEGORIES_COFFRE = ["identite", "sante", "impots", "banque"];
export const estAuCoffre = (d) => CATEGORIES_COFFRE.includes(d.category);
const DUREE_MIN = 10;
const h256 = (s) => createHash("sha256").update(s).digest("hex");
export function ensureCoffreSchema(db) {
    db.raw.exec(`
    CREATE TABLE IF NOT EXISTS coffre_ouvertures (session TEXT PRIMARY KEY, jusqu_au TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS coffre_codes (session TEXT PRIMARY KEY, code TEXT NOT NULL, expire_le TEXT NOT NULL, essais INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS coffre_defis (session TEXT PRIMARY KEY, defi TEXT NOT NULL, expire_le TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE, cle_publique TEXT NOT NULL, compteur INTEGER NOT NULL DEFAULT 0, transports TEXT, appareil TEXT, cree_le TEXT NOT NULL, utilisee_le TEXT);
    CREATE TABLE IF NOT EXISTS coffre_journal (id TEXT PRIMARY KEY, household_id TEXT NOT NULL, user_id TEXT, qui TEXT, document_id TEXT, titre TEXT, action TEXT NOT NULL, quand TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS coffre_journal_foyer ON coffre_journal(household_id, quand);
  `);
}
/** Masks a number (contract, IBAN, tax or social security number): only the last 4 characters stay. */
export const masquer = (v) => (v ? (v.replace(/\s/g, "").length <= 4 ? "••••" : `•••• ${v.replace(/\s/g, "").slice(-4)}`) : v);
/** Is the coffre open for this request's session? Without accounts (local test instance), there is no lock. */
export function coffreOuvert(db, c) {
    if (process.env.LUCIEN_AUTH !== "1")
        return true;
    const t = sessionToken(c.req.header("cookie"));
    if (!t)
        return false;
    ensureCoffreSchema(db);
    const r = db.raw.prepare("SELECT jusqu_au FROM coffre_ouvertures WHERE session = ?").get(h256(t));
    return !!r && r.jusqu_au > new Date().toISOString();
}
export function coffreJusquA(db, c) {
    const t = sessionToken(c.req.header("cookie"));
    if (!t)
        return null;
    ensureCoffreSchema(db);
    const r = db.raw.prepare("SELECT jusqu_au FROM coffre_ouvertures WHERE session = ?").get(h256(t));
    return r && r.jusqu_au > new Date().toISOString() ? r.jusqu_au : null;
}
export function journaliser(db, o) {
    ensureCoffreSchema(db);
    db.raw.prepare("INSERT INTO coffre_journal (id, household_id, user_id, qui, document_id, titre, action, quand) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), o.householdId, o.user?.id ?? null, o.user?.prenom ?? o.user?.email ?? null, o.doc?.id ?? null, o.doc?.title ?? null, o.action, new Date().toISOString());
}
/** A paper of the coffre as the lists show it while the coffre is closed: no full text, numbers masked. */
export const docVerrouille = (d) => ({ ...d, numero_contrat: masquer(d.numero_contrat), texte: null, au_coffre: true, verrouille: true });
export function monterCoffre(api, db, ctx) {
    ensureCoffreSchema(db);
    const rp = (c) => {
        const url = new URL(process.env.LUCIEN_PUBLIC_URL ?? new URL(c.req.url).origin);
        return { rpID: url.hostname, origin: url.origin };
    };
    const session = (c) => { const t = sessionToken(c.req.header("cookie")); return t ? h256(t) : null; };
    const ouvrir = (c, via) => {
        const s = session(c);
        const jusqu = new Date(Date.now() + DUREE_MIN * 60_000).toISOString();
        db.raw.prepare("INSERT INTO coffre_ouvertures (session, jusqu_au) VALUES (?, ?) ON CONFLICT(session) DO UPDATE SET jusqu_au = excluded.jusqu_au").run(s, jusqu);
        journaliser(db, { householdId: ctx.household(c).id, user: ctx.user(c), action: `ouverture du coffre (${via})` });
        return jusqu;
    };
    const exigerCompte = (c) => (!ctx.user(c) || !session(c) ? c.json({ error: "connexion", message: "Connectez-vous pour ouvrir le coffre." }, 401) : null);
    api.get("/coffre", (c) => {
        const u = ctx.user(c);
        const cles = u ? db.raw.prepare("SELECT id, appareil, cree_le, utilisee_le FROM passkeys WHERE user_id = ? ORDER BY cree_le").all(u.id) : [];
        return c.json({ chiffrement: etatCoffre().chiffrement, categories: CATEGORIES_COFFRE, ouvert: coffreOuvert(db, c), jusqu_au: coffreJusquA(db, c), verrou: process.env.LUCIEN_AUTH === "1", passkeys: cles, duree_minutes: DUREE_MIN });
    });
    api.post("/coffre/fermer", (c) => {
        const s = session(c);
        if (s)
            db.raw.prepare("DELETE FROM coffre_ouvertures WHERE session = ?").run(s);
        return c.json({ ok: true });
    });
    /** Code by email: 6 digits, 10 minutes, 5 tries. */
    api.post("/coffre/code", async (c) => {
        const refus = exigerCompte(c);
        if (refus)
            return refus;
        const u = ctx.user(c), s = session(c);
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        db.raw.prepare("INSERT INTO coffre_codes (session, code, expire_le, essais) VALUES (?, ?, ?, 0) ON CONFLICT(session) DO UPDATE SET code = excluded.code, expire_le = excluded.expire_le, essais = 0")
            .run(s, h256(`${s}:${code}`), new Date(Date.now() + 10 * 60_000).toISOString());
        await envoyerEmail({ to: u.email, subject: `${code} : votre code pour ouvrir le coffre Lucien`, text: `Bonjour${u.prenom ? ` ${u.prenom}` : ""},\n\nVotre code pour ouvrir le coffre de Lucien : ${code}\n\nIl est valable 10 minutes. Si vous n'avez rien demandé, ignorez ce message : sans ce code, personne n'ouvre vos papiers les plus sensibles.\n\nLucien` });
        return c.json({ ok: true, a: u.email });
    });
    api.post("/coffre/code/verifier", async (c) => {
        const refus = exigerCompte(c);
        if (refus)
            return refus;
        const s = session(c);
        const { code } = (await c.req.json().catch(() => ({})));
        const r = db.raw.prepare("SELECT code, expire_le, essais FROM coffre_codes WHERE session = ?").get(s);
        if (!r || r.expire_le < new Date().toISOString())
            return c.json({ error: "code", message: "Code expiré : demandez-en un nouveau." }, 400);
        if (r.essais >= 5)
            return c.json({ error: "code", message: "Trop d'essais : demandez un nouveau code." }, 429);
        if (h256(`${s}:${String(code ?? "").trim()}`) !== r.code) {
            db.raw.prepare("UPDATE coffre_codes SET essais = essais + 1 WHERE session = ?").run(s);
            return c.json({ error: "code", message: "Ce code n'est pas le bon." }, 400);
        }
        db.raw.prepare("DELETE FROM coffre_codes WHERE session = ?").run(s);
        return c.json({ ok: true, jusqu_au: ouvrir(c, "code par email") });
    });
    /** Passkey (Face ID, fingerprint, Windows Hello): registered once per device, from an open coffre. */
    api.post("/coffre/passkey/options-enregistrement", async (c) => {
        const refus = exigerCompte(c);
        if (refus)
            return refus;
        if (!coffreOuvert(db, c))
            return c.json({ error: "coffre", message: "Ouvrez d'abord le coffre avec le code reçu par email." }, 423);
        const u = ctx.user(c);
        const existantes = db.raw.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?").all(u.id);
        const o = await generateRegistrationOptions({
            rpName: "Lucien", rpID: rp(c).rpID, userName: u.email, userDisplayName: u.prenom ?? u.email,
            userID: new TextEncoder().encode(u.id), attestationType: "none",
            excludeCredentials: existantes.map((x) => ({ id: x.credential_id, transports: x.transports ? JSON.parse(x.transports) : undefined })),
            authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
        });
        db.raw.prepare("INSERT INTO coffre_defis (session, defi, expire_le) VALUES (?, ?, ?) ON CONFLICT(session) DO UPDATE SET defi = excluded.defi, expire_le = excluded.expire_le").run(session(c), o.challenge, new Date(Date.now() + 5 * 60_000).toISOString());
        return c.json(o);
    });
    api.post("/coffre/passkey/enregistrer", async (c) => {
        const refus = exigerCompte(c);
        if (refus)
            return refus;
        const u = ctx.user(c), s = session(c);
        const { reponse, appareil } = (await c.req.json());
        const d = db.raw.prepare("SELECT defi, expire_le FROM coffre_defis WHERE session = ?").get(s);
        if (!d || d.expire_le < new Date().toISOString())
            return c.json({ error: "passkey", message: "Délai dépassé, recommencez." }, 400);
        try {
            const v = await verifyRegistrationResponse({ response: reponse, expectedChallenge: d.defi, expectedOrigin: rp(c).origin, expectedRPID: rp(c).rpID, requireUserVerification: true });
            if (!v.verified || !v.registrationInfo)
                throw new Error("non vérifiée");
            const cred = v.registrationInfo.credential;
            db.raw.prepare("INSERT INTO passkeys (id, user_id, credential_id, cle_publique, compteur, transports, appareil, cree_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
                .run(randomUUID(), u.id, cred.id, Buffer.from(cred.publicKey).toString("base64url"), cred.counter, JSON.stringify(cred.transports ?? reponse?.response?.transports ?? []), String(appareil ?? "").slice(0, 60) || null, new Date().toISOString());
            db.raw.prepare("DELETE FROM coffre_defis WHERE session = ?").run(s);
            journaliser(db, { householdId: ctx.household(c).id, user: u, action: `déverrouillage biométrique ajouté${appareil ? ` (${String(appareil).slice(0, 60)})` : ""}` });
            return c.json({ ok: true }, 201);
        }
        catch (e) {
            return c.json({ error: "passkey", message: `Enregistrement refusé : ${e.message}` }, 400);
        }
    });
    api.delete("/coffre/passkey/:id", (c) => {
        const u = ctx.user(c);
        if (!u)
            return c.json({ error: "connexion" }, 401);
        db.raw.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ?").run(c.req.param("id"), u.id);
        journaliser(db, { householdId: ctx.household(c).id, user: u, action: "déverrouillage biométrique retiré" });
        return c.json({ ok: true });
    });
    api.post("/coffre/passkey/options", async (c) => {
        const refus = exigerCompte(c);
        if (refus)
            return refus;
        const u = ctx.user(c);
        const cles = db.raw.prepare("SELECT credential_id, transports FROM passkeys WHERE user_id = ?").all(u.id);
        if (!cles.length)
            return c.json({ error: "passkey", message: "Aucun déverrouillage biométrique sur ce compte." }, 404);
        const o = await generateAuthenticationOptions({ rpID: rp(c).rpID, userVerification: "required", allowCredentials: cles.map((x) => ({ id: x.credential_id, transports: x.transports ? JSON.parse(x.transports) : undefined })) });
        db.raw.prepare("INSERT INTO coffre_defis (session, defi, expire_le) VALUES (?, ?, ?) ON CONFLICT(session) DO UPDATE SET defi = excluded.defi, expire_le = excluded.expire_le").run(session(c), o.challenge, new Date(Date.now() + 5 * 60_000).toISOString());
        return c.json(o);
    });
    api.post("/coffre/passkey/verifier", async (c) => {
        const refus = exigerCompte(c);
        if (refus)
            return refus;
        const u = ctx.user(c), s = session(c);
        const { reponse } = (await c.req.json());
        const d = db.raw.prepare("SELECT defi, expire_le FROM coffre_defis WHERE session = ?").get(s);
        const k = db.raw.prepare("SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?").get(String(reponse?.id ?? ""), u.id);
        if (!d || d.expire_le < new Date().toISOString() || !k)
            return c.json({ error: "passkey", message: "Déverrouillage refusé, recommencez ou utilisez le code par email." }, 400);
        try {
            const v = await verifyAuthenticationResponse({
                response: reponse, expectedChallenge: d.defi, expectedOrigin: rp(c).origin, expectedRPID: rp(c).rpID, requireUserVerification: true,
                credential: { id: k.credential_id, publicKey: new Uint8Array(Buffer.from(k.cle_publique, "base64url")), counter: k.compteur, transports: k.transports ? JSON.parse(k.transports) : undefined },
            });
            if (!v.verified)
                throw new Error("non vérifiée");
            db.raw.prepare("UPDATE passkeys SET compteur = ?, utilisee_le = ? WHERE id = ?").run(v.authenticationInfo.newCounter, new Date().toISOString(), k.id);
            db.raw.prepare("DELETE FROM coffre_defis WHERE session = ?").run(s);
            return c.json({ ok: true, jusqu_au: ouvrir(c, "Face ID / empreinte") });
        }
        catch {
            return c.json({ error: "passkey", message: "Déverrouillage refusé, recommencez ou utilisez le code par email." }, 400);
        }
    });
    /** Who opened what, for the household (last 100). */
    api.get("/coffre/journal", (c) => {
        ensureCoffreSchema(db);
        return c.json(db.raw.prepare("SELECT qui, titre, action, quand FROM coffre_journal WHERE household_id = ? ORDER BY quand DESC LIMIT 100").all(ctx.household(c).id));
    });
}
