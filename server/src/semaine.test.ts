import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { fenetre, pointSemaine, semaineIso, titreFoyer, type SemaineEntree } from "./semaine.js";
import { creneauDimanche, emailSemaine, pointDuFoyer } from "./hebdo.js";
import { passeHebdo, rappelHebdo } from "./rappels.js";

// Paris is UTC+1 in November.
const mercredi = new Date("2026-11-04T09:00:00Z");     // mercredi 4 novembre, 10 h
const dimancheSoir = new Date("2026-11-08T17:30:00Z"); // dimanche 8 novembre, 18 h 30
const dimancheMatin = new Date("2026-11-08T08:00:00Z");
const lundiMatin = new Date("2026-11-09T07:00:00Z");   // lundi, 8 h : rattrapage
const lundiMidi = new Date("2026-11-09T12:30:00Z");

const vide: SemaineEntree = { foyer: "Famille Test", echeances: [], creneaux: [], aVerifier: 0, economies: null, conseils: [] };

test("semaine : fenêtre de 7 jours, celle de demain le dimanche après-midi, clé ISO", () => {
  assert.deepEqual(fenetre(mercredi), { du: "2026-11-04", au: "2026-11-10" });
  assert.deepEqual(fenetre(dimancheMatin), { du: "2026-11-08", au: "2026-11-14" });
  assert.deepEqual(fenetre(dimancheSoir), { du: "2026-11-09", au: "2026-11-15" });
  assert.equal(semaineIso("2026-11-09"), "2026-W46");
  assert.equal(semaineIso("2027-01-01"), "2026-W53"); // ISO weeks: 1 January 2027 still belongs to 2026's last week
  assert.equal(titreFoyer("Famille Martin (démo)"), "La semaine de la famille Martin");
  assert.equal(titreFoyer("Les Dupont"), "La semaine de Les Dupont");
});

test("semaine : échéances en retard puis de la semaine, agenda sans la cantine, geste d'économie", () => {
  const p = pointSemaine({
    ...vide,
    echeances: [
      { id: "a", titre: "Taxe foncière 2026", date: "2026-11-06", fait: 0, document_id: "doc1" },
      { id: "b", titre: "Assurance auto", date: "2026-11-02", fait: 0 },
      { id: "c", titre: "Déjà réglé", date: "2026-11-05", fait: 1 },
      { id: "d", titre: "Trop tard pour cette semaine", date: "2026-11-20", fait: 0 },
    ],
    creneaux: [
      { jour: 3, heure_debut: "14:00", titre: "Piano", membre: "Jean", type: "musique" },
      { jour: 3, heure_debut: "12:00", titre: "Cantine", membre: "Léa, Jean", type: "cantine" },
      { jour: 5, heure_debut: "18:30", titre: "Volley", membre: "Léa", type: "sport" },
    ],
    economies: { possibles: 1949, decidees: 0, geste: { titre: "Résilier Keepcool", effort: "2 min", gain: 419 } },
    aVerifier: 2,
    conseils: [{ cle: "x", titre: "Allocation de rentrée", detail: "…", source: "https://www.caf.fr" }],
  }, mercredi);
  const ech = p.sections.find((s) => s.cle === "echeances")!;
  assert.deepEqual(ech.items.map((i) => i.titre), ["Assurance auto", "Taxe foncière 2026"]);
  assert.equal(ech.items[0].urgent, true, "late");
  assert.equal(ech.items[1].route, "doc/doc1");
  const agenda = p.sections.find((s) => s.cle === "agenda")!;
  assert.deepEqual(agenda.items.map((i) => i.titre), ["Mercredi", "Vendredi"]);
  assert.match(agenda.items[0].detail!, /14:00 Piano \(Jean\)/);
  assert.doesNotMatch(agenda.items[0].detail!, /Cantine/);
  assert.equal(p.sections.find((s) => s.cle === "budget")!.items[0].montant, 419);
  assert.ok(p.sections.some((s) => s.cle === "papiers"));
  assert.ok(p.sections.some((s) => s.cle === "conseil"));
  assert.equal(p.vide, false);
  assert.match(p.intro, /1 échéance en retard, 1 échéance, 2 activités et un geste qui rapporte 419 € par an/);
  assert.match(p.notification.corps, /Taxe foncière 2026, vendredi 6 novembre · 2 activités · 419 €\/an à gagner/);
});

test("semaine : rien à dire → message calme, marqué vide", () => {
  const p = pointSemaine(vide, mercredi);
  assert.equal(p.vide, true);
  assert.equal(p.sections.length, 0);
  assert.match(p.intro, /semaine calme/);
});

test("point du dimanche : créneau, une fois par semaine, désactivable, email lisible", async () => {
  assert.equal(creneauDimanche(mercredi), false);
  assert.equal(creneauDimanche(dimancheMatin), false);
  assert.equal(creneauDimanche(dimancheSoir), true);
  assert.equal(creneauDimanche(lundiMatin), true, "catch-up on Monday morning");
  assert.equal(creneauDimanche(lundiMidi), false);

  const db = new Db(":memory:");
  const h = seedDemo(db);
  db.joinHousehold(h.id, db.createUser("parent@example.org", "Camille").id, "proprietaire");
  assert.equal(rappelHebdo(db, db.getHousehold(h.id)!, mercredi).length, 0, "not on a Wednesday");

  const sent: string[] = [];
  const envoyer = async (_h: unknown, r: { cle: string }) => { sent.push(r.cle); };
  assert.equal(await passeHebdo(db, envoyer, dimancheSoir), 1);
  assert.equal(await passeHebdo(db, envoyer, lundiMatin), 0, "same week: already sent");
  assert.deepEqual(sent, ["hebdo:2026-W46"]);

  db.setHebdo(h.id, false);
  assert.equal(rappelHebdo(db, db.getHousehold(h.id)!, new Date("2026-11-15T18:00:00Z")).length, 0, "switched off");

  const p = pointDuFoyer(db, db.getHousehold(h.id)!, dimancheSoir);
  const m = emailSemaine(p, "Camille", "https://app.monlucien.fr");
  assert.match(m.subject, /^La semaine de la famille Martin/);
  assert.match(m.text, /^Bonsoir Camille,/);
  assert.match(m.text, /https:\/\/app\.monlucien\.fr\/#\/semaine/);
  assert.match(m.html, /Ouvrir ma semaine/);
  assert.doesNotMatch(m.html, /<script/i);
});
