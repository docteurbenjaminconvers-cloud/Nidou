import type { Db } from "./db.js";
import * as V from "./veille.js";
import { envoyerEmail } from "./mail.js";
import { envoyerPush } from "./push.js";
import { bridgeConfig, BridgeClient, mapTransactions, syncHousehold } from "./bridge.js";
import { ebConfig, EbClient, ebSyncHousehold, mapEbTransactions } from "./enablebanking.js";
import { ebSynchroSup, ensureConnexionsSchema, listConnexions } from "./connexions.js";
import { dedoublonnerComptes } from "./doublons.js";

/**
 * Which bank connector runs: Enable Banking when its keys are set (billed per connected account, calls included),
 * otherwise Bridge, otherwise the simulated bank. LUCIEN_BANQUE=bridge forces Bridge when both are configured.
 */
export type Fournisseur = "enablebanking" | "bridge" | "simule";
export function fournisseur(): Fournisseur {
  const force = process.env.LUCIEN_BANQUE;
  if (force === "bridge" && bridgeConfig()) return "bridge";
  if (ebConfig()) return "enablebanking";
  if (bridgeConfig()) return "bridge";
  return "simule";
}
export const eb = () => { const cfg = ebConfig(); return cfg ? new EbClient(cfg) : null; };
export const bridge = () => { const cfg = bridgeConfig(); return cfg ? { cfg, client: new BridgeClient(cfg) } : null; };

/** Same alert to the aidant's devices and, by email, to every witness. */
export async function notifierAlertes(db: Db, v: V.VeilleRow, nouvelles: V.Alerte[]) {
  if (!nouvelles.length) return;
  const m = db.getMember(v.member_id)!;
  const urgent = nouvelles.some((a) => a.gravite === "urgente");
  const titre = `${urgent ? "Alerte" : "À vérifier"} sur le compte de ${m.prenom}`;
  const corps = nouvelles.map((a) => `• ${a.titre}`).join("\n");
  await envoyerPush(db, v.household_id, { titre, corps: nouvelles[0].titre, url: `/#/veille/${v.id}`, tag: `veille-${v.id}` });
  for (const t of JSON.parse(v.temoins) as V.Temoin[]) if (t.email) await envoyerEmail({ to: t.email, subject: titre, text: `${corps}\n\nVous recevez ces alertes en tant que témoin désigné par ${v.aidant_nom}, avec l'accord de ${m.prenom}. Lucien ne voit le compte qu'en lecture.` });
}

/** Pulls the protected person's operations (read only) and raises alerts. `bridge_user_uuid` holds "eb:<session>" for Enable Banking. */
export async function synchroniserVeille(db: Db, v: V.VeilleRow) {
  if (v.statut !== "active" || !v.bridge_user_uuid || v.bridge_user_uuid.startsWith("attente:")) return;
  let ops: V.OperationVeille[] = [];
  if (v.bridge_user_uuid.startsWith("eb:")) {
    const c = eb(); if (!c) return;
    const s = await c.session(v.bridge_user_uuid.slice(3));
    if (s.access?.valid_until && new Date(s.access.valid_until).getTime() < Date.now()) {
      V.setBanque(db, v, { banque_connectee: 0 });
      V.journaliser(db, v.id, "Banque", "autorisation_expiree", {});
      return;
    }
    const derniere = db.raw.prepare("SELECT MAX(date) d FROM veille_operations WHERE veille_id = ?").get(v.id) as { d: string | null };
    const from = derniere.d ? new Date(new Date(derniere.d).getTime() - 3 * 864e5).toISOString().slice(0, 10) : new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    for (const a of s.accounts ?? []) {
      const uid = typeof a === "string" ? a : a.uid;
      ops.push(...mapEbTransactions(await c.transactions(uid, from), "").map((t) => ({ date: t.date, libelle: t.libelle, montant: t.montant })));
    }
  } else {
    const b = bridge(); if (!b) return;
    const { access_token } = await b.client.userToken(v.bridge_user_uuid);
    const accounts = await b.client.accounts(access_token);
    const names = new Map(accounts.map((a) => [String(a.id), a.name]));
    ops = mapTransactions(await b.client.transactions(access_token, null), names).map((t) => ({ date: t.date, libelle: t.libelle, montant: t.montant }));
  }
  const r = V.ajouterOperations(db, v, ops);
  await notifierAlertes(db, v, r.nouvelles);
}

/** Household sync with whichever connector holds the link. */
async function synchroniserLienPrincipal(db: Db, householdId: string) {
  const link = db.getBankLink(householdId);
  if (!link) return null;
  if (link.fournisseur === "enablebanking") { const c = eb(); if (!c) throw new Error("Enable Banking n'est pas configuré"); return ebSyncHousehold(db, c, householdId); }
  const b = bridge(); if (!b) throw new Error("Bridge n'est pas configuré");
  return syncHousehold(db, b.client, householdId);
}

/** Household sync: the main link, then every extra bank (another personal bank, professional accounts). */
export async function synchroniserFoyer(db: Db, householdId: string) {
  const sups = listConnexions(db, householdId).filter((c) => c.fournisseur === "enablebanking" && c.statut !== "en_attente");
  if (!db.getBankLink(householdId) && !sups.length) throw new Error("Aucune connexion bancaire pour ce foyer");
  await dedoublonnerComptes(db, eb(), householdId).catch((e) => console.error("[banque] doublons :", (e as Error).message));
  const r = (await synchroniserLienPrincipal(db, householdId)) ?? { comptes: 0, lues: 0, ajoutees: 0, derniere_synchro: new Date().toISOString() };
  const client = eb();
  const erreurs: string[] = [];
  for (const c of sups) {
    if (!client) break;
    try { const x = await ebSynchroSup(db, client, c); r.comptes += x.comptes; r.lues += x.lues; r.ajoutees += x.ajoutees; }
    catch (e) { erreurs.push((e as Error).message); console.error("[banque]", c.banque, (e as Error).message); }
  }
  if (erreurs.length && !r.comptes) throw new Error(erreurs[0]);
  return r;
}

/**
 * Enable Banking has no account webhook: Lucien fetches every 6 hours (PSD2 allows four unattended fetches a day).
 * Bridge pushes `item.refreshed` webhooks instead, so only Enable Banking links are polled here.
 */
export async function tacheBanques(db: Db): Promise<{ foyers: number; veilles: number; erreurs: number }> {
  if (!ebConfig()) return { foyers: 0, veilles: 0, erreurs: 0 };
  let foyers = 0, veilles = 0, erreurs = 0;
  ensureConnexionsSchema(db);
  const links = db.raw.prepare("SELECT household_id FROM bank_links WHERE fournisseur = 'enablebanking' AND statut = 'connecte' UNION SELECT household_id FROM bank_connexions WHERE fournisseur = 'enablebanking' AND statut = 'connecte'").all() as { household_id: string }[];
  for (const l of links) { try { await synchroniserFoyer(db, l.household_id); foyers++; } catch (e) { erreurs++; console.error("[banque]", l.household_id, (e as Error).message); } }
  const vs = db.raw.prepare("SELECT * FROM veilles WHERE statut = 'active' AND bridge_user_uuid LIKE 'eb:%'").all() as unknown as V.VeilleRow[];
  for (const v of vs) { try { await synchroniserVeille(db, v); veilles++; } catch (e) { erreurs++; console.error("[veille banque]", v.id, (e as Error).message); } }
  return { foyers, veilles, erreurs };
}

export function demarrerSynchroBanques(db: Db) {
  const tick = () => tacheBanques(db).catch((e) => console.error("[banques]", e));
  setTimeout(tick, 60_000);
  const t = setInterval(tick, 6 * 3600_000);
  (t as { unref?: () => void }).unref?.();
}
