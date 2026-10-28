import { Bell } from "../notifications";
import type { Deadline } from "../types";
import { DateChip, daysUntil, relative } from "../ui";

const TYPE_LABEL: Record<string, string> = {
  resiliation: "Résiliation", renouvellement: "Renouvellement", expiration: "Expiration", garantie: "Garantie",
  sante: "Santé", declaration: "Déclaration", echeance: "Échéance", famille: "Famille",
};

export function Deadlines({ deadlines, go, onDone, unread, semaine }: { deadlines: Deadline[]; go: (s: string, id?: string) => void; onDone: (id: string) => void; unread: number; semaine?: { jour: number; heure_debut: string | null; titre: string; membre: string | null; lieu: string | null }[] }) {
  const todayIdx = ((new Date().getDay() + 6) % 7) + 1;
  const aujourdhui = (semaine ?? []).filter((s) => s.jour === todayIdx);
  const demain = (semaine ?? []).filter((s) => s.jour === (todayIdx % 7) + 1);
  const groups: { label: string; items: Deadline[] }[] = [
    { label: "En retard", items: deadlines.filter((d) => daysUntil(d.date) < 0) },
    { label: "Ce mois-ci", items: deadlines.filter((d) => daysUntil(d.date) >= 0 && daysUntil(d.date) <= 30) },
    { label: "Dans 1 à 3 mois", items: deadlines.filter((d) => daysUntil(d.date) > 30 && daysUntil(d.date) <= 90) },
    { label: "Plus tard", items: deadlines.filter((d) => daysUntil(d.date) > 90) },
  ].filter((g) => g.items.length);

  return (
    <div className="screen">
      <div className="top"><div><h1>Agenda</h1><p className="sub">{deadlines.length} échéance{deadlines.length > 1 ? "s" : ""} à venir, d'après vos papiers et votre famille</p></div><Bell unread={unread} onClick={() => go("notifs")} /></div>
      {semaine && semaine.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Aujourd'hui et demain</h2><button className="link" onClick={() => go("famille")}>Toute la semaine</button></div>
          {[["Aujourd'hui", aujourdhui], ["Demain", demain]].map(([label, items]) => (
            <div key={label as string} style={{ marginBottom: 8 }}>
              <div className="s" style={{ color: "var(--mist)", fontSize: 13, marginBottom: 4 }}>{label as string}</div>
              {(items as typeof aujourdhui).length === 0 ? <p className="note">Rien de prévu.</p> : (items as typeof aujourdhui).map((s, i) => (
                <div key={i} className="slot" style={{ padding: "6px 0" }}><span className="h">{s.heure_debut ?? "—"}</span><span className="w"><b>{s.titre}</b>{s.membre ? ` · ${s.membre}` : ""}{s.lieu ? <small>{s.lieu}</small> : null}</span></div>
              ))}
            </div>
          ))}
        </section>
      )}
      {deadlines.length === 0 && <div className="empty"><b>Aucune échéance</b>Ajoutez un contrat, une facture ou une pièce d'identité.</div>}
      {groups.map((g) => (
        <section className="section" key={g.label}>
          <div className="section-head"><h2>{g.label}</h2></div>
          <ul className="list">
            {g.items.map((d) => (
              <li key={d.id}>
                <div className="row-item">
                  <DateChip iso={d.date} />
                  <div>
                    <div className="t">{d.titre.replace(/^[^:]+:\s*/, "")}</div>
                    <div className="s">{TYPE_LABEL[d.type] ?? d.type} · {relative(d.date)}{d.note ? ` · ${d.note}` : ""}</div>
                    <div style={{ display: "flex", gap: 14, marginTop: 6 }}>
                      {d.document_id && <button className="link" onClick={() => go("doc", d.document_id!)}>Document</button>}
                      {d.type === "famille" && <button className="link" onClick={() => go(d.member_id ? "membre" : "famille", d.member_id ?? undefined)}>Famille</button>}
                      <button className="link" onClick={() => onDone(d.id)}>C'est fait</button>
                    </div>
                  </div>
                  <span />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
