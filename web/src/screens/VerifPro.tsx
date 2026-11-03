import { useEffect, useState } from "react";
import type { Api } from "../api";
import type { AlertePro, AnalysePro, PrelevementPro } from "../types";
import { Back, fmtEuro } from "../ui";
import { SheetResiliation } from "./Spending";
import { Feuille } from "./espacesCommun";

const dateFr = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const SIGNAL: Record<PrelevementPro["signaux"][number], string> = { nouveau: "Nouveau", suspect: "À vérifier", hausse: "En hausse" };

/** Small card (Vie pro, Budget): how many lines deserve a look on the business accounts. */
export function VerifProCarte({ api, go }: { api: Api; go: (s: string) => void }) {
  const [a, setA] = useState<AnalysePro | null>(null);
  useEffect(() => { api.verificationPro().then(setA).catch(() => setA(null)); }, [api]);
  if (!a || !a.comptes.length || (!a.prelevements.length && !a.alertes.length)) return null;
  return (
    <button className={`verif-carte ${a.a_verifier ? "alerte" : ""}`} onClick={() => go("verif-pro")}>
      <span><b>{a.a_verifier ? `${a.a_verifier} dépense${a.a_verifier > 1 ? "s" : ""} à vérifier sur le compte pro` : "Compte pro : rien de suspect"}</b>
        <span>{a.prelevements.length} prélèvement{a.prelevements.length > 1 ? "s" : ""} réguliers, {fmtEuro(a.total_annuel)} par an</span></span>
      <span aria-hidden>›</span>
    </button>
  );
}

/** The full list: every recurring debit of the business accounts, and the lines to check. */
export function VerifPro({ api, onBack, toast }: { api: Api; onBack: () => void; toast: (m: string) => void }) {
  const [a, setA] = useState<AnalysePro | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [resil, setResil] = useState<string | null>(null);   // the recurring debit being cancelled (its « rec:… » key)
  const [lettre, setLettre] = useState<{ titre: string; texte: string } | null>(null);
  useEffect(() => { api.verificationPro().then(setA).catch((e) => toast((e as Error).message)); }, [api]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!a) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;
  const decider = async (cle: string, d: "ok" | "resilier" | null) => { setA(await api.deciderPro(cle, d)); toast(d === "ok" ? "Noté : vous l'utilisez" : d === "resilier" ? "Noté : à résilier" : "Remis à vérifier"); };
  // « À résilier » on a recurring debit opens the cancellation: steps, the letter, then « C'est fait » and the bank check
  const recurrent = (cle: string) => cle.startsWith("rec:");
  const boutons = (cle: string, decision: "ok" | "resilier" | null, resiliable = true) => decision ? (
    <div className="verif-actions">
      <span className={`verif-decision ${decision}`}>{decision === "ok" ? "Je l'utilise" : "À résilier"}</span>
      {decision === "resilier" && recurrent(cle) && <button className="pill" onClick={() => setResil(cle)}>Lettre et marche à suivre</button>}
      <button className="link" onClick={() => decider(cle, null)}>Changer</button>
    </div>
  ) : (
    <div className="verif-actions"><button className="pill" onClick={() => decider(cle, "ok")}>Je l'utilise / c'est normal</button>{resiliable && <button className="pill" onClick={async () => { await decider(cle, "resilier"); if (recurrent(cle)) setResil(cle); }}>À résilier</button>}</div>
  );
  const aide = (
    <div className="verif-aide">
      <b>Comment arrêter un prélèvement</b>
      <ul>
        <li>Abonnement que vous ne voulez plus : résiliez auprès du fournisseur (espace client, lettre recommandée), puis révoquez le mandat de prélèvement dans l'appli de la banque.</li>
        <li>Prélèvement que vous n'avez jamais autorisé : contestez-le auprès de votre banque. Vous avez 13 mois pour un prélèvement non autorisé, et 8 semaines pour un prélèvement autorisé que vous contestez.</li>
        <li>Débit par carte que vous ne reconnaissez pas : faites opposition sur la carte, puis contestez l'opération auprès de la banque.</li>
      </ul>
    </div>
  );
  const alerte = (x: AlertePro) => (
    <div key={x.cle} className={`verif-ligne ${x.type} ${x.decision ? "faite" : ""}`}>
      <b>{x.titre}</b>
      {x.date && <small>{dateFr(x.date)}</small>}
      <p>{x.detail}</p>
      {x.type !== "frais" && boutons(x.cle, x.decision, x.type !== "micro")}
    </div>
  );
  const aResilier = a.prelevements.filter((p) => p.decision === "resilier");
  return (
    <div className="screen verif-pro">
      <Back onClick={onBack} />
      <h1 className="detail-title">Dépenses du compte pro</h1>
      <p className="detail-sub">{a.comptes.length ? `${a.comptes.join(", ")} · ${a.mois} mois analysés` : "Aucun compte classé « Professionnel »."}</p>
      {!a.comptes.length && <p className="note">Dans Budget, choisissez « Professionnel » pour le compte de votre activité : Lucien y cherchera les abonnements oubliés et les prélèvements douteux.</p>}

      {aResilier.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Vos résiliations</h2><span className="badge">{fmtEuro(aResilier.reduce((t, p) => t + p.annuel, 0))} / an</span></div>
          {aResilier.map((p) => (
            <div key={p.cle} className={`resil-item ${p.suivi?.statut ?? ""}`}>
              <div><b>{p.marchand}</b> <span className="resil-chip">{!p.suivi ? "À faire" : p.suivi.statut === "confirmee" ? "Prouvé par la banque" : p.suivi.statut === "encore_prelevee" ? "Encore prélevé" : "Envoyée, vérification en cours"}</span>
                <p>{p.suivi ? p.suivi.message : `${fmtEuro(p.montant, 2)} ${p.frequence === "annuel" ? "par an" : "par mois"} : préparez la lettre, envoyez-la, puis touchez « C'est fait ».`}</p></div>
              <div className="verif-actions">
                {!p.suivi && <button className="pill" onClick={() => setResil(p.cle)}>Lettre et marche à suivre</button>}
                {!p.suivi && <button className="link" onClick={() => decider(p.cle, null)}>Je garde finalement</button>}
              </div>
            </div>
          ))}
        </section>
      )}

      {a.alertes.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>À vérifier</h2></div>
          {a.alertes.map(alerte)}
        </section>
      )}

      {a.prelevements.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Prélèvements réguliers</h2><span className="badge">{fmtEuro(a.total_annuel)} / an</span></div>
          <p className="note" style={{ marginTop: 0 }}>Tout ce qui revient chaque mois ou chaque année. Pour chacun : l'utilisez-vous encore ?</p>
          {a.prelevements.filter((p) => p.decision !== "resilier").map((p) => (
            <div key={p.cle} className={`verif-ligne ${p.signaux.includes("suspect") ? "suspect" : ""} ${p.decision ? "faite" : ""}`}>
              <button className="verif-tete" onClick={() => setOuvert(ouvert === p.cle ? null : p.cle)} aria-expanded={ouvert === p.cle}>
                <span><b>{p.marchand}</b><small>{fmtEuro(p.montant, 2)} {p.frequence === "annuel" ? "par an" : p.frequence === "hebdomadaire" ? "par semaine" : "par mois"} · depuis le {dateFr(p.depuis)}</small></span>
                <span className="verif-annuel">{fmtEuro(p.annuel)}<small>/ an</small></span>
              </button>
              {p.signaux.length > 0 && <div className="verif-signaux">{p.signaux.map((s) => <span key={s} className={`verif-signal ${s}`}>{SIGNAL[s]}{s === "hausse" && p.hausse ? ` : ${fmtEuro(p.hausse.avant, 2)} → ${fmtEuro(p.hausse.apres, 2)}` : ""}</span>)}</div>}
              {p.signaux.includes("suspect") && <p>Ce libellé ressemble aux fausses offres d'annuaire ou de registre qui visent les professionnels. Vérifiez que vous l'avez bien commandé.</p>}
              {boutons(p.cle, p.decision)}
            </div>
          ))}
        </section>
      )}
      {(a.prelevements.length > 0 || a.alertes.length > 0) && aide}
      <p className="note" style={{ margin: "16px 0 30px" }}>Lucien ne résilie et ne conteste rien à votre place : il prépare la lettre et vous montre où regarder, puis vérifie sur vos relevés que le prélèvement s'est arrêté. L'analyse se refait à chaque mise à jour de la banque.</p>
      {resil && <SheetResiliation api={api} cle={resil.slice(4)} onClose={() => setResil(null)} onLettre={setLettre} onFait={() => { setResil(null); api.verificationPro().then(setA).catch(() => {}); }} toast={toast} />}
      {lettre && <Feuille titre={lettre.titre} texte={lettre.texte} fichier={`${lettre.titre.replace(/[^\p{L}\p{N} -]+/gu, "")}.txt`} onClose={() => setLettre(null)} />}
    </div>
  );
}
