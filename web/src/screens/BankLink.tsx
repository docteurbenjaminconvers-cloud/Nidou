import { useEffect, useState } from "react";
import type { Api } from "../api";
import { ApiError } from "../api";
import type { Banque, BankStatus, Household } from "../types";
import { BankPicker } from "../BankPicker";
import { fmtEuro } from "../ui";

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

  if (!status) return null;

  const expire = status.expire_le ? Math.ceil((new Date(status.expire_le).getTime() - Date.now()) / 864e5) : null;

  if (status.connecte) {
    const last = status.derniere_synchro ? new Date(status.derniere_synchro).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
    return (
      <div className={compact ? "" : "lock"} style={compact ? { marginBottom: 14 } : { marginTop: 0, marginBottom: 14 }}>
        {status.comptes.map((a) => (
          <div className="settings-row" key={a.id} style={{ borderBottom: 0, padding: "6px 0" }}>
            <div><div className="t">{a.nom}</div><div className="s">{a.banque ?? "Banque"} · mis à jour le {last}</div></div>
            {a.solde != null && <b>{fmtEuro(a.solde, 2)}</b>}
          </div>
        ))}
        <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
          <button className="link" disabled={busy} onClick={sync}>{busy ? "Mise à jour…" : "Mettre à jour"}</button>
          <button className="link" style={{ color: "var(--mist)" }} onClick={disconnect}>Déconnecter</button>
        </div>
        {expire !== null && expire <= 14 && (
          <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>
            {expire > 0 ? `L'autorisation de votre banque expire dans ${expire} jour${expire > 1 ? "s" : ""}.` : "L'autorisation de votre banque a expiré."} C'est la règle européenne : il suffit de la renouveler.{" "}
            <button className="link" onClick={() => connect()}>Renouveler</button>
          </p>
        )}
        {banques && <BankPicker banques={banques} busy={busy} onPick={(b) => connect(b)} />}
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
          {err && <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>{err}</p>}
          {status.statut === "erreur" && <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>La dernière synchronisation a échoué. Réessayez, ou reconnectez la banque.</p>}
        </>
      )}
    </div>
  );
}
