import { Bell } from "../notifications";
import { useState } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category, type Doc } from "../types";
import { CatIcon, fmtDate, fmtEuro, PERIOD_LABEL } from "../ui";

export function Documents({ docs, go, unread }: { docs: Doc[]; go: (s: string, id?: string) => void; unread: number }) {
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<Category | "">("");
  const used = CATEGORIES.filter((c) => docs.some((d) => d.category === c));
  const shown = docs.filter((d) => (!cat || d.category === cat) && (!q || [d.title, d.organisme, d.resume, d.numero_contrat].some((v) => v?.toLowerCase().includes(q.toLowerCase()))));

  return (
    <div className="screen">
      <div className="top"><div><h1>Papiers</h1><p className="sub">{docs.length} document{docs.length > 1 ? "s" : ""} dans le foyer</p></div><Bell unread={unread} onClick={() => go("notifs")} /></div>
      <input className="search" placeholder="Chercher un contrat, un organisme, un numéro…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher" />
      <div className="pills" role="group" aria-label="Catégories">
        <button className="pill" aria-pressed={cat === ""} onClick={() => setCat("")}>Tous</button>
        {used.map((c) => (
          <button key={c} className="pill" aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>{CATEGORY_LABEL[c]}</button>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="empty"><b>Aucun papier ici</b>{docs.length ? "Essayez un autre mot ou une autre catégorie." : "Photographiez un courrier ou transférez un PDF avec le bouton +."}</div>
      ) : (
        <ul className="list">
          {shown.map((d) => (
            <li key={d.id}>
              <button className="row-item" onClick={() => go("doc", d.id)}>
                <CatIcon c={d.category} />
                <div>
                  <div className="t">{d.title}</div>
                  <div className="s">{[d.organisme, CATEGORY_LABEL[d.category], d.date_fin ? `jusqu'au ${fmtDate(d.date_fin, { day: "numeric", month: "short", year: "numeric" })}` : null].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="r">{d.montant != null ? fmtEuro(d.montant, d.montant % 1 ? 2 : 0) : ""}{d.periodicite && <small>{PERIOD_LABEL[d.periodicite]}</small>}</div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
