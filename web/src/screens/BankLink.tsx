import { useEffect, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import type { Banque, BankStatus, DestinationCompte, Household } from "../types";
import { BankPicker } from "../BankPicker";
import { fmtEuro } from "../ui";
import { VerifProCarte } from "./VerifPro";

/**
 * « Connecter un compte professionnel » : the bank's business login (Qonto, Shine, offre pro d'une banque).
 * The account then stays out of the family budget and feeds Vie pro.
 */
export function ConnecterPro({ api, onFait, toast, libelle = "Connecter le compte pro" }: { api: Api; onFait: () => void; toast: (m: string) => void; libelle?: string }) {
  const [banques, setBanques] = useState<Banque[] | null>(null);
  const [busy, setBusy] = useState(false);
  const choisir = async (b: Banque) => {
    setBusy(true);
    try {
      const r = await api.bankConnect("", b, "pro");
      if (r.url && r.url.startsWith("http")) { location.href = r.url; return; }
      toast(`${b.name} connecté : compte pro tenu à part du budget du foyer`); setBanques(null); onFait();
    } catch (e) { toast(e instanceof ApiError ? e.message : "La connexion a échoué. Réessayez dans un instant."); }
    finally { setBusy(false); }
  };
  if (banques) return (
    <div className="connecter-pro">
      <p className="note" style={{ margin: "6px 0" }}>Choisissez la banque du compte professionnel : vous vous connecterez avec vos identifiants « pro ».</p>
      <BankPicker banques={banques} busy={busy} onPick={choisir} />
      <button className="link" style={{ marginTop: 6 }} onClick={() => setBanques(null)}>Annuler</button>
    </div>
  );
  return <button className="pill" disabled={busy} onClick={async () => { setBusy(true); try { setBanques((await api.banques("pro")).banques); } catch { toast("La liste des banques n'a pas pu être chargée."); } finally { setBusy(false); } }}>{busy ? "Chargement…" : libelle}</button>;
}

/** "Connecter ma banque" block: Bridge Connect in production, simulated bank in the demo. */
export function BankLink({ api, household, onChanged, onUpgrade, toast, compact }: {
  api: Api; household: Household; onChanged: () => void; onUpgrade: () => void; toast: (m: string) => void; compact?: boolean;
}) {
  const [status, setStatus] = useState<BankStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [email, setEmail] = useState(() => localStorage.getItem("lucien.email") ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [banques, setBanques] = useState<Banque[] | null>(null);

  const load = () => api.bankStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { load(); }, [api, household.plan]); // eslint-disable-line react-hooks/exhaustive-deps

  const connect = async (aspsp?: Banque) => {
    setBusy(true); setErr(null);
    try {
      try { localStorage.setItem("lucien.email", email); } catch {}
      // Enable Banking: Lucien shows the bank list first, then sends the family to its bank's own login page.
      if (!aspsp && status?.fournisseur === "enablebanking") { setBanques((await api.banques()).banques); return; }
      const { url } = await api.bankConnect(email || "famille@example.org", aspsp);
      if (url && url.startsWith("http")) { location.href = url; return; }     // Bridge Connect (real)
      if (url) { await fetch(url, { redirect: "manual" }).catch(() => {}); }     // simulated callback on the server
      toast("Banque connectée : opérations récupérées");
      await load(); onChanged();
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "limite_plan" ? e.message : "La connexion a échoué. Réessayez dans un instant.");
    } finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true);
    try { const r = await api.bankSync(); toast(r.ajoutees ? `${r.ajoutees} nouvelles opérations` : "Rien de nouveau depuis la dernière mise à jour"); await load(); onChanged(); }
    catch { toast("Synchronisation impossible pour le moment"); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    await api.bankDisconnect(); toast("Banque déconnectée"); await load(); onChanged();
  };
  const [ajout, setAjout] = useState(false);
  const ajouterPerso = async () => {
    if (!status?.connecte) { setAjout(false); return connect(); }
    setBusy(true);
    try {
      const liste = (await api.banques("perso")).banques;
      if (liste.length) { setBanques(liste); return; }
      // simulated mode has no list: a second demo bank is added straight away
      await api.bankConnect("", undefined, "perso"); toast("Deuxième banque connectée"); setAjout(false); await load(); onChanged();
    } finally { setBusy(false); }
  };
  const choisirPerso = async (b: Banque) => {
    if (!status?.connecte) return connect(b);
    setBusy(true);
    try {
      const r = await api.bankConnect("", b, "perso");
      if (r.url && r.url.startsWith("http")) { location.href = r.url; return; }
      toast(`${b.name} connectée`); setBanques(null); setAjout(false); await load(); onChanged();
    } finally { setBusy(false); }
  };
  const retirer = async (id: string, banque: string) => {
    await api.supprimerConnexion(id); toast(`${banque} déconnectée`); await load(); onChanged();
  };

  if (!status) return null;

  const expire = status.expire_le ? Math.ceil((new Date(status.expire_le).getTime() - Date.now()) / 864e5) : null;

  if (status.connecte || (status.connexions ?? []).length > 0) {
    const last = status.derniere_synchro ? new Date(status.derniere_synchro).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    return (
      <div className={compact ? "" : "lock"} style={compact ? { marginBottom: 14 } : { marginTop: 0, marginBottom: 14 }}>
        <ComptesDestinations api={api} comptes={status.comptes} derniere={last} toast={toast} onFait={() => { load(); onChanged(); }} />
        {status.comptes.some((a) => a.destination === "pro" && a.confirme) && <VerifProCarte api={api} go={(s) => { location.hash = s; }} />}
        {(status.connexions ?? []).length > 0 && (
          <div className="connexions-sup">
            {(status.connexions ?? []).map((c) => (
              <div key={c.id} className="connexion-sup">
                <span>{c.banque} · {c.usage === "pro" ? "compte professionnel" : "compte personnel"}{c.statut === "erreur" ? " · à reconnecter" : c.statut === "en_attente" ? " · en attente" : ""}</span>
                <button className="link" style={{ color: "var(--mist)" }} onClick={() => retirer(c.id, c.banque)}>Déconnecter</button>
              </div>
            ))}
          </div>
        )}
        {ajout ? (
          <div className="ajout-banque">
            {banques ? <BankPicker banques={banques} busy={busy} onPick={choisirPerso} /> : (
              <div className="pills">
                <button className="pill" disabled={busy} onClick={ajouterPerso}>Un autre compte personnel</button>
                <ConnecterPro api={api} toast={toast} libelle="Un compte professionnel" onFait={() => { setAjout(false); load(); onChanged(); }} />
              </div>
            )}
            <button className="link" style={{ marginTop: 6 }} onClick={() => { setAjout(false); setBanques(null); }}>Annuler</button>
          </div>
        ) : <button className="link" style={{ marginTop: 6 }} onClick={() => setAjout(true)}>+ Ajouter une banque</button>}
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          <button className="link" disabled={busy} onClick={sync}>{busy ? "Mise à jour…" : "Mettre à jour"}</button>
          {status.connecte && <button className="link" style={{ color: "var(--mist)" }} onClick={disconnect}>Déconnecter {status.comptes.find((x) => !x.pro)?.banque ?? "la banque"}</button>}
        </div>
        {expire !== null && expire <= 14 && (
          <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>
            {expire > 0 ? `L'autorisation de votre banque expire dans ${expire} jour${expire > 1 ? "s" : ""}.` : "L'autorisation de votre banque a expiré."} C'est la règle européenne : il suffit de la renouveler.{" "}
            <button className="link" onClick={() => connect()}>Renouveler</button>
          </p>
        )}
        {banques && !ajout && <BankPicker banques={banques} busy={busy} onPick={(b) => connect(b)} />}
        {status.fournisseur === "simule" && <p className="note" style={{ marginTop: 8 }}>Banque de démonstration. En production, la connexion passe par un agrégateur agréé (Enable Banking) et se met à jour chaque jour.</p>}
      </div>
    );
  }

  return (
    <div className="lock" style={{ marginTop: 0, marginBottom: 14 }}>
      <b>Connecter ma banque</b>
      <p>Vos opérations arrivent automatiquement, chaque jour, via un agrégateur agréé par la Banque de France (DSP2). Lucien ne voit jamais vos identifiants bancaires.</p>
      {household.plan === "gratuit" ? (
        <button className="btn" onClick={onUpgrade}>Inclus dans la formule complète</button>
      ) : (
        <>
          {status.fournisseur === "bridge" && <>
            <label className="lbl" htmlFor="bank-email" style={{ marginTop: 0 }}>Email pour le suivi de la connexion</label>
            <input id="bank-email" className="in" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.fr" />
          </>}
          {banques ? <BankPicker banques={banques} busy={busy} onPick={(b) => connect(b)} /> : (
            <div style={{ marginTop: 10 }}>
              <button className="btn block" disabled={busy} onClick={() => connect()}>{busy ? <span className="spinner" /> : "Choisir ma banque"}</button>
            </div>
          )}
          <p className="note" style={{ marginTop: 10 }}>Indépendant ou micro-entrepreneur ? Votre compte pro se connecte à part, il ne se mélange pas au budget du foyer.</p>
          <ConnecterPro api={api} toast={toast} libelle="Connecter un compte professionnel" onFait={() => { load(); onChanged(); }} />
          {err && <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>{err}</p>}
          {status.statut === "erreur" && <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>La dernière synchronisation a échoué. Réessayez, ou reconnectez la banque.</p>}
        </>
      )}
    </div>
  );
}

const DEST: [DestinationCompte, string, string][] = [
  ["foyer", "Budget du foyer", "dépenses, économies, fin de mois"],
  ["pro", "Professionnel", "va dans Vie pro, à part du budget"],
  ["locatif", "Location / SCI", "loyers et charges, à part du budget"],
  ["epargne", "Épargne", "seul le solde compte, dans le bilan"],
  ["ignore", "Ne pas suivre", "aucune opération importée"],
];
const dest = (d: DestinationCompte | undefined) => DEST.find((x) => x[0] === (d ?? "foyer"))!;

/**
 * Each bank account and where it goes. Right after a connection the accounts are « à confirmer »: Lucien has
 * suggested a destination (a company's account to Pro or Location, a savings book to Épargne), the person checks
 * and validates. Later, a change applies at once (« Ne pas suivre » asks first: it removes the imported operations).
 */
function ComptesDestinations({ api, comptes, derniere, toast, onFait }: { api: Api; comptes: BankStatus["comptes"]; derniere: string; toast: (m: string) => void; onFait: () => void }) {
  const [choix, setChoix] = useState<Record<string, DestinationCompte>>({});
  const [busy, setBusy] = useState(false);
  const aConfirmer = comptes.filter((a) => !a.confirme);
  const valeur = (a: BankStatus["comptes"][number]) => choix[a.id] ?? a.destination ?? "foyer";
  const envoyer = async (liste: { id: string; destination: DestinationCompte }[]) => {
    setBusy(true);
    try {
      const r = await api.destinationsComptes(liste);
      toast(r.operations_retirees ? `Enregistré : ${r.operations_retirees} opérations retirées` : "Enregistré");
      setChoix({}); onFait();
    } catch (e) { toast(e instanceof ApiError ? e.message : "Enregistrement impossible, réessayez"); }
    finally { setBusy(false); }
  };
  const changer = (a: BankStatus["comptes"][number], d: DestinationCompte) => {
    if (!a.confirme) { setChoix({ ...choix, [a.id]: d }); return; }
    if (d === "ignore" && !confirm(`Ne plus suivre « ${a.nom} » ? Ses opérations déjà importées seront effacées de Lucien (rien ne change à la banque).`)) return;
    envoyer([{ id: a.id, destination: d }]);
  };
  return (
    <div className="comptes-dest">
      {aConfirmer.length > 0 && (
        <div className="comptes-dest-tete">
          <b>{aConfirmer.length > 1 ? `Où vont vos ${aConfirmer.length} comptes ?` : "Où va ce compte ?"}</b>
          <span>Lucien a fait une proposition pour chacun : vérifiez, corrigez si besoin, puis validez. Seul le « Budget du foyer » compte dans vos dépenses.</span>
        </div>
      )}
      {comptes.map((a) => (
        <div className={`compte-dest ${a.confirme ? "" : "a-confirmer"} ${valeur(a) === "ignore" ? "ignore" : ""}`} key={a.id}>
          <div className="compte-dest-haut">
            <div><div className="t">{a.nom}</div><div className="s">{a.banque ?? "Banque"}{a.confirme ? ` · mis à jour le ${derniere}` : " · à confirmer"}</div></div>
            {a.solde != null && valeur(a) !== "ignore" && <b>{fmtEuro(a.solde, 2)}</b>}
          </div>
          <label className="compte-dest-choix">
            <select className="in" value={valeur(a)} disabled={busy} onChange={(e) => changer(a, e.target.value as DestinationCompte)} aria-label={`Destination de ${a.nom}`}>
              {DEST.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            <span className="note">{dest(valeur(a))[2]}</span>
          </label>
        </div>
      ))}
      {aConfirmer.length > 0 && (
        <>
          {aConfirmer.some((a) => valeur(a) === "ignore") && <p className="note">Les comptes « Ne pas suivre » : leurs opérations déjà importées seront effacées de Lucien (rien ne change à la banque).</p>}
          <button className="btn block" disabled={busy} onClick={() => envoyer(aConfirmer.map((a) => ({ id: a.id, destination: valeur(a) })))}>{busy ? "Enregistrement…" : "Valider"}</button>
        </>
      )}
    </div>
  );
}
