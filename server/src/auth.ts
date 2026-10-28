import type { Db, HouseholdRow, UserRow } from "./db.js";
import { envoyerEmail } from "./mail.js";

/**
 * Accounts without passwords: a magic link by email. The same mechanism carries invitations to join a household.
 * NIDOU_AUTH=0 keeps the single-household prototype mode (no login) for local development and the demo seed.
 */
export const AUTH_ON = () => process.env.NIDOU_AUTH !== "0";
export const COOKIE = "nidou_session";
const publicUrl = () => (process.env.NIDOU_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");

export const emailValide = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

/** Login link. Returns the link itself only when no email transport is configured (dev), so the UI can show it. */
export async function demanderLien(db: Db, email: string, opts: { household_id?: string; prenom?: string | null; invite_par?: string | null } = {}): Promise<{ envoye: boolean; lien: string | null }> {
  const token = db.createAuthLink(email, { household_id: opts.household_id ?? null, prenom: opts.prenom ?? null, invite_par: opts.invite_par ?? null, ttlMinutes: opts.household_id ? 7 * 24 * 60 : 30 });
  const lien = `${publicUrl()}/api/auth/lien?token=${token}`;
  const invitation = Boolean(opts.household_id);
  const h = opts.household_id ? db.getHousehold(opts.household_id) : null;
  const envoye = await envoyerEmail({
    to: email,
    subject: invitation ? `${opts.invite_par ?? "Un proche"} vous invite dans le nid « ${h?.nom ?? "famille"} »` : "Votre lien de connexion Nidou",
    text: invitation
      ? `${opts.invite_par ?? "Un proche"} partage avec vous les papiers, les échéances et le budget de « ${h?.nom}» sur Nidou.\n\nRejoindre le nid : ${lien}\n\nCe lien est valable 7 jours.`
      : `Bonjour,\n\nVoici votre lien pour ouvrir Nidou : ${lien}\n\nIl est valable 30 minutes et ne sert qu'une fois. Si vous n'avez rien demandé, ignorez cet email.`,
  });
  return { envoye, lien: envoye ? null : lien };
}

export type LienResultat = { ok: true; user: UserRow; household: HouseholdRow; session: string } | { ok: false; raison: "invalide" | "expire" | "utilise" };

/** Consumes a link: creates the account if needed, joins or creates the household, opens a session. */
export function consommerLien(db: Db, token: string, trialDays: number): LienResultat {
  const l = db.getAuthLink(token);
  if (!l) return { ok: false, raison: "invalide" };
  if (l.utilise_le) return { ok: false, raison: "utilise" };
  if (l.expire_le < new Date().toISOString()) return { ok: false, raison: "expire" };
  db.useAuthLink(token);
  const user = db.userByEmail(l.email) ?? db.createUser(l.email, l.prenom);
  if (l.prenom && !user.prenom) db.raw.prepare("UPDATE users SET prenom = ? WHERE id = ?").run(l.prenom, user.id);
  let household: HouseholdRow | undefined;
  if (l.household_id) {
    household = db.getHousehold(l.household_id);
    if (household) {
      db.joinHousehold(household.id, user.id, "membre");
      if (l.prenom && !db.listMembers(household.id).some((m) => m.prenom.toLowerCase() === l.prenom!.toLowerCase())) db.addMember(household.id, l.prenom, "adulte");
    }
  }
  if (!household) household = db.householdsOfUser(user.id)[0];
  if (!household) {
    household = db.createHousehold(user.prenom ? `Famille de ${user.prenom}` : "Ma famille", trialDays);
    db.addMember(household.id, user.prenom ?? "Moi", "adulte");
    db.joinHousehold(household.id, user.id, "proprietaire");
  }
  return { ok: true, user, household, session: db.createSession(user.id) };
}

export function cookieHeader(session: string | null, secure: boolean): string {
  const base = `${COOKIE}=${session ?? ""}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
  return session ? `${base}; Max-Age=${90 * 86400}` : `${base}; Max-Age=0`;
}

export function readCookie(header: string | undefined, name: string): string | null {
  const m = (header ?? "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
