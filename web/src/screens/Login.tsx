import { useEffect, useState } from "react";
import type { Api } from "../api";
import { Logo, SITE } from "../ui";

/** Password-less sign-in: an email, a link. The same screen welcomes an invited partner. */
export function Login({ api, erreur }: { api: Api; erreur?: string | null }) {
  const [email, setEmail] = useState(() => { try { return localStorage.getItem("lucien.email") ?? ""; } catch { return ""; } });
  const [sent, setSent] = useState<{ envoye: boolean; lien: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ferme, setFerme] = useState(false);
  const [err, setErr] = useState<string | null>(erreur === "expire" ? "Ce lien a expiré. Demandez-en un nouveau." : erreur === "utilise" ? "Ce lien a déjà servi. Demandez-en un nouveau." : erreur === "invalide" ? "Lien invalide. Demandez-en un nouveau." : null);

  // arrived through a shared invitation link: said at once, and checked (places left, date not past)
  const [invitation] = useState(() => { try { return localStorage.getItem("lucien.invitation"); } catch { return null; } });
  const [invite, setInvite] = useState<boolean | null>(null);
  useEffect(() => { if (invitation) api.invitationValable(invitation).then((r) => setInvite(r.valable)).catch(() => setInvite(null)); }, [invitation]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setBusy(true); setErr(null);
    try { localStorage.setItem("lucien.email", email); } catch {}
    try { const r = await api.demanderLien(email.trim(), invitation); setSent({ envoye: r.envoye, lien: r.lien }); try { localStorage.removeItem("lucien.invitation"); } catch { /* storage refused */ } }
    catch (e) { const code = (e as { code?: string }).code; setFerme(code === "sur_invitation"); setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <div className="app">
      <div className="screen" style={{ minHeight: "90dvh", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ marginBottom: 28 }}><Logo /></div>
        {invitation && invite === true && <div className="confidence ok" style={{ display: "block", width: "100%", marginBottom: 14 }}><b>Vous êtes invité·e à essayer Lucien.</b> 15 jours d'accès complet, gratuitement et sans carte bancaire. Saisissez votre email pour créer votre espace.</div>}
        {invitation && invite === false && <div className="confidence" style={{ display: "block", width: "100%", marginBottom: 14 }}>Ce lien d'invitation n'est plus valable : toutes les places sont prises, ou sa date est passée. Demandez-en un nouveau à la personne qui vous l'a envoyé.</div>}
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
            {ferme && <a className="btn ghost block" style={{ marginTop: 8 }} href={`${SITE}/#inscription`}>Rejoindre la liste d'attente</a>}
            <div style={{ marginTop: 14 }}><button className="btn block" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)} onClick={submit}>{busy ? <span className="spinner" /> : "Recevoir mon lien"}</button></div>
            <p className="note" style={{ marginTop: 14 }}>Première visite ? Le même lien crée votre espace, avec 15 jours de formule complète, sans carte bancaire. Invité·e par un proche ? Utilisez le lien reçu dans l'email d'invitation.</p>
          </>
        )}
      </div>
    </div>
  );
}
