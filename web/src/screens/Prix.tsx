import { useEffect, useState } from "react";
import type { Api, EtatPrix } from "../api";
import type { Doc } from "../types";

const COMPARABLES = ["energie", "telecom", "assurance", "abonnement"];
const euros = (n: number) => `${n.toLocaleString("fr-FR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })} €`;
const jour = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** « Payez-vous le bon prix ? » : Lucien searches today's offers for this contract, each with the page it was read on. */
export function ObservatoirePrix({ api, doc, toast }: { api: Api; doc: Doc; toast: (m: string) => void }) {
  const [e, setE] = useState<EtatPrix | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const visible = COMPARABLES.includes(doc.category) && !!doc.montant;
  useEffect(() => { setE(null); setErr(null); if (visible) api.prixDocument(doc.id).then(setE).catch(() => {}); }, [doc.id, doc.montant, doc.category]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!visible || !e?.comparable) return null;
  const chercher = async () => {
    setBusy(true); setErr(null);
    try { const r = await api.chercherPrix(doc.id); setE(r); toast(r.recherche?.offres.length ? "Offres trouvées" : "Recherche terminée"); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };
  const r = e.recherche;
  const meilleure = r?.offres.find((o) => o.economie_annuelle);
  return (
    <section className="section prix">
      <div className="section-head"><h2>Payez-vous le bon prix ?</h2></div>
      {!r && !busy && (
        <div className="prix-carte">
          <p>Vous payez <b>{euros(e.paye_mensuel)} par mois</b>. Je peux chercher sur le web les offres du moment pour le même service, et vous dire s'il y a mieux.</p>
          <button className="btn" disabled={!e.disponible || e.restantes <= 0} onClick={chercher}>Chercher moins cher</button>
          <p className="note">{!e.disponible ? "La recherche fait partie de la formule complète." : e.restantes <= 0 ? `Vos ${e.par_mois} recherches du mois sont utilisées : elles reviennent le 1er.` : `Environ une minute. ${e.restantes} recherche${e.restantes > 1 ? "s" : ""} sur ${e.par_mois} ce mois-ci. Je ne touche aucune commission.`}</p>
        </div>
      )}
      {busy && <div className="prix-carte prix-attente"><span className="spinner" /><div><b>Je cherche les offres du moment…</b><span>Je lis les sites des fournisseurs et les références officielles. Comptez une minute, vous pouvez rester sur cette page.</span></div></div>}
      {r && !busy && (
        <div className="prix-carte">
          {meilleure ? <p className="prix-gain">Jusqu'à <b>{euros(meilleure.economie_annuelle!)} par an</b> à gagner</p> : <p className="prix-gain bon">Rien de nettement moins cher trouvé</p>}
          {r.resume && <p>{r.resume}</p>}
          {r.reference && <p className="prix-ref"><b>Référence officielle :</b> {r.reference}</p>}
          {r.offres.length > 0 && (
            <ul className="prix-offres">
              {r.offres.map((o, k) => (
                <li key={k}>
                  <div className="prix-tete"><b>{o.fournisseur}</b>{o.economie_annuelle ? <span className="prix-eco">− {euros(o.economie_annuelle)}/an</span> : null}</div>
                  {o.offre && <span className="prix-offre">{o.offre}{o.prix_mensuel !== null ? ` · ${euros(o.prix_mensuel)}/mois` : ""}</span>}
                  {o.prix_detail && <span>{o.prix_detail}</span>}
                  {o.conditions && <span>{o.conditions}</span>}
                  <a href={o.url} target="_blank" rel="noopener noreferrer nofollow">Voir l'offre sur {o.site}</a>
                </li>
              ))}
            </ul>
          )}
          {r.prudence && <p className="note">{r.prudence}</p>}
          <p className="note">Recherche du {jour(r.cherche_le)}, pour {euros(r.paye_mensuel)} par mois payés aujourd'hui. Prix lus sur les pages citées : vérifiez-les avant de vous engager. Lucien ne touche aucune commission.</p>
          {r.sources.length > 0 && <details className="prix-sources"><summary>Pages consultées ({r.sources.length})</summary><ul>{r.sources.map((s) => <li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer nofollow">{s.titre}</a></li>)}</ul></details>}
          {meilleure && <p className="note">Pour changer : la lettre de résiliation est prête juste en dessous, dans « Courrier prêt à envoyer ».</p>}
          {!e.valable && <button className="btn ghost" disabled={!e.disponible || e.restantes <= 0} onClick={chercher}>Chercher à nouveau</button>}
        </div>
      )}
      {err && <p className="note" style={{ color: "var(--ember)" }}>{err}</p>}
    </section>
  );
}
