import { useEffect, useRef, useState } from "react";
import type { Api } from "../api";
import type { AssistantEtat, AssistantMessage, AssistantReponse, Household } from "../types";

type Bulle = AssistantMessage & { liens?: AssistantReponse["liens"]; courrier?: AssistantReponse["courrier"]; erreur?: boolean };

const SUGGESTIONS = [
  "Qu'est-ce que je dois faire ce mois-ci ?",
  "Où est-ce que je peux économiser ?",
  "Résilie mon assurance auto",
  "Quand expire le passeport de Léa ?",
];

const fmt = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })} €`;
const CLE = "nidou.assistant.fil";

/** « Demander à Nidou » : a chat over the family's own papers, a paid option on top of a formule. */
export function Assistant({ api, household, go, onBack, onChanged, toast }: { api: Api; household: Household; go: (s: string, id?: string) => void; onBack: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const [fil, setFil] = useState<Bulle[]>(() => { try { return JSON.parse(sessionStorage.getItem(CLE) ?? "[]"); } catch { return []; } });
  const [texte, setTexte] = useState("");
  const [attente, setAttente] = useState(false);
  const [etat, setEtat] = useState<AssistantEtat | undefined>(household.assistant);
  const bas = useRef<HTMLDivElement>(null);

  useEffect(() => { setEtat(household.assistant); }, [household.assistant]);
  useEffect(() => { try { sessionStorage.setItem(CLE, JSON.stringify(fil.slice(-30))); } catch {} bas.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [fil, attente]);

  const envoyer = async (q: string) => {
    const question = q.trim();
    if (!question || attente) return;
    const avant = [...fil, { role: "user" as const, content: question }];
    setFil(avant); setTexte(""); setAttente(true);
    try {
      const r = await api.assistant(avant.filter((b) => !b.erreur).map(({ role, content }) => ({ role, content })));
      setFil([...avant, { role: "assistant", content: r.reponse, liens: r.liens, courrier: r.courrier }]);
      setEtat(r.etat);
    } catch (e) {
      setFil([...avant, { role: "assistant", content: (e as Error).message, erreur: true }]);
    } finally { setAttente(false); }
  };

  const activer = async () => {
    try { setEtat(await api.assistantOption(true)); onChanged(); toast("Assistant activé"); }
    catch (e) { toast((e as Error).message); go("settings"); }
  };

  const ferme = !etat || etat.acces === "aucun";
  return (
    <div className="screen assistant">
      <button className="back" onClick={onBack}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>Retour</button>
      <div className="top">
        <div><h1>Demander à Nidou</h1><p className="sub">{etat && !ferme ? `${etat.acces === "essai" ? "Essai" : "Option assistant"} · ${etat.restantes} question${etat.restantes > 1 ? "s" : ""} restante${etat.restantes > 1 ? "s" : ""} ce mois-ci` : "Vos papiers, vos échéances, vos économies, en une question"}</p></div>
        {fil.length > 0 && <button className="link" onClick={() => setFil([])}>Effacer</button>}
      </div>

      {ferme ? (
        <div className="plan-card on" style={{ marginTop: 6 }}>
          <h3>L'assistant Nidou</h3>
          <ul>
            <li>« Qu'est-ce que je dois faire ce mois-ci ? »</li>
            <li>« Où est-ce que je peux économiser ? »</li>
            <li>« Résilie mon assurance auto » : le courrier est prêt, vous n'avez plus qu'à l'envoyer</li>
            <li>Il lit vos papiers dans Nidou, jamais vos dossiers santé et banque, et ne fait rien sans vous</li>
          </ul>
          <div className="tier-price" style={{ marginTop: 10 }}><b>{fmt(etat?.prix.mensuel ?? 2.9)}</b><span> / mois</span></div>
          <p className="note">ou {fmt(etat?.prix.annuel ?? 29)} par an · jusqu'à 300 questions par mois · en plus de votre formule, sans engagement</p>
          {household.plan === "famille"
            ? <button className="btn block" style={{ marginTop: 12 }} onClick={activer}>Ajouter l'assistant</button>
            : <button className="btn block" style={{ marginTop: 12 }} onClick={() => go("settings")}>Choisir d'abord une formule</button>}
          <p className="note" style={{ marginTop: 10 }}>Vous avez déjà Claude ou ChatGPT ? Le connecteur Nidou, inclus dans votre formule, fait la même chose depuis votre assistant. <button className="link" onClick={() => go("connecteur")}>Voir comment</button></p>
        </div>
      ) : (
        <>
          {fil.length === 0 && (
            <div className="assistant-vide">
              <p className="note">Posez votre question comme à quelqu'un qui aurait rangé tous vos papiers.</p>
              <div className="chips">{SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => envoyer(s)}>{s}</button>)}</div>
            </div>
          )}
          <div className="fil" aria-live="polite">
            {fil.map((b, i) => (
              <div key={i} className={`bulle ${b.role} ${b.erreur ? "erreur" : ""}`}>
                <div className="bulle-texte">{b.content}</div>
                {b.courrier && (
                  <div className="courrier">
                    <div className="courrier-head"><b>{b.courrier.titre}</b><button className="link" onClick={async () => { try { await navigator.clipboard.writeText(b.courrier!.texte); toast("Courrier copié"); } catch { toast("Sélectionnez le texte pour le copier"); } }}>Copier</button></div>
                    <pre>{b.courrier.texte}</pre>
                  </div>
                )}
                {!!b.liens?.length && <div className="chips">{b.liens.map((l) => <button key={l.id} className="chip" onClick={() => go("doc", l.id)}>Voir : {l.titre}</button>)}</div>}
                {b.erreur && etat?.acces === "essai" && etat.restantes <= 0 && household.plan === "famille" && <button className="btn" style={{ marginTop: 8 }} onClick={activer}>Ajouter l'assistant · {fmt(etat.prix.mensuel)} / mois</button>}
              </div>
            ))}
            {attente && <div className="bulle assistant attente"><span /><span /><span /></div>}
            <div ref={bas} />
          </div>
          <form className="assistant-saisie" onSubmit={(e) => { e.preventDefault(); envoyer(texte); }}>
            <input value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Votre question…" aria-label="Votre question" maxLength={1000} enterKeyHint="send" />
            <button className="btn" disabled={!texte.trim() || attente} aria-label="Envoyer"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></button>
          </form>
          <p className="note" style={{ textAlign: "center", marginTop: 6, fontSize: 12 }}>L'assistant peut se tromper : vérifiez les dates et montants importants. Il ne fait aucune démarche à votre place.</p>
        </>
      )}
    </div>
  );
}
