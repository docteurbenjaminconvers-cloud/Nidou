import { useEffect, useMemo, useState } from "react";
import type { Api, ModuleId, OffreEtat } from "../api";
import { devis, MODULES, PACKS, SOCLE, SOCLE_INCLUT, type Formule, type Periode } from "../../../server/src/offre";
import type { Household } from "../types";
import { Back } from "../ui";
import { eur, Ico, ICONES } from "./espacesCommun";

const ORDRE: ModuleId[] = ["budget_expert", "vie_pro_salarie", "vie_pro_independant", "locatif", "assistant", "veille"];
const ICONE_MODULE: Record<ModuleId, string> = {
  budget_expert: ICONES.budget, vie_pro_salarie: ICONES.pro, vie_pro_independant: ICONES.pro, locatif: ICONES.locatif,
  assistant: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z", veille: "M12 21s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.6-7 10-7 10z",
};

/** « L'offre Lucien » : socle, packs, modules à la carte, devis en direct. */
export function Offre({ api, household, focus, onBack, onChange, toast }: { api: Api; household: Household; focus?: string; onBack: () => void; onChange: () => void; toast: (m: string) => void }) {
  const [etat, setEtat] = useState<OffreEtat | null>(null);
  const [periode, setPeriode] = useState<Periode>("annuel");
  const [formule, setFormule] = useState<Formule>(household.comptes && household.comptes >= 3 ? "tribu" : household.situation === "seul" ? "solo" : "duo");
  const [pack, setPack] = useState<string | null>(null);
  const [mods, setMods] = useState<ModuleId[]>(focus && focus in MODULES ? [focus as ModuleId] : []);
  const [biens, setBiens] = useState(2);
  const [proches, setProches] = useState(1);
  const [ouvert, setOuvert] = useState<ModuleId | null>(focus && focus in MODULES ? (focus as ModuleId) : null);
  const [envoi, setEnvoi] = useState(false);
  useEffect(() => { api.offre().then((e) => { setEtat(e); if (e.souscrits.length && !focus) setMods(e.souscrits); }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const choix = { formule, periode, modules: mods, pack, biens, proches };
  const d = useMemo(() => devis(choix), [formule, periode, mods, pack, biens, proches]); // eslint-disable-line react-hooks/exhaustive-deps
  const packDef = PACKS.find((p) => p.id === pack);
  const dansPack = (m: ModuleId) => !!packDef && (packDef.modules.includes(m) || (m === "vie_pro_salarie" && packDef.modules.includes("vie_pro_independant")));
  const basculer = (m: ModuleId) => setMods((x) => (x.includes(m) ? x.filter((y) => y !== m) : m === "vie_pro_independant" ? [...x.filter((y) => y !== "vie_pro_salarie"), m] : m === "vie_pro_salarie" ? [...x.filter((y) => y !== "vie_pro_independant"), m] : [...x, m]));
  const par = periode === "annuel" ? "/ an" : "/ mois";
  const prixP = (mensuel: number) => (periode === "annuel" ? mensuel * 10 : mensuel);

  const activer = async () => {
    setEnvoi(true);
    try {
      const r = await api.choisirModules(d.modules.filter((m) => !dansPack(m)), pack, { formule, periode, biens, proches });
      if (r.url) { location.href = r.url; return; } // Stripe Checkout
      toast(api.mode === "demo" ? "Modules activés (démo)" : "Modules activés"); onChange();
    }
    catch (e) { toast((e as Error).message); }
    finally { setEnvoi(false); }
  };

  return (
    <div className="screen offre">
      <Back onClick={onBack} />
      <div className="offre-tete">
        <h1>L'offre Lucien</h1>
        <p>Un socle pour tout le foyer, puis seulement ce qui vous sert.{household.essai?.actif ? " Pendant l'essai, tous les modules sont ouverts : essayez-les." : ""}</p>
      </div>

      <div className="offre-reglages">
        <div className="pills" role="group" aria-label="Paiement">
          <button className="pill" aria-pressed={periode === "mensuel"} onClick={() => setPeriode("mensuel")}>Mensuel</button>
          <button className="pill" aria-pressed={periode === "annuel"} onClick={() => setPeriode("annuel")}>Annuel · 2 mois offerts</button>
        </div>
        <div className="pills" role="group" aria-label="Formule">
          {(Object.keys(SOCLE) as Formule[]).map((f) => <button key={f} className="pill" aria-pressed={formule === f} onClick={() => setFormule(f)}>{SOCLE[f].nom} · {SOCLE[f].comptes} compte{SOCLE[f].comptes > 1 ? "s" : ""}</button>)}
        </div>
      </div>

      <section className="socle">
        <div className="socle-tete"><div><span className="tag">Le socle</span><h2>Lucien {SOCLE[formule].nom}</h2><p>{SOCLE[formule].pour}</p></div><b>{eur(prixP(SOCLE[formule].mensuel), true)}<small>{par}</small></b></div>
        <ul>{SOCLE_INCLUT.map((x) => <li key={x}>{x}</li>)}</ul>
      </section>

      <section className="section">
        <div className="section-head"><h2>Les packs</h2><span className="badge">jusqu’à −30 % sur les modules</span></div>
        <div className="packs">
          {PACKS.map((p) => {
            const dp = devis({ ...choix, pack: p.id, modules: [] });
            return (
              <button key={p.id} className={`pack ${p.vedette ? "vedette" : ""}`} aria-pressed={pack === p.id} onClick={() => setPack(pack === p.id ? null : p.id)}>
                {p.vedette && <span className="pack-ruban">Le plus complet</span>}
                <b className="pack-nom">{p.nom}</b>
                <span className="pack-accroche">{p.accroche}</span>
                <span className="pack-mods">{p.modules.map((m) => <i key={m}>{MODULES[m].nom.replace("Vie pro · ", "Vie pro ")}</i>)}</span>
                <span className="pack-prix"><b>{eur(dp.total, true)}</b> {par}<s>{eur(prixP(dp.alaCarte), true)}</s></span>
                <span className="pack-choix">{pack === p.id ? "Choisi" : "Choisir"}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2>À la carte</h2></div>
        <div className="modules">
          {ORDRE.map((id) => {
            const m = MODULES[id];
            const inclus = dansPack(id);
            const coche = inclus || mods.includes(id);
            const actif = etat?.actifs.includes(id);
            return (
              <div key={id} className={`module-carte ${m.teinte} ${coche ? "coche" : ""}`}>
                <div className="mc-tete">
                  <span className="mc-ico"><Ico d={ICONE_MODULE[id]} /></span>
                  <button className="mc-titre" onClick={() => setOuvert(ouvert === id ? null : id)} aria-expanded={ouvert === id}>
                    <b>{m.nom}</b><span>{m.accroche}</span>
                  </button>
                  {inclus ? <span className="mc-inclus">Dans le pack</span> : <button className="toggle" role="switch" aria-checked={coche} aria-label={`Ajouter ${m.nom}`} onClick={() => basculer(id)} />}
                </div>
                {ouvert === id && <ul className="mc-liste">{m.inclut.map((x) => <li key={x}>{x}</li>)}<li className="mc-pour">{m.pour}</li></ul>}
                <div className="mc-pied">
                  <span>{eur(prixP(m.mensuel), true)} {par}{m.par === "bien" ? " · 2 biens inclus, +1,50 €/mois par bien" : m.par === "proche" ? " par proche" : ""}</span>
                  {actif && !household.essai?.actif && <span className="badge">actif</span>}
                  {id === "locatif" && coche && <span className="stepper"><button onClick={() => setBiens(Math.max(1, biens - 1))} aria-label="Un bien de moins">−</button>{biens} bien{biens > 1 ? "s" : ""}<button onClick={() => setBiens(biens + 1)} aria-label="Un bien de plus">+</button></span>}
                  {id === "veille" && coche && <span className="stepper"><button onClick={() => setProches(Math.max(1, proches - 1))} aria-label="Un proche de moins">−</button>{proches} proche{proches > 1 ? "s" : ""}<button onClick={() => setProches(proches + 1)} aria-label="Un proche de plus">+</button></span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="note">Prix TTC, sans engagement en mensuel. Le socle est obligatoire pour ajouter des modules. Sans abonnement après l'essai, vos papiers restent consultables et exportables.</p>

      <div className="devis">
        {d.lignes.length > 1 && <div className="devis-lignes">
          {d.lignes.map((l) => <div key={l.libelle}><span>{l.libelle}{l.detail ? <small> · {l.detail}</small> : null}</span><b>{eur(prixP(l.mensuel), true)}</b></div>)}
        </div>}
        {d.conseil && <button className="devis-conseil" onClick={() => { setPack(d.conseil!.pack); setMods(mods.filter((m) => m === "veille")); }}>Le pack {PACKS.find((p) => p.id === d.conseil!.pack)!.nom} couvre ces modules pour {eur(prixP(d.conseil.gain), true)} de moins {par} : le prendre</button>}
        <div className="devis-total">
          <div><b>{eur(d.total, true)}</b><span>{par}{periode === "annuel" ? `, soit ${eur(d.mensuel, true)} par mois` : ""}</span>{d.economie > 0 && <small>{eur(d.economie, true)} d'économie avec le pack</small>}</div>
          <button className="btn" disabled={envoi} onClick={activer}>{etat && !etat.paiement ? "Bientôt" : "Activer"}</button>
        </div>
      </div>
    </div>
  );
}
