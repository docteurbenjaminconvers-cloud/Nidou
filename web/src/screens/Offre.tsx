import { useEffect, useMemo, useState } from "react";
import type { Api, ApercuModules, ModuleId, OffreEtat } from "../api";
import { couvre, devis, MODULES, PACKS, SOCLE, SOCLE_INCLUT, type Formule, type Periode } from "../../../server/src/offre";
import type { Household } from "../types";
import { Back } from "../ui";
import { eur, Ico, ICONES } from "./espacesCommun";
import { ConsentementDemarrage } from "./Settings";
import { ConfirmationPaiement } from "./Confirmation";

const ORDRE: ModuleId[] = ["budget_expert", "vie_pro_salarie", "vie_pro_micro", "vie_pro_independant", "locatif", "assistant", "veille"];
const VIE_PRO: ModuleId[] = ["vie_pro_salarie", "vie_pro_micro", "vie_pro_independant"];
const ICONE_MODULE: Record<ModuleId, string> = {
  budget_expert: ICONES.budget, vie_pro_salarie: ICONES.pro, vie_pro_micro: ICONES.pro, vie_pro_independant: ICONES.pro, locatif: ICONES.locatif,
  assistant: "M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z", veille: "M12 21s-7-4.4-7-10a4 4 0 017-2.6A4 4 0 0119 11c0 5.6-7 10-7 10z",
};

/** « L'offre Lucien » : socle, packs, modules à la carte, devis en direct. */
export function Offre({ api, household, focus, onBack, onChange, toast }: { api: Api; household: Household; focus?: string; onBack: () => void; onChange: () => void; toast: (m: string) => void }) {
  const [etat, setEtat] = useState<OffreEtat | null>(null);
  const abo = household.abonnement;
  const [periode, setPeriode] = useState<Periode>(abo?.periode ?? "annuel");
  const [formule, setFormule] = useState<Formule>(abo?.formule ?? (household.comptes && household.comptes >= 3 ? "tribu" : household.situation === "seul" ? "solo" : "duo"));
  const [pack, setPack] = useState<string | null>(null);
  const [mods, setMods] = useState<ModuleId[]>(focus && focus in MODULES ? [focus as ModuleId] : []);
  const [biens, setBiens] = useState(2);
  const [proches, setProches] = useState(1);
  const [ouvert, setOuvert] = useState<ModuleId | null>(focus && focus in MODULES ? (focus as ModuleId) : null);
  const [envoi, setEnvoi] = useState(false);
  const [demarrage, setDemarrage] = useState(false);
  const [apercu, setApercu] = useState<(ApercuModules & { mode?: "maintenant" | "echeance" }) | null>(null);
  const [apercuFormule, setApercuFormule] = useState<string | null>(null);
  const [cibleFormule, setCibleFormule] = useState<{ formule: Formule; periode: Periode } | null>(null);
  // a running subscription: Solo/Duo/Tribu and the period go through a change of formule (amount shown first)
  const formuleDemander = async (f: Formule, p: Periode) => {
    if (f === abo?.formule && p === abo?.periode) return;
    setEnvoi(true);
    try {
      const r = await api.changerFormule(f, p);
      if (r.apercu) { setCibleFormule({ formule: f, periode: p }); setApercuFormule(`Lucien ${SOCLE[f].nom}, paiement ${p}`); setApercu(r.apercu); }
      else if (r.simule) { toast(`Lucien ${SOCLE[f].nom} (simulé)`); onChange(); }
    } catch (e) { toast((e as Error).message); } finally { setEnvoi(false); }
  };
  const formuleConfirmer = async () => {
    if (!cibleFormule || !apercu) return;
    setEnvoi(true);
    try {
      const r = await api.changerFormule(cibleFormule.formule, cibleFormule.periode, { confirmer: true, proration_date: apercu.proration_date });
      setApercu(null); setApercuFormule(null);
      if (r.url) { location.href = r.url; return; }
      if (r.attente) { toast("Le paiement n'est pas passé : rien n'a changé. Vérifiez votre carte dans « Gérer mon abonnement »."); return; }
      toast(r.prevu ? `C'est noté : Lucien ${SOCLE[r.prevu.formule].nom} à partir du ${date(r.prevu.le)}` : `C'est fait : vous êtes en Lucien ${SOCLE[cibleFormule.formule].nom}`);
      onChange();
    } catch (e) { toast((e as Error).message); } finally { setEnvoi(false); }
  };
  const abonne = ["active", "trialing", "past_due", "simule"].includes(household.abonnement?.statut ?? "");
  // a running subscription keeps its formule and period here (changed in « Gérer mon abonnement »)
  const fige = abonne && abo?.statut !== "simule" && !!abo?.formule;
  useEffect(() => {
    api.offre().then((e) => {
      setEtat(e);
      const ajout = focus && focus in MODULES ? [focus as ModuleId] : [];
      if (e.choix) { // what the subscription bills today, plus the module asked for
        setPack(e.choix.pack); setMods([...new Set([...e.choix.modules, ...ajout])]);
        if (e.choix.proches) setProches(e.choix.proches); setBiens(2 + e.choix.biens_supp);
      } else if (e.souscrits.length) setMods([...new Set([...e.souscrits, ...ajout])]);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const conserve = (m: ModuleId) => etat?.conserves?.find((c) => c.module === m);
  const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }) : "");

  const choix = { formule, periode, modules: mods, pack, biens, proches };
  const d = useMemo(() => devis(choix), [formule, periode, mods, pack, biens, proches]); // eslint-disable-line react-hooks/exhaustive-deps
  const packDef = PACKS.find((p) => p.id === pack);
  const dansPack = (m: ModuleId) => !!packDef && packDef.modules.some((x) => couvre(x, m));
  // the three Vie pro modules are levels of one another: choosing one replaces the others
  const basculer = (m: ModuleId) => setMods((x) => (x.includes(m) ? x.filter((y) => y !== m) : VIE_PRO.includes(m) ? [...x.filter((y) => !VIE_PRO.includes(y)), m] : [...x, m]));
  const par = periode === "annuel" ? "/ an" : "/ mois";
  const prixP = (mensuel: number) => (periode === "annuel" ? mensuel * 10 : mensuel);

  const envoyer = async (confirmer: boolean) => {
    setEnvoi(true);
    try {
      if (!abonne && !demarrage) { toast("Cochez d'abord la case sur le démarrage de l'abonnement."); return; }
      const r = await api.choisirModules(d.modules.filter((m) => !dansPack(m)), pack, { formule, periode, biens, proches, demarrage_immediat: true, ...(confirmer ? { confirmer: true, proration_date: apercu?.proration_date } : {}) });
      if (r.apercu) { setApercu(r.apercu); return; } // a running subscription: the amount first
      setApercu(null);
      if (r.url) { location.href = r.url; return; } // Stripe Checkout, or Stripe's invoice page when the bank asks for a check
      if (r.attente) { toast("Le paiement n'est pas passé : rien n'a changé. Vérifiez votre carte dans « Gérer mon abonnement »."); return; }
      toast(api.mode === "demo" ? "Modules activés (démo)" : "C'est fait : vos modules sont à jour"); onChange();
      api.offre().then(setEtat);
    }
    catch (e) { toast((e as Error).message); }
    finally { setEnvoi(false); }
  };
  const activer = () => envoyer(false);

  return (
    <div className="screen offre">
      <Back onClick={onBack} />
      <div className="offre-tete">
        <h1>L'offre Lucien</h1>
        <p>Un socle pour tout le foyer, puis seulement ce qui vous sert.{household.essai?.actif ? " Pendant l'essai, tous les modules sont ouverts : essayez-les." : ""}</p>
      </div>

      <div className="offre-reglages">
        <div className="pills" role="group" aria-label="Paiement">
          <button className="pill" aria-pressed={periode === "mensuel"} onClick={() => (fige ? formuleDemander(formule, "mensuel") : setPeriode("mensuel"))}>Mensuel</button>
          <button className="pill" aria-pressed={periode === "annuel"} onClick={() => (fige ? formuleDemander(formule, "annuel") : setPeriode("annuel"))}>Annuel · 2 mois offerts</button>
        </div>
        <div className="pills" role="group" aria-label="Formule">
          {(Object.keys(SOCLE) as Formule[]).map((f) => <button key={f} className="pill" aria-pressed={formule === f}  onClick={() => (fige ? formuleDemander(f, periode) : setFormule(f))}>{SOCLE[f].nom} · {SOCLE[f].comptes} compte{SOCLE[f].comptes > 1 ? "s" : ""}</button>)}
        </div>
        {fige && <p className="note">Vous êtes en Lucien {SOCLE[formule].nom}, paiement {periode === "annuel" ? "annuel" : "mensuel"} : touchez une autre formule ou un autre rythme pour en changer.</p>}
        {abo?.changement_prevu && <p className="note">Passage à Lucien {SOCLE[abo.changement_prevu.formule].nom} (paiement {abo.changement_prevu.periode}) prévu le {date(abo.changement_prevu.le)}.</p>}
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
                  {actif && !household.essai?.actif && !(conserve(id) && !coche) && <span className="badge">actif</span>}
                  {conserve(id) && !coche && <span className="badge yolk">jusqu'au {date(conserve(id)!.jusqu_au)}</span>}
                  {id === "locatif" && coche && <span className="stepper"><button onClick={() => setBiens(Math.max(1, biens - 1))} aria-label="Un bien de moins">−</button>{biens} bien{biens > 1 ? "s" : ""}<button onClick={() => setBiens(biens + 1)} aria-label="Un bien de plus">+</button></span>}
                  {id === "veille" && coche && <span className="stepper"><button onClick={() => setProches(Math.max(1, proches - 1))} aria-label="Un proche de moins">−</button>{proches} proche{proches > 1 ? "s" : ""}<button onClick={() => setProches(proches + 1)} aria-label="Un proche de plus">+</button></span>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="note">{abonne ? "Une option ajoutée est payée tout de suite, au prorata jusqu'à votre échéance. Une option retirée reste ouverte jusqu'à l'échéance, sans remboursement. " : ""}Prix TTC, sans engagement en mensuel. Le socle est obligatoire pour ajouter des modules. Sans abonnement après l'essai, vos papiers restent consultables et exportables.</p>

      {household.abonnement?.statut === "offert" && <p className="note" style={{ background: "var(--moss-soft)", padding: "10px 12px", borderRadius: 12 }}>Votre accès offert d'avant-première comprend déjà tous les modules : rien à activer.</p>}
      {!abonne && household.abonnement?.statut !== "offert" && etat?.paiement !== false && <ConsentementDemarrage coche={demarrage} onChange={setDemarrage} />}
      <div className="devis">
        {d.lignes.length > 1 && <div className="devis-lignes">
          {d.lignes.map((l) => <div key={l.libelle}><span>{l.libelle}{l.detail ? <small> · {l.detail}</small> : null}</span><b>{eur(prixP(l.mensuel), true)}</b></div>)}
        </div>}
        {d.conseil && <button className="devis-conseil" onClick={() => { setPack(d.conseil!.pack); setMods(mods.filter((m) => m === "veille")); }}>Le pack {PACKS.find((p) => p.id === d.conseil!.pack)!.nom} couvre ces modules pour {eur(prixP(d.conseil.gain), true)} de moins {par} : le prendre</button>}
        <div className="devis-total">
          <div><b>{eur(d.total, true)}</b><span>{par}{periode === "annuel" ? `, soit ${eur(d.mensuel, true)} par mois` : ""}</span>{d.economie > 0 && <small>{eur(d.economie, true)} d'économie avec le pack</small>}</div>
          <button className="btn" disabled={envoi || household.abonnement?.statut === "offert" || (etat ? !etat.paiement : false)} onClick={activer}>{household.abonnement?.statut === "offert" ? "Inclus" : etat && !etat.paiement ? "Bientôt" : "Activer"}</button>
        </div>
      </div>

      {apercu && <ConfirmationPaiement apercu={apercu} periode={periode} envoi={envoi} titre={apercuFormule ? "Changer de formule" : undefined} nouveau={apercuFormule ?? undefined} onAnnuler={() => { setApercu(null); setApercuFormule(null); }} onConfirmer={() => (apercuFormule ? formuleConfirmer() : envoyer(true))} />}
    </div>
  );
}
