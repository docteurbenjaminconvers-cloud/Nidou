import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { NUMEROS, scenarios } from "./urgence.js";

test("coup dur : étapes dans l'ordre et références du foyer au bon endroit", () => {
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const s = Object.fromEntries(scenarios(db.listDocuments(h.id)).map((x) => [x.cle, x]));
  assert.deepEqual(Object.keys(s), ["portefeuille", "degat_eaux", "accident", "hopital"]);
  assert.equal(s.portefeuille.etapes[0].titre, "Faire opposition aux cartes bancaires", "cards first");
  assert.equal(s.portefeuille.etapes[0].tel, "0892705705");
  assert.ok(s.portefeuille.references.some((r) => r.titre === "Passeport — Léa"));
  assert.ok(s.degat_eaux.references.some((r) => r.organisme === "Matmut"), "home insurance for a water leak");
  assert.ok(!s.degat_eaux.references.some((r) => r.organisme === "MAIF"), "not the car insurance");
  const auto = s.accident.references.find((r) => r.organisme === "MAIF")!;
  assert.equal(auto.numero, "AUT-4471-8820");
  assert.match(s.accident.etapes.find((e) => e.delai)!.delai!, /5 jours ouvrés/);
  assert.ok(s.hopital.references.some((r) => r.organisme === "Harmonie Mutuelle"));
  assert.ok(NUMEROS.some((n) => n.tel === "112"));
  for (const x of Object.values(s)) assert.match(x.source, /^https:\/\/www\.service-public\.gouv\.fr\//);
});
