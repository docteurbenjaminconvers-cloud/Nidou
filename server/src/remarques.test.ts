import { test } from "node:test";
import assert from "node:assert/strict";
import { remarquer, type Contexte } from "./remarques.js";
import { Db } from "./db.js";
import { createApi } from "./api.js";

const m = (id: string, prenom: string, date_naissance: string | null, role = "enfant") => ({ id, household_id: "h", prenom, role, date_naissance, etablissement: null, classe: null, cantine_jours: null, cantine_cout_mois: null, notes: null });
const doc = (id: string, title: string, category: string, date_fin: string | null, extra: Record<string, unknown> = {}) =>
  ({ id, household_id: "h", member_id: null, title, category, organisme: null, numero_contrat: null, montant: null, periodicite: null, date_document: null, date_debut: null, date_fin, preavis_jours: null, resume: null, texte: null, fichier: null, mime: null, confiance: null, verifie: 1, source: "app", cree_le: "2026-01-01", ...extra });

test("Lucien a remarqué : découvert, recensement, majorité, papiers d'identité, préavis, situations, compte pro", () => {
  const c: Contexte = {
    aujourdhui: "2026-11-02",
    membres: [m("a", "Benjamin", "1975-03-10", "adulte"), m("b", "Léo", "2010-09-15"), m("c", "Daphné", "2008-12-20"), m("d", "Zoé", "2015-11-05")],
    documents: [
      doc("p", "Passeport de Benjamin", "identite", "2027-01-15"),
      doc("i", "Assurance auto", "assurance", "2026-12-31", { preavis_jours: 30, periodicite: "annuel", montant: 620 }),
      doc("g", "Lave-linge", "garantie", "2026-11-20"),
    ] as never,
    echeances: [],
    budget: null,
    prevision: { solde_actuel: 300, solde_prevu: -180, jours_restants: 28 } as never,
    etapes: [{ situation: "Déménagement", titre: "Résilier la box", date: "2026-10-25", fait: false, situation_id: "s1" }, { situation: "Déménagement", titre: "Prévenir la CAF", date: "2026-11-06", fait: false, situation_id: "s1" }],
    pro_a_verifier: 2, aSituation: true,
  };
  const r = remarquer(c);
  const cles = r.map((x) => x.cle.split(":")[0]);
  for (const k of ["decouvert", "pro", "recensement", "majorite", "identite", "preavis", "garantie", "situation_retard", "situation_semaine", "anniv"]) assert.ok(cles.includes(k), `remarque ${k}`);
  assert.equal(r[0].niveau, "alerte", "alerts first");
  assert.ok(r.find((x) => x.cle.startsWith("preavis"))!.titre.includes("1 décembre"));
  assert.ok(!cles.includes("manque"), "nothing missing here");
  // an empty household gets the « what to add » hints, nothing invented
  const vide = remarquer({ ...c, membres: [m("a", "A", null, "adulte"), m("b", "B", null)], documents: [doc("x", "Facture EDF", "energie", null), doc("y", "Bail", "logement", null), doc("z", "Mutuelle", "sante", null)] as never, prevision: null, etapes: [], pro_a_verifier: 0 });
  assert.deepEqual(vide.map((x) => x.cle).sort(), ["manque:identite", "manque:naissances"]);
});

test("Lucien a remarqué : une remarque mise de côté ne revient pas", async () => {
  process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const h = db.createHousehold("Test");
  db.addMember(h.id, "A", "adulte"); db.addMember(h.id, "B", "enfant");
  const r = await (await api.request("/remarques")).json();
  assert.ok(r.remarques.some((x: { cle: string }) => x.cle === "manque:naissances"));
  const r2 = await (await api.request("/remarques/masquer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cle: "manque:naissances" }) })).json();
  assert.ok(!r2.remarques.some((x: { cle: string }) => x.cle === "manque:naissances"));
});
