import { useMemo, useState } from "react";
import type { Banque } from "./types";

/** Searchable list of banks (Enable Banking leaves the choice to the app). Big touch targets, works for a 90-year-old. */
export function BankPicker({ banques, onPick, busy, large }: { banques: Banque[]; onPick: (b: Banque) => void; busy?: boolean; large?: boolean }) {
  const [q, setQ] = useState("");
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const list = useMemo(() => (q.trim() ? banques.filter((b) => norm(b.name).includes(norm(q.trim()))) : banques), [q, banques]);
  return (
    <div className="bank-picker">
      <input className="in" type="search" value={q} placeholder="Nom de votre banque" onChange={(e) => setQ(e.target.value)} autoFocus style={large ? { fontSize: 18 } : undefined} />
      <ul>
        {list.slice(0, 40).map((b) => (
          <li key={`${b.name}|${b.country}`}>
            <button disabled={busy} onClick={() => onPick(b)} style={large ? { fontSize: 18, padding: "14px 12px" } : undefined}>
              {b.logo ? <img src={b.logo} alt="" width={28} height={28} loading="lazy" /> : <span className="bank-dot" aria-hidden>{b.name.slice(0, 1)}</span>}
              <span>{b.name}</span>
            </button>
          </li>
        ))}
        {list.length === 0 && <li className="note" style={{ padding: 10 }}>Aucune banque trouvée. Essayez un autre nom (par exemple « Crédit Agricole » plutôt que le nom de votre caisse régionale).</li>}
      </ul>
    </div>
  );
}
