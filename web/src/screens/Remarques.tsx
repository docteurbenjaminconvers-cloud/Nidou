import { useEffect, useState } from "react";
import type { Api } from "../api";
import type { Remarque } from "../types";

/**
 * « Lucien a remarqué » on Today: what Lucien notices by itself (end of month, papers to renew, a child's milestone,
 * a late step, the business account). Each remark can be set aside; it comes back only if the situation changes.
 */
export function RemarquesCarte({ api, go }: { api: Api; go: (s: string, id?: string) => void }) {
  const [liste, setListe] = useState<Remarque[] | null>(null);
  const [tout, setTout] = useState(false);
  useEffect(() => { api.remarques().then(setListe).catch(() => setListe([])); }, [api]);
  if (!liste || !liste.length) return null;
  const vues = tout ? liste : liste.slice(0, 3);
  const ouvrir = (route: string) => { const [s, id] = route.split("/"); go(s, id); };
  return (
    <section className="section remarques">
      <div className="section-head"><h2>Lucien a remarqué</h2>{liste.length > 3 && <button onClick={() => setTout(!tout)}>{tout ? "Moins" : `Tout (${liste.length})`}</button>}</div>
      {vues.map((r) => (
        <div key={r.cle} className={`remarque ${r.niveau}`}>
          <div className="remarque-texte">
            <b>{r.titre}</b>
            <p>{r.detail}</p>
            {r.action && <button className="link" onClick={() => ouvrir(r.action!.route)}>{r.action.libelle} ›</button>}
          </div>
          <button className="remarque-fermer" aria-label="Mettre de côté" title="Mettre de côté" onClick={async () => setListe(await api.masquerRemarque(r.cle))}>×</button>
        </div>
      ))}
    </section>
  );
}
