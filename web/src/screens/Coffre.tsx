import { useEffect, useState } from "react";
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from "@simplewebauthn/browser";
import type { Api } from "../api";
import type { EtatCoffre } from "../types";
import { Ico } from "./espacesCommun";

const appareil = () => {
  const u = navigator.userAgent;
  return /iPhone/.test(u) ? "iPhone" : /iPad/.test(u) ? "iPad" : /Android/.test(u) ? "Android" : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "PC Windows" : "Cet appareil";
};
const heure = (iso: string) => new Date(iso).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
const CADENAS = "M6 11h12v9H6zM8 11V8a4 4 0 018 0v3";

/** Opens the coffre: Face ID / fingerprint when this account has one, otherwise a code sent by email. */
export function CoffreSheet({ api, onOuvert, onClose, toast }: { api: Api; onOuvert: () => void; onClose: () => void; toast: (m: string) => void }) {
  const [etat, setEtat] = useState<EtatCoffre | null>(null);
  const [envoye, setEnvoye] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [proposer, setProposer] = useState(false);
  const bio = typeof window !== "undefined" && browserSupportsWebAuthn();
  useEffect(() => { api.coffre().then((e) => { setEtat(e); if (e.ouvert) onOuvert(); }).catch(() => setEtat(null)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const fini = () => { toast(`Coffre ouvert pour ${etat?.duree_minutes ?? 10} minutes`); onOuvert(); };
  const parBio = async () => {
    setBusy(true);
    try { const o = await api.coffrePasskeyOptions(); const r = await startAuthentication({ optionsJSON: o }); await api.coffrePasskeyVerifier(r); fini(); }
    catch (e) { toast((e as Error).name === "NotAllowedError" ? "Déverrouillage annulé" : (e as Error).message); setBusy(false); }
  };
  const demanderCode = async () => { setBusy(true); try { const r = await api.coffreCode(); setEnvoye(r.a); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const verifier = async () => {
    setBusy(true);
    try { await api.coffreVerifierCode(code); if (bio && !etat?.passkeys.length) setProposer(true); else fini(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const activerBio = async () => {
    setBusy(true);
    try { const o = await api.coffrePasskeyOptionsEnregistrement(); const r = await startRegistration({ optionsJSON: o }); await api.coffrePasskeyEnregistrer(r, appareil()); toast("Face ID / empreinte activé pour le coffre"); fini(); }
    catch (e) { toast((e as Error).name === "NotAllowedError" ? "Activation annulée" : (e as Error).message); fini(); }
  };
  return (
    <div className="feuille-fond" onClick={onClose}>
      <div className="feuille coffre-feuille" role="dialog" aria-modal="true" aria-labelledby="coffre-titre" onClick={(e) => e.stopPropagation()}>
        <div className="coffre-icone" aria-hidden><Ico d={CADENAS} size={30} /></div>
        <h2 id="coffre-titre">Le coffre-fort</h2>
        {proposer ? (
          <>
            <p className="note">Coffre ouvert. La prochaine fois, ouvrez-le d'un regard ou d'un doigt : Face ID, empreinte ou Windows Hello, sans code.</p>
            <div className="feuille-actions"><button className="btn ghost" onClick={fini}>Plus tard</button><button className="btn" disabled={busy} onClick={activerBio}>Activer sur {appareil() === "Cet appareil" ? "cet appareil" : `cet ${appareil()}`}</button></div>
          </>
        ) : (
          <>
            <p className="note">Pièces d'identité, santé, impôts et banque y sont rangés. Ils s'ouvrent après une vérification, pour {etat?.duree_minutes ?? 10} minutes, et chaque ouverture est notée dans votre journal.</p>
            {!envoye ? (
              <div className="coffre-choix">
                {bio && !!etat?.passkeys.length && <button className="btn block" disabled={busy} onClick={parBio}>Face ID ou empreinte</button>}
                <button className={`btn block ${bio && etat?.passkeys.length ? "ghost" : ""}`} disabled={busy} onClick={demanderCode}>Recevoir un code par email</button>
              </div>
            ) : (
              <div className="coffre-choix">
                <p className="note">Code envoyé à <b>{envoye}</b>, valable 10 minutes.</p>
                <input className="in coffre-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
                <button className="btn block" disabled={busy || code.length !== 6} onClick={verifier}>Ouvrir le coffre</button>
                <button className="link" disabled={busy} onClick={demanderCode}>Renvoyer un code</button>
              </div>
            )}
            <button className="link" style={{ marginTop: 8 }} onClick={onClose}>Annuler</button>
          </>
        )}
      </div>
    </div>
  );
}

/** Réglages > « Sécurité » : encryption, the coffre, Face ID on this device, the access journal. */
export function CarteSecurite({ api, toast }: { api: Api; toast: (m: string) => void }) {
  const [etat, setEtat] = useState<EtatCoffre | null>(null);
  const [ouvrir, setOuvrir] = useState(false);
  const [journal, setJournal] = useState<Awaited<ReturnType<Api["coffreJournal"]>> | null>(null);
  const bio = typeof window !== "undefined" && browserSupportsWebAuthn();
  const charger = () => api.coffre().then(setEtat).catch(() => {});
  useEffect(() => { charger(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!etat) return null;
  const ajouterBio = async () => {
    if (!etat.ouvert) { setOuvrir(true); return; }
    try { const o = await api.coffrePasskeyOptionsEnregistrement(); const r = await startRegistration({ optionsJSON: o }); await api.coffrePasskeyEnregistrer(r, appareil()); toast("Face ID / empreinte activé"); charger(); }
    catch (e) { toast((e as Error).name === "NotAllowedError" ? "Activation annulée" : (e as Error).message); }
  };
  return (
    <section className="section reg-carte securite">
      <p className="reg-titre">Sécurité</p>
      <div className="secu-points">
        <div><Ico d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><span><b>Papiers chiffrés</b>{etat.chiffrement ? "Vos fichiers sont chiffrés sur nos serveurs, en Europe (AES-256)." : "Chiffrement en cours d'activation."}</span></div>
        <div><Ico d={CADENAS} /><span><b>Coffre-fort</b>Identité, santé, impôts et banque s'ouvrent après une vérification. L'assistant IA connecté n'en voit jamais les numéros.</span></div>
      </div>
      {etat.verrou && (
        <>
          <div className="settings-row">
            <div><div className="t">Coffre {etat.ouvert ? <span className="badge yolk">ouvert jusqu'à {heure(etat.jusqu_au!)}</span> : <span className="badge">fermé</span>}</div>
              <div className="s">{etat.ouvert ? "Il se referme tout seul." : "Face ID, empreinte ou code par email pour l'ouvrir."}</div></div>
            {etat.ouvert ? <button className="link" onClick={async () => { await api.coffreFermer(); toast("Coffre refermé"); charger(); }}>Fermer</button> : <button className="link" onClick={() => setOuvrir(true)}>Ouvrir</button>}
          </div>
          <div className="settings-row">
            <div><div className="t">Face ID ou empreinte</div>
              <div className="s">{etat.passkeys.length ? etat.passkeys.map((p) => `${p.appareil ?? "Appareil"} (depuis le ${new Date(p.cree_le).toLocaleDateString("fr-FR")})`).join(" · ") : bio ? "Ouvrez le coffre sans code, sur cet appareil." : "Votre navigateur ne le permet pas : le code par email reste disponible."}</div></div>
            <div className="reg-liens">
              {bio && <button className="link" onClick={ajouterBio}>{etat.passkeys.length ? "Ajouter cet appareil" : "Activer"}</button>}
              {etat.passkeys.map((p) => <button key={p.id} className="link discret" onClick={async () => { if (!confirm(`Retirer ${p.appareil ?? "cet appareil"} ?`)) return; await api.coffreRetirerPasskey(p.id); charger(); }}>Retirer {p.appareil ?? ""}</button>)}
            </div>
          </div>
        </>
      )}
      <div className="settings-row">
        <div><div className="t">Journal des accès</div><div className="s">Qui a ouvert quel papier du coffre, et quand. Les accès de l'assistant IA connecté y sont aussi notés côté connecteur.</div></div>
        <button className="link" onClick={async () => setJournal(journal ? null : await api.coffreJournal())}>{journal ? "Masquer" : "Voir"}</button>
      </div>
      {journal && (journal.length ? (
        <ul className="secu-journal">{journal.map((j, k) => <li key={k}><b>{new Date(j.quand).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</b> {j.qui ?? "—"} · {j.action}{j.titre ? ` · ${j.titre}` : ""}</li>)}</ul>
      ) : <p className="note">Aucun accès au coffre pour l'instant.</p>)}
      {ouvrir && <CoffreSheet api={api} toast={toast} onClose={() => setOuvrir(false)} onOuvert={() => { setOuvrir(false); charger(); }} />}
    </section>
  );
}
