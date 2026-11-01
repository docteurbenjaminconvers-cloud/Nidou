import { useEffect, useState } from "react";
import type { Api, SituationsEtat, SituationVue } from "../api";
import { Back, relative } from "../ui";
import { Feuille } from "./espacesCommun";

const Ico = ({ d, size = 22 }: { d: string; size?: number }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const auj = () => new Date().toISOString().slice(0, 10);
const dateFr = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

/** Entry card on the home screen. */
export function SituationsCarte({ go }: { go: (s: string, id?: string) => void }) {
  return (
    <button className="situations-carte" onClick={() => go("situations")}>
      <span className="situations-ico"><Ico d="M4 19h16M6 15l4-4 3 3 5-6" /></span>
      <span><b>Un grand moment à venir ?</b><span>Déménagement, naissance, mariage, nouvelle voiture… Lucien prépare chaque démarche, à la bonne date.</span></span>
      <Ico d="M9 18l6-6-6-6" />
    </button>
  );
}

/** Situations de vie : the catalogue, the ones in progress, and the form to start one. */
export function Situations({ api, go, onBack, onChanged, toast }: { api: Api; go: (s: string, id?: string) => void; onBack: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const [e, setE] = useState<SituationsEtat | null>(null);
  const [choix, setChoix] = useState<SituationsEtat["catalogue"][number] | null>(null);
  const [f, setF] = useState({ date: "", locataire: true, meuble: false, zone_tendue: false, ancienne_adresse: "", nouvelle_adresse: "", bailleur: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.situations().then(setE).catch((x) => toast((x as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return <div className="screen"><Back onClick={onBack} /><p className="note">Chargement…</p></div>;
  const demenagement = choix?.cle === "demenagement";
  const lancer = async () => {
    if (!choix || !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) return toast("Indiquez la date, s'il vous plaît");
    setBusy(true);
    try {
      const s = await api.ouvrirSituation({ cle: choix.cle, date: f.date, locataire: choix.locataire ? f.locataire : false, ...(demenagement ? { meuble: f.meuble, zone_tendue: f.zone_tendue, ancienne_adresse: f.ancienne_adresse || null, nouvelle_adresse: f.nouvelle_adresse || null, bailleur: f.bailleur || null } : {}) });
      onChanged(); toast(`${s.etapes.length} démarches ajoutées à votre agenda`); go("situation", s.id);
    } catch (x) { toast((x as Error).message); } finally { setBusy(false); }
  };

  if (choix) return (
    <div className="screen situations">
      <Back onClick={() => setChoix(null)} label="Situations" />
      <h1 className="detail-title">{choix.titre}</h1>
      <p className="detail-sub">{choix.accroche}</p>
      <div className="lock form-espace">
        <label className="champ"><span>{choix.question}</span><input className="in" type="date" value={f.date} onChange={(x) => setF({ ...f, date: x.target.value })} /></label>
        {choix.locataire && <label className="case"><input type="checkbox" checked={f.locataire} onChange={(x) => setF({ ...f, locataire: x.target.checked })} /> Je suis locataire de mon logement actuel</label>}
        {demenagement && <>
          {f.locataire && <>
            <label className="case"><input type="checkbox" checked={f.meuble} onChange={(x) => setF({ ...f, meuble: x.target.checked })} /> Logement loué meublé</label>
            <label className="case"><input type="checkbox" checked={f.zone_tendue} onChange={(x) => setF({ ...f, zone_tendue: x.target.checked })} /> En zone tendue (grandes villes : préavis d'un mois)</label>
            <label className="champ"><span>Bailleur ou agence (nom et adresse)</span><input className="in" value={f.bailleur} onChange={(x) => setF({ ...f, bailleur: x.target.value })} /></label>
          </>}
          <label className="champ"><span>Adresse actuelle</span><input className="in" value={f.ancienne_adresse} onChange={(x) => setF({ ...f, ancienne_adresse: x.target.value })} /></label>
          <label className="champ"><span>Nouvelle adresse</span><input className="in" value={f.nouvelle_adresse} onChange={(x) => setF({ ...f, nouvelle_adresse: x.target.value })} placeholder="Si vous la connaissez déjà" /></label>
        </>}
        <button className="btn block" style={{ marginTop: 12 }} disabled={busy} onClick={lancer}>{busy ? "Préparation…" : "Lucien s'en occupe"}</button>
        <p className="note" style={{ marginTop: 8 }}>Chaque démarche s'ajoute à votre agenda à sa date, avec un rappel avant.</p>
      </div>
    </div>
  );

  return (
    <div className="screen situations">
      <Back onClick={onBack} />
      <h1 className="detail-title">Situations de vie</h1>
      <p className="detail-sub">Choisissez ce qui arrive et sa date : Lucien prépare chaque démarche, dans l'ordre, avec les courriers et les dossiers.</p>
      {e.actives.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>En cours</h2></div>
          {e.actives.map((s) => {
            const prochaine = s.etapes.find((x) => !x.fait);
            return (
              <button key={s.id} className="situation-active" onClick={() => go("situation", s.id)}>
                <span><b>{s.titre}</b><small>{dateFr(s.date)} · {s.faites}/{s.etapes.length} faites</small>{prochaine && <small className="prochaine">Ensuite : {prochaine.titre} ({relative(prochaine.date)})</small>}</span>
                <span className="progres" aria-hidden><i style={{ width: `${Math.round((s.faites / Math.max(1, s.etapes.length)) * 100)}%` }} /></span>
              </button>
            );
          })}
        </section>
      )}
      <section className="section">
        <div className="section-head"><h2>Que se passe-t-il ?</h2></div>
        <div className="situations-grille">
          {e.catalogue.map((c) => (
            <button key={c.cle} className={`situation-choix ${c.teinte}`} onClick={() => { setF({ ...f, date: "" }); setChoix(c); }}>
              <span className="situation-ico"><Ico d={c.icone} /></span>
              <b>{c.titre}</b>
              <span>{c.accroche}</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

/** One situation: its steps in date order, to tick, with their papers, letters and files. */
export function SituationDetail({ api, id, go, onBack, onChanged, toast }: { api: Api; id: string; go: (s: string, id?: string) => void; onBack: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const [s, setS] = useState<SituationVue | null>(null);
  const [lettre, setLettre] = useState<{ titre: string; texte: string } | null>(null);
  const [fermer, setFermer] = useState(false);
  useEffect(() => { api.situations().then((e) => setS(e.actives.find((x) => x.id === id) ?? null)).catch((x) => toast((x as Error).message)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return <div className="screen"><Back onClick={onBack} label="Situations" /><p className="note">Chargement…</p></div>;
  const cocher = async (cle: string, fait: boolean) => { setS(await api.cocherEtape(s.id, cle, fait)); onChanged(); };
  const courrier = async (etape: string, titre: string, doc?: string | null) => setLettre({ titre, texte: await api.courrierSituation(s.id, etape, doc) });
  const today = auj();
  const groupes = [
    { titre: "Avant", etapes: s.etapes.filter((e) => e.date < s.date) },
    { titre: "Le jour même", etapes: s.etapes.filter((e) => e.date === s.date) },
    { titre: "Après", etapes: s.etapes.filter((e) => e.date > s.date) },
  ].filter((g) => g.etapes.length);
  return (
    <div className="screen situations">
      <Back onClick={onBack} label="Situations" />
      <h1 className="detail-title">{s.titre}</h1>
      <p className="detail-sub">{dateFr(s.date)} · {s.faites} sur {s.etapes.length} démarches faites</p>
      <div className="progres grand" aria-hidden><i style={{ width: `${Math.round((s.faites / Math.max(1, s.etapes.length)) * 100)}%` }} /></div>
      {groupes.map((g) => (
        <section className="section" key={g.titre}>
          <div className="section-head"><h2>{g.titre}</h2></div>
          {g.etapes.map((e) => (
            <div key={e.cle} className={`etape ${e.fait ? "faite" : ""} ${!e.fait && e.date < today ? "retard" : ""}`}>
              <button className="etape-case" aria-label={e.fait ? "Marquer comme à faire" : "Marquer comme fait"} aria-pressed={e.fait} onClick={() => cocher(e.cle, !e.fait)}>{e.fait ? "✓" : ""}</button>
              <div className="etape-corps">
                <b>{e.titre}</b>
                <small>{dateFr(e.date)} · {e.fait ? "fait" : relative(e.date)}</small>
                <p>{e.detail}</p>
                {e.papiers.length > 0 && <div className="etape-papiers">{e.papiers.map((p) => (
                  <span key={p.id} className="etape-papier">
                    <button className="link" onClick={() => go("doc", p.id)}>{p.title}</button>
                    {e.courrier === "adresse" && <button className="link discret" onClick={() => courrier(e.cle, `Changement d'adresse — ${p.organisme ?? p.title}`, p.id)}>Courrier</button>}
                  </span>
                ))}</div>}
                <div className="etape-actions">
                  {e.courrier === "conge_locataire" && <button className="pill" onClick={() => courrier(e.cle, "Congé au bailleur")}>Préparer la lettre de congé</button>}
                  {e.courrier === "adresse" && e.papiers.length === 0 && <button className="pill" onClick={() => courrier(e.cle, "Changement d'adresse")}>Courrier de changement d'adresse</button>}
                  {e.dossier && <button className="pill" onClick={() => go("dossier", e.dossier!)}>Ouvrir le dossier</button>}
                  {e.ecran && <button className="pill" onClick={() => go(e.ecran!)}>Ouvrir</button>}
                  {e.lien && <a className="pill" href={e.lien.url} target="_blank" rel="noreferrer">{e.lien.libelle} ↗</a>}
                </div>
              </div>
            </div>
          ))}
        </section>
      ))}
      <div style={{ margin: "10px 0 30px" }}>
        {fermer ? (
          <p className="note">Clore la situation retire de l'agenda les démarches qui restent à faire. <button className="link" onClick={async () => { await api.fermerSituation(s.id); onChanged(); toast("Situation close"); go("situations"); }}>Confirmer</button> · <button className="link" onClick={() => setFermer(false)}>Garder</button></p>
        ) : <button className="link" style={{ color: "var(--mist)" }} onClick={() => setFermer(true)}>Clore cette situation</button>}
      </div>
      {lettre && <Feuille titre={lettre.titre} texte={lettre.texte} fichier={`${lettre.titre.replace(/[^\p{L}\p{N} -]+/gu, "").trim()}.txt`} onClose={() => setLettre(null)} />}
    </div>
  );
}
