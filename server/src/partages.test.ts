import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { parts, soldes, suggestions } from "./partages.js";

test("dépenses partagées : parts exactes au centime, soldes, remboursements les moins nombreux", () => {
  assert.deepEqual([...parts(10, ["a", "b", "c"]).values()], [334, 333, 333], "10 € in three: nothing lost");
  const m = [{ id: "a", prenom: "Moi" }, { id: "b", prenom: "Camille" }, { id: "c", prenom: "Léa" }];
  const d = [
    { id: "1", date: "2026-11-01", libelle: "Courses", montant: 90, paye_par: "a", participants: ["a", "b", "c"], transaction_id: null },
    { id: "2", date: "2026-11-02", libelle: "Cinéma", montant: 30, paye_par: "b", participants: ["b", "c"], transaction_id: null },
  ];
  const s = soldes(d, [], m);
  assert.deepEqual(s.map((x) => x.solde), [60, -15, -45]);
  assert.equal(s.reduce((t, x) => t + x.solde, 0), 0, "always balanced");
  assert.deepEqual(suggestions(s), [{ de: "c", a: "a", montant: 45 }, { de: "b", a: "a", montant: 15 }]);
  const apres = soldes(d, [{ id: "r", date: "2026-11-03", de: "c", a: "a", montant: 45 }], m);
  assert.deepEqual(suggestions(apres), [{ de: "b", a: "a", montant: 15 }], "settled part removed");
});

test("dépenses partagées par l'appli : ajout, membres du foyer seulement, règlement", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "0";
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const h = db.firstHousehold() ?? db.createHousehold("Famille");
    const moi = db.addMember(h.id, "Moi"), cam = db.addMember(h.id, "Camille");
    const autre = db.createHousehold("Autre"); const intrus = db.addMember(autre.id, "Intrus");
    const post = (u: string, b: unknown) => api.request(u, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    assert.equal((await post("/partages/depenses", { date: "2026-11-01", libelle: "Courses", montant: 80, paye_par: moi.id, participants: [moi.id, intrus.id] })).status, 400, "another household's member refused");
    const r = await (await post("/partages/depenses", { date: "2026-11-01", libelle: "Courses", montant: 80, paye_par: moi.id, participants: [moi.id, cam.id] })).json();
    assert.deepEqual(r.suggestions.map((x: { montant: number }) => x.montant), [40]);
    const r2 = await (await post("/partages/reglements", { de: cam.id, a: moi.id, montant: 40 })).json();
    assert.equal(r2.suggestions.length, 0, "settled");
  } finally { if (avant === undefined) delete process.env.LUCIEN_AUTH; else process.env.LUCIEN_AUTH = avant; }
});
