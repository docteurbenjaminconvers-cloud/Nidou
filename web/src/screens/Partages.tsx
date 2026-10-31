import { useEffect, useState } from "react";
import type { Api } from "../api";
import type { EtatPartages } from "../types";
import { Back, fmtEuro } from "../ui";

const auj = () => new Date().toISOString().slice(0, 10);

/** Dépenses partagées : qui a payé quoi, qui doit combien, et les remboursements pour être quittes. */
export function Partages({ api, onBack, toast }: { api: Api; onBack: () => void; toast: (m: string) => void }) {
  const [e, setE] = useState<EtatPartages | null>(null);
  const [form, setForm] = useState<{ libelle: string; montant: string; paye_par: string; participants: string[]; date: string } | null>(null);
  useEffect(() => { api.partages().then(setE).catch((x) => toast((x as Error).message)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!e) return <div className="screen"><Back onClick={onBack} /><h1>Dépenses partagées</h1><p className="note">Chargement…</p></div>;

  const adultes = e.membres.filter((m) => m.role === "adulte");
  const prenom = (id: string) => e.membres.find((m) => m.id === id)?.prenom ?? "?";
  const nouveau = () => setForm({ libelle: "", montant: "", paye_par: adultes[0]?.id ?? e.membres[0]?.id ?? "", participants: (adultes.length ? adultes : e.membres).map((m) => m.id), date: auj() });
  const enregistrer = async () => {
    if (!form) return;
    const montant = Number(form.montant.replace(",", "."));
    if (!form.libelle.trim() || !(montant > 0) || !form.participants.length) return toast("Un libellé, un montant et au moins une personne, s'il vous plaît");
    try { setE(await api.ajouterDepensePartagee({ date: form.date, libelle: form.libelle.trim(), montant, paye_par: form.paye_par, participants: form.participants })); setForm(null); toast("Dépense ajoutée"); }
    catch (x) { toast((x as Error).message); }
  };

  if (e.membres.length < 2) return (
    <div className="screen">
      <Back onClick={onBack} />
      <h1>Dépenses partagées</h1>
      <p className="note">Pour partager des dépenses, ajoutez d'abord les autres personnes du foyer dans Famille : conjoint·e, colocataire, enfant majeur.</p>
    </div>
  );

  return (
    <div className="screen partages">
      <Back onClick={onBack} />
      <div className="top"><div><h1>Dépenses partagées</h1><p className="sub">Qui a payé quoi, qui doit combien. Lucien tient les comptes, vous vous remboursez comme vous voulez.</p></div></div>

      <div className="partages-soldes">
        {e.soldes.map((s) => (
          <div key={s.member_id} className={`ps ${s.solde > 0.004 ? "plus" : s.solde < -0.004 ? "moins" : ""}`}>
            <b>{s.prenom}</b>
            <span>{s.solde > 0.004 ? `on lui doit ${fmtEuro(s.solde, 2)}` : s.solde < -0.004 ? `doit ${fmtEuro(-s.solde, 2)}` : "quitte"}</span>
          </div>
        ))}
      </div>

      {e.suggestions.length > 0 ? (
        <section className="section">
          <div className="section-head"><h2>Pour être quittes</h2></div>
          {e.suggestions.map((s) => (
            <div key={`${s.de}-${s.a}`} className="partage-sugg">
              <span><b>{prenom(s.de)}</b> rembourse <b>{fmtEuro(s.montant, 2)}</b> à <b>{prenom(s.a)}</b></span>
              <button className="link" onClick={async () => { try { setE(await api.regler(s)); toast("Remboursement noté"); } catch (x) { toast((x as Error).message); } }}>C'est réglé</button>
            </div>
          ))}
        </section>
      ) : e.depenses.length > 0 && <p className="confidence ok" style={{ display: "flex" }}>Tout le monde est quitte.</p>}

      {form ? (
        <section className="section">
          <div className="lock" style={{ textAlign: "left" }}>
            <label className="champ"><span>Quoi</span><input className="in" value={form.libelle} onChange={(x) => setForm({ ...form, libelle: x.target.value })} placeholder="Courses, cinéma, électricité…" /></label>
            <label className="champ"><span>Montant (€)</span><input className="in" inputMode="decimal" value={form.montant} onChange={(x) => setForm({ ...form, montant: x.target.value })} /></label>
            <label className="champ"><span>Date</span><input className="in" type="date" value={form.date} onChange={(x) => setForm({ ...form, date: x.target.value })} /></label>
            <label className="champ"><span>Payé par</span><select className="in" value={form.paye_par} onChange={(x) => setForm({ ...form, paye_par: x.target.value })}>{e.membres.map((m) => <option key={m.id} value={m.id}>{m.prenom}</option>)}</select></label>
            <fieldset className="partage-pour"><legend>Pour qui</legend>
              {e.membres.map((m) => (
                <label key={m.id}><input type="checkbox" checked={form.participants.includes(m.id)} onChange={(x) => setForm({ ...form, participants: x.target.checked ? [...form.participants, m.id] : form.participants.filter((p) => p !== m.id) })} /> {m.prenom}</label>
              ))}
            </fieldset>
            <div style={{ display: "flex", gap: 10, marginTop: 10 }}><button className="btn" onClick={enregistrer}>Ajouter</button><button className="btn ghost" onClick={() => setForm(null)}>Annuler</button></div>
          </div>
        </section>
      ) : <button className="btn block" style={{ marginTop: 14 }} onClick={nouveau}>Ajouter une dépense</button>}

      {e.depenses.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Dépenses</h2></div>
          <ul className="list">
            {e.depenses.map((d) => (
              <li key={d.id} className="row-item" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><div className="t">{d.libelle}</div><div className="s">{d.date.split("-").reverse().join("/")} · payé par {prenom(d.paye_par)} · pour {d.participants.map(prenom).join(", ")}</div></div>
                <div className="r">{fmtEuro(d.montant, 2)} <button className="link" style={{ color: "var(--mist)", marginLeft: 8 }} aria-label={`Supprimer ${d.libelle}`} onClick={async () => setE(await api.supprimerDepensePartagee(d.id))}>×</button></div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {e.reglements.length > 0 && (
        <section className="section">
          <div className="section-head"><h2>Remboursements</h2></div>
          <ul className="list">
            {e.reglements.map((r) => (
              <li key={r.id} className="row-item" style={{ gridTemplateColumns: "1fr auto" }}>
                <div><div className="t">{prenom(r.de)} → {prenom(r.a)}</div><div className="s">{r.date.split("-").reverse().join("/")}</div></div>
                <div className="r">{fmtEuro(r.montant, 2)} <button className="link" style={{ color: "var(--mist)", marginLeft: 8 }} aria-label="Annuler ce remboursement" onClick={async () => setE(await api.supprimerReglement(r.id))}>×</button></div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
