import { useState } from "react";
import type { Api } from "../api";
import { Logo } from "../ui";

/** Password-less sign-in: an email, a link. The same screen welcomes an invited partner. */
export function Login({ api, erreur }: { api: Api; erreur?: string | null }) {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem("lucien.email") ?? ""; } catch { return ""; } });
  const [sent, setSent] = useState<{ envoye: boolean; lien: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(erreur === "expire" ? "Ce lien a expiré. Demandez-en un nouveau." : erreur === "utilise" ? "Ce lien a déjà servi. Demandez-en un nouveau." : erreur === "invalide" ? "Lien invalide. Demandez-en un nouveau." : null);

  const submit = async () => {
    setBusy(true); setErr(null);
    try { localStorage.setItem("lucien.email", email); } catch {}
    try { const r = await api.demanderLien(email.trim()); setSent({ envoye: r.envoye, lien: r.lien }); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="app">
      <div className="screen" style={{ minHeight: "90dvh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ marginBottom: 28 }}><Logo /></div>
        <h1 className="detail-title">Ouvrir votre espace</h1>
        <p className="detail-sub">Pas de mot de passe : on vous envoie un lien par email. Il ouvre Lucien sur ce téléphone, et c'est tout.</p>
        {sent ? (
          <div className="confidence ok" style={{ display: "block", width: "100%" }}>
            {sent.envoye ? <>Lien envoyé à <b>{email}</b>. Ouvrez l'email et touchez le lien : il est valable 30 minutes.</> : <>Mode développement : aucun service d'email configuré. <a className="link" href={sent.lien ?? "#"}>Ouvrir le lien de connexion</a></>}
            <div style={{ marginTop: 10 }}><button className="link" onClick={() => setSent(null)}>Changer d'adresse</button></div>
          </div>
        ) : (
          <>
            <label className="lbl" htmlFor="email">Votre email</label>
            <input id="email" className="in" type="email" inputMode="email" autoComplete="email" placeholder="vous@exemple.fr" value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && submit()} />
            {err && <p className="note" style={{ color: "var(--ember)", marginTop: 8 }}>{err}</p>}
            <div style={{ marginTop: 14 }}><button className="btn block" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)} onClick={submit}>{busy ? <span className="spinner" /> : "Recevoir mon lien"}</button></div>
            <p className="note" style={{ marginTop: 14 }}>Première visite ? Le même lien crée votre espace, avec 15 jours de plan Famille complet, sans carte bancaire. Invité·e par un proche ? Utilisez le lien reçu dans l'email d'invitation.</p>
          </>
        )}
      </div>
    </div>
  );
}
