import { useEffect, useState, type ReactNode } from "react";
import { ApiError, type Api, type Espace, type EspaceReponse, type ModuleId } from "../api";
import { droits, MODULES, type ModuleId as MId } from "../../../server/src/offre";
import type { Household } from "../types";
import { Back } from "../ui";

export const eur = (n: number | null | undefined, dec = false) =>
  n === null || n === undefined || Number.isNaN(n) ? "—" : `${n.toLocaleString("fr-FR", { minimumFractionDigits: dec && !Number.isInteger(n) ? 2 : 0, maximumFractionDigits: dec ? 2 : 0 })} €`;
export const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`);
export const dateFr = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const moisCourt = (m: string) => MOIS[Number(m.slice(5, 7)) - 1];
export const nouvelId = () => Math.random().toString(36).slice(2, 10);

export const Ico = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
export const ICONES: Record<"budget" | "pro" | "locatif" | "offre", string> = {
  budget: "M4 19V9M10 19V5M16 19v-7M22 19H2",
  pro: "M3 8h18v12H3zM8 8V5a1 1 0 011-1h6a1 1 0 011 1v3M3 13h18",
  locatif: "M3 11l9-7 9 7M5 10v10h14V10M10 20v-5h4v5",
  offre: "M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z",
};

/** Loads a paid space; 402 = the module is not part of the household's offer. */
export function useEspace<E extends Espace>(api: Api, e: E) {
  const [data, setData] = useState<EspaceReponse<E> | null>(null);
  const [ferme, setFerme] = useState<ModuleId | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const charger = async () => {
    try { setData(await api.espace(e)); setFerme(null); }
    catch (x) { if (x instanceof ApiError && x.status === 402) setFerme((e === "budget" ? "budget_expert" : e === "pro" ? "vie_pro_salarie" : "locatif") as ModuleId); else setErr((x as Error).message); }
  };
  useEffect(() => { charger(); }, [e]); // eslint-disable-line react-hooks/exhaustive-deps
  const sauver = async (d: EspaceReponse<E>["donnees"]) => { await api.sauverEspace(e, d); await charger(); };
  return { data, ferme, err, charger, sauver };
}

export function EnTete({ titre, sous, espace, onBack, droite }: { titre: string; sous: string; espace: "budget" | "pro" | "locatif"; onBack: () => void; droite?: ReactNode }) {
  return (
    <>
      <Back onClick={onBack} />
      <div className={`espace-tete ${espace}`}>
        <span className="espace-ico"><Ico d={ICONES[espace]} size={26} /></span>
        <div><h1>{titre}</h1><p>{sous}</p></div>
        {droite}
      </div>
    </>
  );
}

/** What a closed space shows: the module's promise, and the way to the offer. */
export function Verrou({ module, go, onBack }: { module: ModuleId; go: (s: string, id?: string) => void; onBack: () => void }) {
  const m = MODULES[module];
  return (
    <div className="screen">
      <Back onClick={onBack} />
      <div className={`verrou ${m.teinte}`}>
        <span className="verrou-cadenas"><Ico d="M6 11h12v9H6zM8 11V8a4 4 0 018 0v3" size={26} /></span>
        <h1>{m.nom}</h1>
        <p className="verrou-accroche">{m.accroche}</p>
        <ul>{m.inclut.map((x) => <li key={x}>{x}</li>)}</ul>
        <p className="verrou-prix">{eur(m.mensuel, true)} par mois{m.par === "bien" ? " (2 biens inclus)" : ""}, ou dans un pack</p>
        <button className="btn block" onClick={() => go("offre", module)}>Voir l'offre</button>
      </div>
    </div>
  );
}

export function Chiffres({ items }: { items: { label: string; valeur: string; ton?: "ok" | "alerte" | "neutre"; detail?: string }[] }) {
  return (
    <div className="chiffres">
      {items.map((x) => <div key={x.label} className={x.ton ?? "neutre"}><b>{x.valeur}</b><span>{x.label}</span>{x.detail && <small>{x.detail}</small>}</div>)}
    </div>
  );
}

export function Alertes({ alertes, onClick }: { alertes: { niveau: string; titre: string; detail: string }[]; onClick?: (i: number) => void }) {
  if (!alertes.length) return null;
  return (
    <div className="espace-alertes">
      {alertes.map((a, i) => (
        <button key={i} className={`ea ${a.niveau}`} onClick={() => onClick?.(i)}><b>{a.titre}</b><span>{a.detail}</span></button>
      ))}
    </div>
  );
}

/** Bottom sheet showing a generated text (quittance, relance, export) with copy and download. */
export function Feuille({ titre, texte, fichier, onClose }: { titre: string; texte: string; fichier: string; onClose: () => void }) {
  const [copie, setCopie] = useState(false);
  const telecharger = () => {
    const url = URL.createObjectURL(new Blob([texte], { type: fichier.endsWith(".csv") ? "text/csv;charset=utf-8" : "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = fichier; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="feuille-fond" onClick={onClose}>
      <div className="feuille" role="dialog" aria-label={titre} onClick={(e) => e.stopPropagation()}>
        <div className="feuille-tete"><b>{titre}</b><button className="link" onClick={onClose}>Fermer</button></div>
        <pre>{texte}</pre>
        <div className="feuille-actions">
          <button className="btn" onClick={async () => { try { await navigator.clipboard.writeText(texte); setCopie(true); } catch { /* clipboard refused */ } }}>{copie ? "Copié" : "Copier"}</button>
          <button className="btn ghost" onClick={telecharger}>Télécharger</button>
        </div>
      </div>
    </div>
  );
}

export const telecharger = (texte: string, fichier: string) => {
  const url = URL.createObjectURL(new Blob(["﻿" + texte], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = fichier; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Small labelled input used in the spaces' forms. */
export function Champ({ label, children }: { label: string; children: ReactNode }) {
  return <label className="champ"><span>{label}</span>{children}</label>;
}

/** Home: the three paid spaces, open or with a padlock, and the way to the offer. */
export function EspacesCarte({ household, go }: { household: Household; go: (s: string, id?: string) => void }) {
  const ok = droits({ plan: household.plan, essai_actif: !!household.essai?.actif, modules: (household.modules ?? []) as MId[] });
  const tuiles = [
    { e: "budget" as const, nom: "Budget expert", sous: "Résultat, bilan, ratios", ouvert: ok.has("budget_expert") },
    { e: "pro" as const, nom: "Vie pro", sous: "Bulletins, 2035", ouvert: ok.has("vie_pro_salarie") },
    { e: "locatif" as const, nom: "Locatif", sous: "Loyers, IRL, impôts", ouvert: ok.has("locatif") },
  ];
  return (
    <section className="espaces-carte" aria-label="Vos espaces">
      <div className="ec-tete"><b>Vos espaces</b><button className="link" onClick={() => go("offre")}>L'offre</button></div>
      <div className="ec-tuiles">
        {tuiles.map((t) => (
          <button key={t.e} className={`ec-tuile ${t.e} ${t.ouvert ? "" : "ferme"}`} onClick={() => go("espace", t.e)}>
            <span className="ec-ico"><Ico d={ICONES[t.e]} />{!t.ouvert && <i aria-label="à ajouter"><Ico d="M6 11h12v9H6zM8 11V8a4 4 0 018 0v3" size={12} /></i>}</span>
            <b>{t.nom}</b><small>{t.sous}</small>
          </button>
        ))}
      </div>
      {household.essai?.actif && <p className="ec-essai">Ouverts pendant votre essai : essayez-les.</p>}
    </section>
  );
}
