import { useEffect, useState } from "react";
import type { Api, EtatPoche } from "../api";
import { Back, fmtEuro } from "../ui";

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const nombre = (s: string) => Number(s.replace(",", ".").replace(/[^\d.]/g, ""));
const dateFr = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const court = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
const LIGNE: Record<string, string> = { versement: "Argent de poche", depense: "Dépense", bonus: "Bonus", retenue: "Retenue", mission: "Mission" };
type Saisie = { type: "depense" | "bonus" | "retenue"; montant: string; libelle: string };

/**
 * Argent de poche d'un enfant : sa cagnotte (tenue par les parents, Lucien compte), l'argent de poche qui s'y ajoute
 * tout seul, ce qui est dépensé, les missions payées et les objectifs pour lesquels on met de côté.
 */
export function Poche({ api, membre, onBack, toast }: { api: Api; membre: string; onBack: () => void; toast: (m: string) => void }) {
  const [e, setE] = useState<EtatPoche | null>(null);
  const [regle, setRegle] = useState<{ montant: string; frequence: "semaine" | "mois"; jour: number } | null>(null);
  const [saisie, setSaisie] = useState<Saisie | null>(null);
  const [objectif, setObjectif] = useState<{ titre: string; cible: string } | null>(null);
  const [mission, setMission] = useState<{ titre: string; montant: string } | null>(null);
  useEffect(() => { api.poche(membre).then(setE).catch((x) => toast((x as Error).message)); }, [membre]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return <div className="screen"><Back onClick={onBack} /><h1>Argent de poche</h1><p className="note">Chargement…</p></div>;

  const faire = async (p: Promise<EtatPoche>, dit?: string) => { try { setE(await p); if (dit) toast(dit); return true; } catch (x) { toast((x as Error).message); return false; } };
  const r = e.reglage;
  const ouvrirReglage = () => setRegle({ montant: r && r.montant ? String(r.montant).replace(".", ",") : "", frequence: r?.frequence ?? "semaine", jour: r?.jour ?? 6 });
  const rythme = r && r.actif ? `${fmtEuro(r.montant, r.montant % 1 ? 2 : 0)} ${r.frequence === "semaine" ? `chaque ${JOURS[r.jour - 1]}` : `le ${r.jour === 1 ? "1er" : r.jour} du mois`}` : null;

  return (
    <div className="screen poche">
      <Back onClick={onBack} />
      <div className="top"><div><h1>Argent de poche</h1><p className="sub">La cagnotte de {e.prenom}. Vous gardez l'argent, Lucien tient le compte.</p></div></div>

      <div className={`poche-solde ${e.disponible < 0 ? "avance" : ""}`}>
        <span>{e.disponible < 0 ? "Avance à rembourser" : "Disponible"}</span>
        <b>{fmtEuro(Math.abs(e.disponible), 2)}</b>
        {e.mis_de_cote > 0 && <span>+ {fmtEuro(e.mis_de_cote, 2)} mis de côté · {fmtEuro(e.solde, 2)} en tout</span>}
        <span>{e.prochain ? `Prochain argent de poche : ${fmtEuro(e.prochain.montant, e.prochain.montant % 1 ? 2 : 0)} ${dateFr(e.prochain.date)}` : "Pas d'argent de poche régulier pour l'instant"}</span>
      </div>

      {!saisie && <div className="pills poche-actions">
        <button className="pill" onClick={() => setSaisie({ type: "depense", montant: "", libelle: "" })}>− Une dépense</button>
        <button className="pill" onClick={() => setSaisie({ type: "bonus", montant: "", libelle: "" })}>+ Un bonus</button>
        <button className="pill" onClick={() => setSaisie({ type: "retenue", montant: "", libelle: "" })}>Une retenue</button>
      </div>}
      {saisie && (
        <div className="poche-form">
          <b>{saisie.type === "depense" ? `${e.prenom} a dépensé` : saisie.type === "bonus" ? `Un bonus pour ${e.prenom}` : "Une retenue"}</b>
          <input className="in" inputMode="decimal" placeholder="Montant en €" value={saisie.montant} onChange={(x) => setSaisie({ ...saisie, montant: x.target.value })} autoFocus />
          <input className="in" maxLength={80} placeholder={saisie.type === "depense" ? "Pour quoi ? (cinéma, vêtements…)" : saisie.type === "bonus" ? "Pourquoi ? (bulletin, anniversaire…)" : "Pourquoi ?"} value={saisie.libelle} onChange={(x) => setSaisie({ ...saisie, libelle: x.target.value })} />
          <div className="actions"><button className="btn" onClick={async () => {
            const m = nombre(saisie.montant);
            if (!(m > 0) || !saisie.libelle.trim()) return toast("Un montant et un mot d'explication, s'il vous plaît");
            if (await faire(api.pocheMouvement(membre, { type: saisie.type, montant: m, libelle: saisie.libelle.trim() }), "C'est noté")) setSaisie(null);
          }}>Noter</button><button className="btn ghost" onClick={() => setSaisie(null)}>Annuler</button></div>
        </div>
      )}

      <section className="section">
        <div className="section-head"><h2>Le rythme</h2>{!regle && <button className="link" onClick={ouvrirReglage}>{rythme ? "Modifier" : "Mettre en place"}</button>}</div>
        {!regle ? <p className="note">{rythme ? `${rythme}. Il s'ajoute tout seul à la cagnotte ce jour-là.` : `Choisissez un montant et un jour : l'argent de poche de ${e.prenom} s'ajoutera tout seul à sa cagnotte.`}</p> : (
          <div className="poche-form">
            <input className="in" inputMode="decimal" placeholder="Montant en € (0 pour arrêter)" value={regle.montant} onChange={(x) => setRegle({ ...regle, montant: x.target.value })} />
            <div className="pills">
              <button className="pill" aria-pressed={regle.frequence === "semaine"} onClick={() => setRegle({ ...regle, frequence: "semaine", jour: Math.min(regle.jour, 7) })}>Chaque semaine</button>
              <button className="pill" aria-pressed={regle.frequence === "mois"} onClick={() => setRegle({ ...regle, frequence: "mois", jour: 1 })}>Chaque mois</button>
            </div>
            {regle.frequence === "semaine"
              ? <div className="pills">{JOURS.map((j, k) => <button key={j} className="pill" aria-pressed={regle.jour === k + 1} onClick={() => setRegle({ ...regle, jour: k + 1 })}>{j.slice(0, 3)}</button>)}</div>
              : <label className="note" style={{ display: "flex", gap: 8, alignItems: "center" }}>Le <input className="in" style={{ width: 80 }} type="number" min={1} max={28} value={regle.jour} onChange={(x) => setRegle({ ...regle, jour: Math.max(1, Math.min(28, Number(x.target.value) || 1)) })} /> du mois</label>}
            <div className="actions"><button className="btn" onClick={async () => {
              const m = regle.montant.trim() ? nombre(regle.montant) : 0;
              if (Number.isNaN(m) || m < 0) return toast("Indiquez un montant");
              if (await faire(api.pocheReglage(membre, { montant: m, frequence: regle.frequence, jour: regle.jour, actif: m > 0 }), m > 0 ? "Argent de poche réglé" : "Argent de poche arrêté")) setRegle(null);
            }}>Enregistrer</button><button className="btn ghost" onClick={() => setRegle(null)}>Annuler</button></div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Objectifs</h2>{!objectif && <button className="link" onClick={() => setObjectif({ titre: "", cible: "" })}>Ajouter</button>}</div>
        {e.objectifs.length === 0 && !objectif && <p className="note">Un casque, un concert, un vélo : {e.prenom} met de côté petit à petit et voit le chemin parcouru.</p>}
        {e.objectifs.map((o) => {
          const pct = Math.min(100, Math.round((o.mis_de_cote / o.cible) * 100));
          const reste = Math.max(0, o.cible - o.mis_de_cote);
          const pas = [5, 10].filter((p) => p <= Math.max(0, e.disponible) + 0.001 && p <= reste + 0.001);
          return (
            <div key={o.id} className="poche-objectif">
              <div className="poche-objectif-tete"><b>{o.titre}</b><span>{fmtEuro(o.mis_de_cote, 2)} sur {fmtEuro(o.cible, 2)}</span></div>
              <div className="poche-jauge" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${pct}%` }} /></div>
              <div className="poche-objectif-actions">
                {reste <= 0.004 ? <button className="btn" onClick={() => faire(api.pocheObjectifAcheter(o.id), "Objectif atteint, bravo !")}>C'est acheté</button> : <>
                  {pas.map((p) => <button key={p} className="pill" onClick={() => faire(api.pocheObjectifMettre(o.id, p))}>+ {p} €</button>)}
                  {e.disponible > 0.004 && <button className="pill" onClick={() => faire(api.pocheObjectifMettre(o.id, Math.min(e.disponible, reste)))}>{e.disponible >= reste ? "Compléter" : "Tout le disponible"}</button>}
                  {e.disponible <= 0.004 && <span className="note">Rien de disponible à mettre de côté pour l'instant.</span>}
                </>}
                {o.mis_de_cote > 0 && reste > 0.004 && <button className="link" onClick={() => faire(api.pocheObjectifMettre(o.id, -o.mis_de_cote))}>Tout reprendre</button>}
                <button className="link discret" onClick={() => faire(api.pocheObjectifSupprimer(o.id), "Objectif retiré")}>Retirer</button>
              </div>
            </div>
          );
        })}
        {objectif && (
          <div className="poche-form">
            <input className="in" maxLength={60} placeholder="Pour quoi ? (casque, concert…)" value={objectif.titre} onChange={(x) => setObjectif({ ...objectif, titre: x.target.value })} autoFocus />
            <input className="in" inputMode="decimal" placeholder="Prix en €" value={objectif.cible} onChange={(x) => setObjectif({ ...objectif, cible: x.target.value })} />
            <div className="actions"><button className="btn" onClick={async () => {
              const c = nombre(objectif.cible);
              if (!(c > 0) || !objectif.titre.trim()) return toast("Un nom et un prix, s'il vous plaît");
              if (await faire(api.pocheObjectif(membre, { titre: objectif.titre.trim(), cible: c }), "Objectif ajouté")) setObjectif(null);
            }}>Ajouter</button><button className="btn ghost" onClick={() => setObjectif(null)}>Annuler</button></div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Missions payées</h2>{!mission && <button className="link" onClick={() => setMission({ titre: "", montant: "" })}>Ajouter</button>}</div>
        {e.missions.length === 0 && !mission && <p className="note">Tondre la pelouse, laver la voiture, garder le petit frère : un coup de main qui rapporte un peu plus.</p>}
        {e.missions.map((m) => (
          <div key={m.id} className="poche-mission">
            <span><b>{m.titre}</b> · {fmtEuro(m.montant, m.montant % 1 ? 2 : 0)}</span>
            <span className="poche-mission-actions"><button className="btn ghost" onClick={() => faire(api.pocheMissionPayer(m.id), `${fmtEuro(m.montant, m.montant % 1 ? 2 : 0)} ajoutés à la cagnotte`)}>C'est fait</button><button className="link discret" aria-label={`Retirer la mission ${m.titre}`} onClick={() => faire(api.pocheMissionSupprimer(m.id))}>Retirer</button></span>
          </div>
        ))}
        {mission && (
          <div className="poche-form">
            <input className="in" maxLength={60} placeholder="Quelle mission ?" value={mission.titre} onChange={(x) => setMission({ ...mission, titre: x.target.value })} autoFocus />
            <input className="in" inputMode="decimal" placeholder="Payée combien, en € ?" value={mission.montant} onChange={(x) => setMission({ ...mission, montant: x.target.value })} />
            <div className="actions"><button className="btn" onClick={async () => {
              const m = nombre(mission.montant);
              if (!(m > 0) || !mission.titre.trim()) return toast("Un nom et un montant, s'il vous plaît");
              if (await faire(api.pocheMission(membre, { titre: mission.titre.trim(), montant: m }), "Mission ajoutée")) setMission(null);
            }}>Ajouter</button><button className="btn ghost" onClick={() => setMission(null)}>Annuler</button></div>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head"><h2>Le carnet</h2>{(e.recu_mois > 0 || e.depense_mois > 0) && <span className="badge">ce mois : + {fmtEuro(e.recu_mois, 2)} · − {fmtEuro(e.depense_mois, 2)}</span>}</div>
        {e.mouvements.length === 0 ? <p className="note">Rien pour l'instant. Les lignes apparaîtront ici, la plus récente en haut.</p> : (
          <ul className="poche-carnet">
            {e.mouvements.map((m) => (
              <li key={m.id}>
                <span className="poche-date">{court(m.date)}</span>
                <span className="poche-libelle"><b>{m.libelle}</b><small>{LIGNE[m.type] ?? m.type}</small></span>
                <span className={`poche-montant ${m.montant < 0 ? "moins" : "plus"}`}>{m.montant < 0 ? "− " : "+ "}{fmtEuro(Math.abs(m.montant), 2)}</span>
                <button className="link discret" aria-label={`Effacer la ligne ${m.libelle}`} onClick={() => faire(api.pocheEffacer(m.id), "Ligne effacée")}>×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="note">Lucien ne déplace pas d'argent : il tient le compte de ce que vous gardez pour {e.prenom}. Quand vous lui donnez de l'argent ou qu'il paie avec, notez une dépense.</p>
    </div>
  );
}

/** On a child's page and on the family page: the kitty at a glance, and the way in. */
export function PocheCarte({ api, membre, prenom, go, version = 0 }: { api: Api; membre: string; prenom: string; go: (s: string, id?: string) => void; version?: number }) {
  const [e, setE] = useState<EtatPoche | null>(null);
  useEffect(() => { api.poche(membre).then(setE).catch(() => {}); }, [membre, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const enPlace = !!e && (!!e.reglage || e.mouvements.length > 0);
  return (
    <section className="section">
      <div className="section-head"><h2>Argent de poche</h2><button className="link" onClick={() => go("poche", membre)}>{enPlace ? "Ouvrir" : "Mettre en place"}</button></div>
      {enPlace && e ? (
        <button className="poche-carte" onClick={() => go("poche", membre)}>
          <b>{fmtEuro(e.disponible, 2)}</b>
          <span>{e.disponible < 0 ? "d'avance à rembourser" : "disponibles"}{e.mis_de_cote > 0 ? ` · ${fmtEuro(e.mis_de_cote, 2)} mis de côté` : ""}{e.prochain ? ` · prochain versement ${court(e.prochain.date)}` : ""}</span>
        </button>
      ) : <p className="note">Un montant, un jour : la cagnotte de {prenom} se tient toute seule, avec ses dépenses, ses missions et ses objectifs.</p>}
    </section>
  );
}
