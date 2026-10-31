import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { agendaIcs } from "./ics.js";
import { createApi } from "./api.js";

test("ics : échéances en journée entière avec rappel, activités hebdomadaires à l'heure de Paris", () => {
  const ics = agendaIcs({
    foyer: "Famille Martin (démo)",
    echeances: [{ id: "d1", titre: "Assurance auto, MAIF : résiliation, avec préavis", date: "2026-11-27", rappel_jours: 14, note: "Contrat n° AUT-4471; échéance annuelle" }],
    creneaux: [
      { jour: 3, heure_debut: "14:00", heure_fin: "15:30", titre: "Judo", membre: "Jean", lieu: "Dojo municipal", activite_id: "a1", type: "sport" },
      { jour: 1, heure_debut: "12:00", heure_fin: "13:30", titre: "Cantine", membre: "Léa, Jean", lieu: null, activite_id: null, type: "cantine" },
    ],
    lien: "https://app.monlucien.fr/#/deadlines",
  }, new Date("2026-11-02T10:00:00Z")); // lundi
  assert.ok(ics.startsWith("BEGIN:VCALENDAR\r\n") && ics.endsWith("END:VCALENDAR\r\n"));
  assert.match(ics, /X-WR-CALNAME:Lucien · Famille Martin\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261127\r\nDTEND;VALUE=DATE:20261128/);
  assert.match(ics, /SUMMARY:Assurance auto\\, MAIF : résiliation\\, avec préavis/);
  assert.match(ics, /TRIGGER:-P14D/);
  assert.match(ics, /DESCRIPTION:Contrat n° AUT-4471\\; échéance annuelle/);
  assert.match(ics, /DTSTART;TZID=Europe\/Paris:20261104T140000\r\nDTEND;TZID=Europe\/Paris:20261104T153000\r\nRRULE:FREQ=WEEKLY;BYDAY=WE/);
  assert.match(ics, /SUMMARY:Judo · Jean/);
  assert.doesNotMatch(ics, /Cantine/, "canteen is not an appointment");
  for (const l of ics.split("\r\n")) assert.ok(new TextEncoder().encode(l).length <= 75, `line too long: ${l}`);
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 2);
});

test("ics : abonnement par lien secret, régénérable, sans session", async () => {
  process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const { url } = await (await api.request("/agenda-lien")).json();
  assert.match(url, /\/api\/agenda\/[\w-]+\.ics$/);
  const chemin = new URL(url).pathname.replace(/^\/api/, "");
  process.env.LUCIEN_AUTH = "1"; // a calendar app has no session cookie: the secret is enough
  const r = await api.request(chemin);
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type")!, /text\/calendar/);
  const ics = await r.text();
  assert.match(ics, /SUMMARY:Judo · Jean/);
  assert.match(ics, /Taxe foncière/);
  process.env.LUCIEN_AUTH = "0";
  const { url: url2 } = await (await api.request("/agenda-lien", { method: "POST" })).json();
  assert.notEqual(url2, url);
  assert.equal((await api.request(chemin)).status, 404, "the old link stops working");
  assert.equal((await api.request("/agenda/nimporte.ics")).status, 404);
  assert.equal(db.householdByIcsToken(new URL(url2).pathname.split("/").pop()!.slice(0, -4))!.id, h.id);
});
