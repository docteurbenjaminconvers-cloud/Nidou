import type { Api } from "../api";
import type { Doc, Household } from "../types";
import { bordereau, etatDossiers, type EtatKit, type PieceEtat } from "../../../server/src/dossiers";
import { Back, fmtDate } from "../ui";

export const calculerDossiers = (docs: Doc[]) => etatDossiers(docs);

const Ico = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);

const STATUT: Record<PieceEtat["statut"], { label: string; cls: string }> = {
  ok: { label: "Prête", cls: "ok" },
  ancien: { label: "Trop ancienne", cls: "warn" },
  expire: { label: "Expirée", cls: "late" },
  manquant: { label: "À ajouter", cls: "todo" },
};

function Jauge({ e, grande = false }: { e: EtatKit; grande?: boolean }) {
  const pct = e.requis ? e.prets / e.requis : 0;
  const r = grande ? 34 : 20, c = 2 * Math.PI * r, s = grande ? 84 : 50;
  return (
    <svg className="jauge" width={s} height={s} viewBox={`0 0 ${s} ${s}`} role="img" aria-label={`${e.prets} pièces sur ${e.requis} prêtes`}>
      <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={grande ? 8 : 6} />
      <circle cx={s / 2} cy={s / 2} r={r} fill="none" stroke={e.complet ? "var(--mint-ink)" : "var(--nest)"} strokeWidth={grande ? 8 : 6} strokeLinecap="round"
        strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${s / 2} ${s / 2})`} />
      <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" className="jauge-txt" style={{ fontSize: grande ? 20 : 13 }}>{e.prets}/{e.requis}</text>
    </svg>
  );
}

/** Small card for the Papers screen. */
export function DossiersCarte({ docs, go }: { docs: Doc[]; go: (s: string, id?: string) => void }) {
  const kits = calculerDossiers(docs);
  const prets = kits.filter((k) => k.complet).length;
  return (
    <button className="dossiers-carte" onClick={() => go("dossiers")}>
      <span className="dossiers-carte-ico"><Ico d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></span>
      <span><b>Dossiers prêts à envoyer</b><span>{prets ? `${prets} dossier${prets > 1 ? "s" : ""} complet${prets > 1 ? "s" : ""} · ` : ""}location, CAF, école, prêt, passeport, sinistre</span></span>
      <Ico d="M9 18l6-6-6-6" />
    </button>
  );
}

export function Dossiers({ docs, go, onBack }: { docs: Doc[]; go: (s: string, id?: string) => void; onBack: () => void }) {
  const kits = calculerDossiers(docs);
  return (
    <div className="screen">
      <Back onClick={onBack} label="Papiers" />
      <h1 className="detail-title">Dossiers prêts</h1>
      <p className="detail-sub">On vous demande un dossier ? Je rassemble les pièces, je vous dis ce qui manque et où le trouver, puis tout part en un seul fichier.</p>
      <ul className="list">
        {kits.map((k) => (
          <li key={k.cle}>
            <button className="row-item dossier-row" onClick={() => go("dossier", k.cle)}>
              <Jauge e={k} />
              <div>
                <div className="t">{k.titre}</div>
                <div className="s">{k.complet ? "Complet, prêt à envoyer" : `${k.requis - k.prets} pièce${k.requis - k.prets > 1 ? "s" : ""} à compléter · ${k.pour}`}</div>
              </div>
              <div className="r"><Ico d="M9 18l6-6-6-6" /></div>
            </button>
          </li>
        ))}
      </ul>
      <p className="note" style={{ marginTop: 14 }}>Listes indicatives d'après service-public.fr. L'organisme peut demander d'autres pièces.</p>
    </div>
  );
}

export function Dossier({ cle, api, household, docs, go, onBack, toast }: { cle: string; api: Api; household: Household; docs: Doc[]; go: (s: string, id?: string) => void; onBack: () => void; toast: (m: string) => void }) {
  const e = calculerDossiers(docs).find((k) => k.cle === cle);
  if (!e) return <div className="screen"><Back onClick={onBack} /><p className="note">Dossier introuvable.</p></div>;
  const texte = bordereau(e, household.nom);
  const partager = async () => {
    try {
      if (navigator.share) { await navigator.share({ title: `${e.titre} — Lucien`, text: texte }); return; }
      await navigator.clipboard.writeText(texte); toast("Liste copiée : collez-la dans un email");
    } catch { /* partage annulé */ }
  };
  const fichiers = e.pieces.reduce((s, p) => s + p.documents.filter((d) => d.fichier).length, 0);
  return (
    <div className="screen dossier">
      <Back onClick={onBack} label="Dossiers" />
      <div className="dossier-tete">
        <Jauge e={e} grande />
        <div>
          <h1 className="detail-title">{e.titre}</h1>
          <p className="detail-sub" style={{ marginBottom: 0 }}>{e.complet ? "Tout y est. Je peux l'envoyer pour vous." : `${e.prets} pièce${e.prets > 1 ? "s" : ""} sur ${e.requis} prête${e.prets > 1 ? "s" : ""}. Voici ce qui manque.`}</p>
        </div>
      </div>

      <ul className="pieces">
        {e.pieces.map((p) => (
          <li key={p.cle} className={`piece ${STATUT[p.statut].cls}`}>
            <div className="piece-tete">
              <b>{p.libelle}{p.optionnelle ? <small> · si besoin</small> : null}</b>
              <span className={`statut ${STATUT[p.statut].cls}`}>{p.statut === "manquant" && p.optionnelle ? "Facultative" : STATUT[p.statut].label}</span>
            </div>
            {p.pourquoi && <p className="note">{p.pourquoi}</p>}
            {p.documents.map((d) => (
              <button key={d.id} className="piece-doc" onClick={() => go("doc", d.id)}>
                <Ico d="M4 4h10l6 6v10H4zM14 4v6h6" /><span>{d.titre}{d.date ? <small> · {fmtDate(d.date, { day: "numeric", month: "short", year: "numeric" })}</small> : null}</span>
              </button>
            ))}
            {p.note && <p className="piece-note">{p.note}</p>}
            {p.statut !== "ok" && (
              <div className="piece-obtenir">
                <p>{p.obtenir}</p>
                <button className="link" onClick={() => go("add")}>Ajouter ce papier</button>
              </div>
            )}
          </li>
        ))}
      </ul>

      <div className="actions" style={{ marginTop: 18 }}>
        {api.mode === "demo"
          ? <button className="btn" onClick={() => toast("Avec votre compte, Lucien prépare un .zip : le bordereau et vos fichiers")}>Télécharger (.zip)</button>
          : <a className="btn" href={`/api/dossiers/${e.cle}/zip`} download>Télécharger (.zip)</a>}
        <button className="btn ghost" onClick={partager}>Partager la liste</button>
      </div>
      <p className="note">{api.mode === "demo" ? "Le .zip contient le bordereau (ce qui est là, ce qui manque) et les originaux de vos papiers." : fichiers ? `Le .zip contient le bordereau et ${fichiers} fichier${fichiers > 1 ? "s" : ""} original${fichiers > 1 ? "aux" : ""}.` : "Le .zip contient le bordereau ; les papiers saisis sans photo ni PDF n'y figurent pas."} Liste indicative : <a href={e.source} target="_blank" rel="noreferrer">service-public.fr</a>.</p>
    </div>
  );
}
