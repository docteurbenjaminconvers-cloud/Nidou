import { envoyerEmail } from "./mail.js";
/**
 * Accounts without passwords: a magic link by email. The same mechanism carries invitations to join a household.
 * LUCIEN_AUTH=0 keeps the single-household prototype mode (no login) for local development and the demo seed.
 */
export const AUTH_ON = () => process.env.LUCIEN_AUTH !== "0";
export const COOKIE = "lucien_session";
/** Cookie de session de l'ancien nom (Nidou) : encore lu, pour ne déconnecter personne au changement de nom. */
export const ANCIEN_COOKIE = "nidou_session";
const publicUrl = () => (process.env.LUCIEN_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
/**
 * The login link may be handed back to the browser only in local development: no email service configured and no
 * public https address. In production a link that could not be emailed is never returned (otherwise anyone could
 * open someone else's account by asking for their link while the email service is down or over quota).
 */
export const lienVisibleEnDev = () => !process.env.BREVO_API_KEY && !(process.env.LUCIEN_PUBLIC_URL ?? "").startsWith("https://");
/** Requests for a login link: at most 3 per address and 10 per network address every 15 minutes (in memory). */
const FENETRE_MS = 15 * 60 * 1000;
const demandes = new Map();
export function demandeAutorisee(cle, max, maintenant = Date.now()) {
    const recentes = (demandes.get(cle) ?? []).filter((t) => maintenant - t < FENETRE_MS);
    if (recentes.length >= max) {
        demandes.set(cle, recentes);
        return false;
    }
    recentes.push(maintenant);
    demandes.set(cle, recentes);
    if (demandes.size > 50_000)
        for (const [k, v] of demandes)
            if (!v.some((t) => maintenant - t < FENETRE_MS))
                demandes.delete(k);
    return true;
}
export const oublierDemandes = () => demandes.clear();
export const emailValide = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
/** Login link. Returns the link itself only in local development (see lienVisibleEnDev), so the UI can show it. */
export async function demanderLien(db, email, opts = {}) {
    const token = db.createAuthLink(email, { household_id: opts.household_id ?? null, prenom: opts.prenom ?? null, invite_par: opts.invite_par ?? null, ttlMinutes: opts.household_id ? 7 * 24 * 60 : 30 });
    const lien = `${publicUrl()}/api/auth/lien?token=${token}`;
    const invitation = Boolean(opts.household_id);
    const h = opts.household_id ? db.getHousehold(opts.household_id) : null;
    const envoye = await envoyerEmail({
        to: email,
        subject: invitation ? `${opts.invite_par ?? "Un proche"} vous invite dans le foyer « ${h?.nom ?? "famille"} »` : "Votre lien de connexion Lucien",
        text: invitation
            ? `${opts.invite_par ?? "Un proche"} partage avec vous les papiers, les échéances et le budget de « ${h?.nom}» sur Lucien.\n\nRejoindre le foyer : ${lien}\n\nCe lien est valable 7 jours.`
            : `Bonjour,\n\nVoici votre lien pour ouvrir Lucien : ${lien}\n\nIl est valable 30 minutes et ne sert qu'une fois. Si vous n'avez rien demandé, ignorez cet email.`,
    });
    return { envoye, lien: !envoye && lienVisibleEnDev() ? lien : null };
}
/** Consumes a link: creates the account if needed, joins or creates the household, opens a session. */
export function consommerLien(db, token, trialDays) {
    const l = db.getAuthLink(token);
    if (!l)
        return { ok: false, raison: "invalide" };
    if (l.utilise_le)
        return { ok: false, raison: "utilise" };
    if (l.expire_le < new Date().toISOString())
        return { ok: false, raison: "expire" };
    db.useAuthLink(token);
    const user = db.userByEmail(l.email) ?? db.createUser(l.email, l.prenom);
    if (l.prenom && !user.prenom)
        db.raw.prepare("UPDATE users SET prenom = ? WHERE id = ?").run(l.prenom, user.id);
    let household;
    if (l.household_id) {
        household = db.getHousehold(l.household_id);
        if (household) {
            db.joinHousehold(household.id, user.id, "membre");
            if (l.prenom && !db.listMembers(household.id).some((m) => m.prenom.toLowerCase() === l.prenom.toLowerCase()))
                db.addMember(household.id, l.prenom, "adulte");
        }
    }
    if (!household)
        household = db.householdsOfUser(user.id)[0];
    if (!household) {
        household = db.createHousehold(user.prenom ? `Famille de ${user.prenom}` : "Ma famille", trialDays);
        db.addMember(household.id, user.prenom ?? "Moi", "adulte");
        db.joinHousehold(household.id, user.id, "proprietaire");
    }
    return { ok: true, user, household, session: db.createSession(user.id) };
}
export function cookieHeader(session, secure) {
    const base = `${COOKIE}=${session ?? ""}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
    return session ? `${base}; Max-Age=${90 * 86400}` : `${base}; Max-Age=0`;
}
export function readCookie(header, name) {
    const m = (header ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    return m ? decodeURIComponent(m[1]) : null;
}
/** Jeton de session : cookie actuel, sinon celui de l'ancien nom. */
export const sessionToken = (header) => readCookie(header, COOKIE) ?? readCookie(header, ANCIEN_COOKIE);
