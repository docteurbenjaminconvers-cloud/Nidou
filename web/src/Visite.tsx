import { useEffect, useRef, useState } from "react";
import type { Doc } from "./types";

/**
 * The guided tour of the demonstration: one bubble per screen says what Lucien does there and what to try; a touch on
 * the bubble (or « Suivant ») opens the next screen. Shown only in demo mode. Closed, it leaves a pill to resume.
 */
interface Etape {
  ecran: string;
  /** which paper to open, for the « doc » screen */
  papier?: (docs: Doc[]) => Doc | undefined;
  /** what to point at: a CSS selector, or « h2:Titre » for the section under that heading */
  cible?: string;
  titre: string;
  texte: string;
  essayer?: string;
}

const facture = (docs: Doc[]) => docs.find((d) => d.category === "energie" && /facture/i.test(d.title));
const ETAPES: Etape[] = [
  { ecran: "home", titre: "Bienvenue chez Lucien", texte: "Voici la famille Martin, une famille de démonstration. Je vous fais visiter en deux minutes. Tout se manipule, et rien n'est enregistré.", essayer: "Touchez cette bulle pour avancer." },
  { ecran: "home", titre: "Aujourd'hui", texte: "L'écran du matin : la prochaine échéance en grand, la journée de chacun et les économies déjà trouvées." },
  { ecran: "add", cible: ".dropzone", titre: "Ajouter un papier", texte: "Une photo, un PDF, ou plusieurs d'un coup. Un recto verso devient un seul document. Lucien lit tout : dates, montants, coordonnées, références.", essayer: "Collez le texte d'une facture plus bas, puis « Lire et ranger »." },
  { ecran: "add", cible: ".depot-email", titre: "Ou par email", texte: "Chaque foyer a son adresse Lucien. Transférez-y une facture ou les photos d'un courrier : le papier est rangé et Lucien vous répond quand c'est fait." },
  { ecran: "docs", titre: "Papiers", texte: "Tout est classé et se retrouve par organisme, par numéro ou par un mot du document. Les papiers d'identité vont au coffre, chiffrés.", essayer: "Touchez un papier pour l'ouvrir." },
  { ecran: "doc", papier: (d) => d.find((x) => x.category === "telecom" && !!x.montant), cible: "h2:Payez-vous le bon prix", titre: "Payez-vous le bon prix ?", texte: "Lucien cherche les offres du moment pour le même service. Chaque prix porte le lien de la page où il a été lu, et Lucien ne touche aucune commission.", essayer: "Ouvrez un autre contrat et touchez « Chercher moins cher » (fournisseurs inventés dans la démo)." },
  { ecran: "doc", papier: (d) => d.find((x) => x.category === "abonnement"), cible: "h2:Courrier prêt à envoyer", titre: "Résilier sans écrire une ligne", texte: "La lettre est rédigée avec votre numéro de contrat et l'adresse du service client, puis envoyée en votre nom.", essayer: "Touchez « Résiliation »." },
  { ecran: "doc", papier: facture, cible: "h2:Courrier prêt à envoyer", titre: "Réclamation, relance, médiateur", texte: "Ce courrier est resté 16 jours sans réponse : la relance est déjà rédigée. Sans réponse à la relance, Lucien indique le médiateur à saisir.", essayer: "Touchez « Relire la relance », ou « Réclamation » pour contester autre chose." },
  { ecran: "deadlines", titre: "Agenda", texte: "Les échéances des papiers et les activités de chacun au même endroit, avec le rappel avant la date limite.", essayer: "Passez de la journée à la semaine, puis au mois." },
  { ecran: "famille", titre: "Famille", texte: "Chaque personne du foyer a sa page : sa semaine, ses papiers, ce qui arrive, ce qu'elle coûte.", essayer: "Touchez un visage." },
  { ecran: "budget", titre: "Budget", texte: "Vos vraies dépenses, et les économies faciles classées par gain : abonnements oubliés, hausses silencieuses, doublons, frais évitables. Chaque alerte a son bouton pour agir." },
  { ecran: "espace/budget", titre: "Budget expert", texte: "Les comptes du foyer tenus comme par un expert-comptable : compte de résultat, prévisionnel, patrimoine net, ratios." },
  { ecran: "espace/pro", titre: "Vie pro", texte: "Bulletins de salaire contrôlés, cumul imposable, et pour les indépendants les cotisations et les éléments de la déclaration." },
  { ecran: "espace/locatif", titre: "Patrimoine locatif", texte: "Loyers rapprochés de la banque, impayés, quittances, révision du loyer, rentabilité de chaque bien." },
  { ecran: "dossiers", titre: "Dossiers prêts", texte: "Location, CAF, école, prêt, passeport : Lucien rassemble les pièces, signale celles qui manquent et en fait un seul fichier." },
  { ecran: "situations", titre: "Situations de vie", texte: "Déménagement, naissance, mariage, séparation, décès d'un proche : la liste des démarches, dans l'ordre, avec les papiers déjà rangés." },
  { ecran: "semaine", titre: "Votre semaine", texte: "Le point du dimanche soir : les échéances, l'agenda de la famille, le geste qui rapporte et un conseil." },
  { ecran: "connecteur", titre: "Lucien dans votre IA", texte: "Claude ou ChatGPT peuvent consulter vos papiers pour vous répondre. Si vous l'autorisez, ils peuvent aussi ranger un papier ou noter un rappel ; jamais supprimer ni envoyer." },
  { ecran: "offre", titre: "Et maintenant, avec vos papiers ?", texte: "Vous avez fait le tour. Continuez à explorer librement la démonstration, ou rejoignez la liste d'attente pour essayer Lucien avec vos vrais papiers." },
];

const CLE = "lucien.visite";
const lire = (): number | null => { try { const v = sessionStorage.getItem(CLE); return v === null ? 0 : v === "fin" ? null : Math.min(ETAPES.length - 1, Math.max(0, Number(v) || 0)); } catch { return 0; } };
const garder = (n: number | null) => { try { sessionStorage.setItem(CLE, n === null ? "fin" : String(n)); } catch { /* storage refused */ } };

function trouver(cible: string): HTMLElement | null {
  if (cible.startsWith("h2:")) {
    const t = cible.slice(3);
    const h = [...document.querySelectorAll<HTMLElement>("h2")].find((x) => x.textContent?.includes(t));
    return h ? (h.closest("section") as HTMLElement | null) ?? h : null;
  }
  return document.querySelector<HTMLElement>(cible);
}

export function Visite({ docs, go, enPause }: { docs: Doc[]; go: (s: string, id?: string) => void; enPause: boolean }) {
  const [n, setN] = useState<number | null>(lire);
  const montre = useRef<HTMLElement | null>(null);
  const e = n === null ? null : ETAPES[n];

  useEffect(() => {
    document.documentElement.classList.toggle("visite-active", n !== null && !enPause);
    return () => document.documentElement.classList.remove("visite-active");
  }, [n, enPause]);

  // each step opens its screen, then points at what it talks about
  useEffect(() => {
    montre.current?.classList.remove("visite-cible"); montre.current = null;
    if (!e || enPause) return;
    const [s, id] = e.ecran.split("/");
    const papier = e.papier?.(docs);
    if (e.papier && !papier && docs.length) { /* that paper was deleted during the demo: the step only explains */ }
    else if (e.papier ? !!papier : true) go(s, e.papier ? papier!.id : id);
    let essais = 0;
    const t = setInterval(() => {
      const el = e.cible ? trouver(e.cible) : null;
      if (el) { clearInterval(t); el.classList.add("visite-cible"); montre.current = el; el.scrollIntoView({ block: "start", behavior: "smooth" }); }
      else if (++essais > 12 || !e.cible) { clearInterval(t); if (!e.cible) document.getElementById("root")?.scrollTo({ top: 0 }); }
    }, 250);
    return () => clearInterval(t);
  }, [n, enPause, docs.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const aller = (v: number | null) => { garder(v); setN(v); };
  if (enPause) return null;
  if (!e || n === null) return <button className="visite-reprendre" onClick={() => aller(0)}>Visite guidée</button>;
  const dernier = n === ETAPES.length - 1;
  return (
    <aside className="visite" aria-live="polite" aria-label="Visite guidée de la démonstration">
      <button className="visite-fermer" aria-label="Quitter la visite" onClick={() => aller(null)}>×</button>
      <div className="visite-corps" role="button" tabIndex={0} onClick={() => aller(dernier ? null : n + 1)} onKeyDown={(k) => { if (k.key === "Enter" || k.key === " ") { k.preventDefault(); aller(dernier ? null : n + 1); } }}>
        <span className="visite-pas">{n + 1} / {ETAPES.length}</span>
        <b>{e.titre}</b>
        <p>{e.texte}</p>
        {e.essayer && <p className="visite-essayer"><i aria-hidden>→</i> {e.essayer}</p>}
      </div>
      <div className="visite-barre" aria-hidden><span style={{ width: `${((n + 1) / ETAPES.length) * 100}%` }} /></div>
      <div className="visite-actions">
        <button className="link" disabled={n === 0} onClick={() => aller(n - 1)}>‹ Précédent</button>
        {dernier
          ? <a className="btn" href="https://monlucien.fr/#inscription">Rejoindre la liste d'attente</a>
          : <button className="btn" onClick={() => aller(n + 1)}>Suivant ›</button>}
      </div>
    </aside>
  );
}
