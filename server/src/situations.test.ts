import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { createApi } from "./api.js";
import { SITUATIONS, dateEtape, etapesApplicables, lettreCongeLocataire } from "./situations.js";

const json = (body: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("situations : catalogue cohérent, étapes datées, congé selon le logement", () => {
  for (const s of SITUATIONS) { assert.ok(s.etapes.length >= 5, s.cle); assert.equal(new Set(s.etapes.map((e) => e.cle)).size, s.etapes.length, `${s.cle}: unique keys`); }
  const dem = SITUATIONS.find((s) => s.cle === "demenagement")!;
  assert.ok(etapesApplicables(dem, { locataire: false }).every((e) => e.si !== "locataire"), "an owner gives no notice");
  assert.equal(dateEtape("2027-03-01", -95), "2026-11-26");
  assert.ok(lettreCongeLocataire({ expediteur: "A", adresse: "x", meuble: true, zone_tendue: false, date: "2027-03-01" }).includes("d'un mois"));
  assert.ok(lettreCongeLocataire({ expediteur: "A", adresse: "x", meuble: false, zone_tendue: false, date: "2027-03-01" }).includes("trois mois"));
});

test("situation de vie : étapes dans l'agenda, cochées des deux côtés, papiers concernés, courrier, clôture", async () => {
  process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const avant = db.listDeadlines(h.id).length;
  const s = await (await api.request("/situations", json({ cle: "demenagement", date: "2027-03-01", locataire: true, ancienne_adresse: "1 rue A", nouvelle_adresse: "2 rue B" }))).json();
  assert.equal(s.etapes.length, SITUATIONS[0].etapes.length);
  assert.equal(db.listDeadlines(h.id).length, avant + s.etapes.length, "every step is in the Agenda");
  const energie = s.etapes.find((e: { cle: string }) => e.cle === "energie");
  assert.ok(energie.papiers.length > 0, "the demo's energy contract is found");
  const l = await (await api.request(`/situations/${s.id}/courrier?etape=energie&doc=${energie.papiers[0].id}`)).json();
  assert.ok(l.lettre.includes("2 rue B") && l.lettre.includes("Changement d'adresse"));
  const coche = await (await api.request(`/situations/${s.id}/etapes/energie`, json({ fait: true }, "PATCH"))).json();
  assert.equal(coche.faites, 1);
  db.setDeadlineDone(h.id, s.etapes.find((e: { cle: string }) => e.cle === "box").deadline_id, true);
  const liste = await (await api.request("/situations")).json();
  assert.equal(liste.actives[0].faites, 2, "done from the Agenda shows here too");
  assert.equal((await api.request(`/situations/${s.id}`, { method: "DELETE" })).status, 200);
  assert.equal(db.listDeadlines(h.id).length, avant, "open steps leave the Agenda");
});
