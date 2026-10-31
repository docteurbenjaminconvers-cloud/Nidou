import { useState } from "react";
import type { Api } from "../api";
import type { Doc } from "../types";
import { grandMenage, SOURCE_CONSERVATION } from "../../../server/src/conservation";
import { Back, CatIcon } from "../ui";

/** Entry on the Papers screen, only when something can go. */
export function MenageCarte({ docs, go }: { docs: Doc[]; go: (s: string) => void }) {
  const n = grandMenage(docs).length;
  if (!n) return null;
  return (
    <button className="menage-carte" onClick={() => go("menage")}>
      <span className="menage-ico" aria-hidden><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></span>
      <span><b>Grand ménage : {n} papier{n > 1 ? "s" : ""} peu{n > 1 ? "vent" : "t"} partir</b><span>Leur durée de conservation est passée.</span></span>
    </button>
  );
}

export function Menage({ api, docs, go, onBack, onChanged, toast }: { api: Api; docs: Doc[]; go: (s: string, id?: string) => void; onBack: () => void; onChanged: () => void; toast: (m: string) => void }) {
  const items = grandMenage(docs);
  const [busy, setBusy] = useState<string | null>(null);
  const retirer = async (d: Doc) => {
    if (!confirm(`Retirer « ${d.title} » de Lucien ? Le papier et ses rappels seront effacés.`)) return;
    setBusy(d.id);
    try { await api.deleteDocument(d.id); onChanged(); toast("Papier retiré"); } catch { toast("Impossible de retirer ce papier"); } finally { setBusy(null); }
  };
  return (
    <div className="screen">
      <Back onClick={onBack} label="Papiers" />
      <h1 className="detail-title">Grand ménage</h1>
      <p className="detail-sub">Ces papiers ont dépassé leur durée de conservation. Vous pouvez jeter l'original papier, et les retirer de Lucien si vous n'en voulez plus.</p>
      {items.length === 0 ? (
        <div className="empty"><b>Rien à jeter</b>Tous vos papiers sont encore utiles. Je vous préviendrai quand l'un d'eux pourra partir.</div>
      ) : (
        <ul className="list">
          {items.map(({ doc, etat }) => (
            <li key={doc.id}>
              <div className="row-item">
                <CatIcon c={doc.category} />
                <div>
                  <button className="link" style={{ color: "var(--ink)", textAlign: "left" }} onClick={() => go("doc", doc.id)}><span className="t">{doc.title}</span></button>
                  <div className="s">{etat.libelle} · {etat.garder}</div>
                  <button className="link" disabled={busy === doc.id} onClick={() => retirer(doc)} style={{ marginTop: 6 }}>Retirer de Lucien</button>
                </div>
                <span />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="note" style={{ marginTop: 14 }}>Durées indicatives d'après <a href={SOURCE_CONSERVATION} target="_blank" rel="noreferrer">service-public.fr</a>. En cas de litige en cours, gardez tout ce qui s'y rapporte.</p>
    </div>
  );
}
