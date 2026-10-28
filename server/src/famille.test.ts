import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { age, niveau, echeancesFamille, conseilsFamille, agendaSemaine, coutsParMembre } from "./famille.js";
import { seedDemo } from "./seed.js";

test("organisation familiale : niveaux, agenda, coûts, échéances et conseils dérivés", () => {
  const db = new Db(":memory:");
  seedDemo(db);
  const h = db.firstHousehold()!;
  const members = db.listMembers(h.id), activites = db.listActivites(h.id);
  const today = new Date("2026-10-28");
  const lea = members.find((m) => m.prenom === "Léa")!, jean = members.find((m) => m.prenom === "Jean")!;
  assert.equal(age(lea.date_naissance, today), 17);
  assert.equal(niveau(lea, today), "terminale");
  assert.equal(niveau(jean, today), "primaire");
  assert.equal(niveau({ ...jean, classe: "L2 droit" }, today), "superieur");

  const semaine = agendaSemaine(members, activites);
  assert.ok(semaine.some((s) => s.titre === "Cantine" && s.membre === "Léa, Jean" && s.jour === 1));
  assert.ok(semaine.some((s) => s.titre === "Judo" && s.jour === 3));

  const couts = coutsParMembre(members, activites);
  const cj = couts.find((c) => c.prenom === "Jean")!;
  assert.equal(cj.cantine, 58); assert.equal(cj.activites, 67); assert.equal(cj.total, 125);

  const ech = echeancesFamille(h, members, activites, today);
  const cles = ech.map((e) => e.cle.split(":")[0]);
  for (const k of ["anniv", "ars", "bourse", "parcoursup", "dse", "reinscriptions", "fin_activite", "impots"]) assert.ok(cles.includes(k), `missing ${k}`);
  assert.ok(ech.every((e) => e.date >= "2026-10-27"), "all upcoming");

  const conseils = conseilsFamille(h, members, activites, today);
  const cc = conseils.map((c) => c.cle.split(":")[0]);
  for (const k of ["parcoursup", "crous", "etudiant", "ars", "cantine", "passsport", "aidant", "protection", "couple_declaration", "budget_enfants"]) assert.ok(cc.includes(k), `missing conseil ${k}`);
  assert.ok(!cc.includes("parent_isole"));
});

test("foyer monoparental sans activités : conseils adaptés", () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Solo", 0);
  db.setSituation(h.id, "seul");
  db.addMember(h.id, "Moi", "adulte");
  db.addMember(h.id, "Noa", "enfant", { date_naissance: "2022-01-01" });
  const c = conseilsFamille(db.getHousehold(h.id)!, db.listMembers(h.id), [], new Date("2026-10-28")).map((x) => x.cle.split(":")[0]);
  assert.ok(c.includes("parent_isole")); assert.ok(c.includes("garde")); assert.ok(c.includes("agenda_vide")); assert.ok(!c.includes("ars"));
});
