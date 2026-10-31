import type { Doc } from "../types";
import { NUMEROS, scenarios } from "../../../server/src/urgence";
import { Back } from "../ui";

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
const telLisible = (t: string) => (t.length === 10 ? t.replace(/(\d)(\d{3})(\d{3})(\d{3})/, "$1 $2 $3 $4") : t);

/** Discreet entry, at the bottom of the home screen. */
export function UrgenceCarte({ go }: { go: (s: string) => void }) {
  return (
    <button className="urgence-carte" onClick={() => go("urgence")}>
      <span className="urgence-ico"><Ico d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /></span>
      <span><b>En cas de coup dur</b><span>Portefeuille perdu, dégât des eaux, accident, hôpital : quoi faire, dans l'ordre.</span></span>
    </button>
  );
}

export function Urgence({ docs, go, onBack }: { docs: Doc[]; go: (s: string, id?: string) => void; onBack: () => void }) {
  const liste = scenarios(docs);
  return (
    <div className="screen">
      <Back onClick={onBack} />
      <h1 className="detail-title">En cas de coup dur</h1>
      <p className="detail-sub">Respirez. Voici quoi faire, dans l'ordre, avec vos numéros de contrat déjà sous la main.</p>
      <div className="numeros">
        {NUMEROS.map((n) => <a key={n.tel} className="numero" href={`tel:${n.tel}`}><b>{n.tel}</b><span>{n.libelle}</span></a>)}
      </div>
      <ul className="list" style={{ marginTop: 18 }}>
        {liste.map((s) => (
          <li key={s.cle}>
            <button className="row-item dossier-row" onClick={() => go("coup-dur", s.cle)}>
              <div className="cat"><Ico d={s.icone} /></div>
              <div><div className="t">{s.titre}</div><div className="s">{s.quand}</div></div>
              <div className="r"><Ico d="M9 18l6-6-6-6" /></div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoupDur({ cle, docs, go, onBack }: { cle: string; docs: Doc[]; go: (s: string, id?: string) => void; onBack: () => void }) {
  const s = scenarios(docs).find((x) => x.cle === cle);
  if (!s) return <div className="screen"><Back onClick={onBack} /><p className="note">Introuvable.</p></div>;
  return (
    <div className="screen coup-dur">
      <Back onClick={onBack} label="Coup dur" />
      <h1 className="detail-title">{s.titre}</h1>
      <p className="detail-sub">{s.quand}</p>
      <ol className="etapes">
        {s.etapes.map((e, i) => (
          <li key={i}>
            <span className="etape-n">{i + 1}</span>
            <div>
              <b>{e.titre}</b>
              {e.delai && <span className="etape-delai">{e.delai}</span>}
              <p>{e.detail}</p>
              <div className="etape-actions">
                {e.tel && <a className="btn" href={`tel:${e.tel}`}>Appeler le {telLisible(e.tel)}</a>}
                {e.lien && <a className="btn ghost" href={e.lien} target="_blank" rel="noreferrer">{new URL(e.lien).hostname.replace(/^www\./, "")}</a>}
              </div>
            </div>
          </li>
        ))}
      </ol>
      {s.references.length > 0 && (
        <section className="section" style={{ marginTop: 22 }}>
          <div className="section-head"><h2>Vos références</h2></div>
          <ul className="list">
            {s.references.map((r) => (
              <li key={r.id}>
                <button className="row-item" onClick={() => go("doc", r.id)}>
                  <div className="cat"><Ico d="M4 4h10l6 6v10H4zM14 4v6h6" /></div>
                  <div><div className="t">{r.titre}</div><div className="s">{[r.organisme, r.numero ? `n° ${r.numero}` : null].filter(Boolean).join(" · ") || "Ouvrir le papier"}</div></div>
                  <span />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="note" style={{ marginTop: 14 }}>Délais et démarches d'après <a href={s.source} target="_blank" rel="noreferrer">service-public.gouv.fr</a> et le Code des assurances. Votre contrat peut prévoir mieux : il fait foi.</p>
    </div>
  );
}
