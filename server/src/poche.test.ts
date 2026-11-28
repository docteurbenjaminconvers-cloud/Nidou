import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { etatPoche, prochainVersement, versementsDus, type ReglagePoche } from "./pocheCalcul.js";
import { lirePoche, ensurePocheSchema } from "./poche.js";

test("argent de poche : les jours de versement, à la semaine et au mois, sans rattraper avant la mise en place", () => {
  const sem: ReglagePoche = { member_id: "m", montant: 10, frequence: "semaine", jour: 6, depuis: "2026-11-02", actif: true }; // le samedi
  assert.deepEqual(versementsDus(sem, null, "2026-11-22"), ["2026-11-07", "2026-11-14", "2026-11-21"]);
  assert.deepEqual(versementsDus(sem, "2026-11-14", "2026-11-22"), ["2026-11-21"]);
  assert.deepEqual(versementsDus(sem, "2026-11-21", "2026-11-22"), []);
  assert.deepEqual(versementsDus({ ...sem, actif: false }, null, "2026-11-22"), []);
  const mois: ReglagePoche = { member_id: "m", montant: 40, frequence: "mois", jour: 1, depuis: "2026-09-15", actif: true };
  assert.deepEqual(versementsDus(mois, null, "2026-11-28"), ["2026-10-01", "2026-11-01"]);
  assert.deepEqual(prochainVersement(mois, "2026-11-28"), { date: "2026-12-01", montant: 40 });
  assert.equal(prochainVersement(sem, "2026-11-28")!.date, "2026-12-05", "today is a Saturday: the next one");
  const e = etatPoche({ member_id: "m", prenom: "Léa", reglage: sem, aujourdhui: "2026-11-22", missions: [],
    mouvements: [{ id: "1", member_id: "m", date: "2026-11-07", type: "versement", montant: 10, libelle: "", auto: true }, { id: "2", member_id: "m", date: "2026-11-14", type: "versement", montant: 10, libelle: "", auto: true }, { id: "3", member_id: "m", date: "2026-11-15", type: "depense", montant: -6.5, libelle: "Cinéma", auto: false }, { id: "0", member_id: "m", date: "2026-10-31", type: "bonus", montant: 5, libelle: "", auto: false }],
    objectifs: [{ id: "o", member_id: "m", titre: "Casque", cible: 60, mis_de_cote: 12, cree_le: "" }] });
  assert.equal(e.solde, 18.5); assert.equal(e.mis_de_cote, 12); assert.equal(e.disponible, 6.5);
  assert.equal(e.recu_mois, 20); assert.equal(e.depense_mois, 6.5); assert.equal(e.mouvements[0].libelle, "Cinéma");
});

test("argent de poche : la cagnotte d'un enfant, du réglage à l'objectif acheté ; jamais pour un adulte ni un autre foyer", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "0";
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
    const j = (b: unknown, method = "POST") => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const h = (await (await api.request("/household")).json()) as any;
    const lea = db.addMember(h.id, "Léa", "enfant");
    const papa = db.addMember(h.id, "Paul", "adulte");
    assert.equal((await api.request(`/poche/${papa.id}`)).status, 404, "adults have no kitty");
    assert.equal((await api.request("/poche/inconnu/mouvements", j({ type: "bonus", montant: 5, libelle: "x" }))).status, 404);
    let e = await (await api.request(`/poche/${lea.id}`)).json() as any;
    assert.equal(e.reglage, null); assert.equal(e.solde, 0);
    // set up: 10 € every week, on today's weekday → nothing credited for the past, the next one in 7 days
    const jour = ((new Date().getUTCDay() + 6) % 7) + 1;
    assert.equal((await api.request(`/poche/${lea.id}/reglage`, j({ montant: 10, frequence: "semaine", jour: 9 }, "PUT"))).status, 400);
    e = await (await api.request(`/poche/${lea.id}/reglage`, j({ montant: 10, frequence: "semaine", jour }, "PUT"))).json();
    assert.equal(e.solde, 10, "today is the day: credited once"); assert.equal(e.mouvements[0].auto, true);
    e = await (await api.request(`/poche/${lea.id}`)).json(); assert.equal(e.solde, 10, "never twice the same day");
    // three weeks later (the setting is dated back): the missed weeks are credited when the page is read
    db.raw.prepare("UPDATE poche_reglages SET depuis = ?").run(new Date(Date.now() - 21 * 86400_000).toISOString().slice(0, 10));
    db.raw.prepare("DELETE FROM poche_mouvements").run();
    e = lirePoche(db, h.id, lea); assert.equal(e.solde, 40, "4 allowance days in 21 days, today included");
    // spending, bonus, deduction
    e = await (await api.request(`/poche/${lea.id}/mouvements`, j({ type: "depense", montant: 12.5, libelle: "Cinéma" }))).json(); assert.equal(e.solde, 27.5);
    e = await (await api.request(`/poche/${lea.id}/mouvements`, j({ type: "bonus", montant: 5, libelle: "Bulletin" }))).json(); assert.equal(e.solde, 32.5);
    e = await (await api.request(`/poche/${lea.id}/mouvements`, j({ type: "retenue", montant: 2.5, libelle: "Vitre" }))).json(); assert.equal(e.solde, 30);
    assert.equal((await api.request(`/poche/${lea.id}/mouvements`, j({ type: "versement", montant: 1000, libelle: "triche" }))).status, 400);
    // a goal: set aside what is available, no more; buying it spends it
    e = await (await api.request(`/poche/${lea.id}/objectifs`, j({ titre: "Casque", cible: 60 }))).json(); const o = e.objectifs[0];
    e = await (await api.request(`/poche/objectifs/${o.id}/mettre`, j({ montant: 20 }))).json(); assert.equal(e.mis_de_cote, 20); assert.equal(e.disponible, 10);
    e = await (await api.request(`/poche/objectifs/${o.id}/mettre`, j({ montant: 50 }))).json(); assert.equal(e.mis_de_cote, 30, "only what is available"); assert.equal(e.disponible, 0);
    assert.equal((await api.request(`/poche/objectifs/${o.id}/mettre`, j({ montant: 5 }))).status, 400);
    e = await (await api.request(`/poche/objectifs/${o.id}/mettre`, j({ montant: -10 }))).json(); assert.equal(e.mis_de_cote, 20);
    e = await (await api.request(`/poche/objectifs/${o.id}/acheter`, { method: "POST" })).json(); assert.equal(e.solde, 10); assert.equal(e.objectifs.length, 0); assert.equal(e.mouvements[0].libelle, "Casque");
    // a paid chore, done twice
    e = await (await api.request(`/poche/${lea.id}/missions`, j({ titre: "Tondre la pelouse", montant: 8 }))).json(); const mi = e.missions[0];
    await api.request(`/poche/missions/${mi.id}/payer`, { method: "POST" });
    e = await (await api.request(`/poche/missions/${mi.id}/payer`, { method: "POST" })).json(); assert.equal(e.solde, 26); assert.equal(e.missions.length, 1);
    // a line removed by mistake ; the family overview
    e = await (await api.request(`/poche/mouvements/${e.mouvements[0].id}`, { method: "DELETE" })).json(); assert.equal(e.solde, 18);
    const tous = await (await api.request("/poche")).json() as any;
    assert.deepEqual(tous.enfants.map((x: any) => [x.prenom, x.solde, x.en_place]), [["Léa", 18, true]]);
    // another household's ids do nothing here
    ensurePocheSchema(db);
    db.raw.prepare("INSERT INTO poche_objectifs (id, household_id, member_id, titre, cible, mis_de_cote, cree_le) VALUES ('autre', 'autre-foyer', 'x', 'Vélo', 100, 0, '')").run();
    assert.equal((await api.request("/poche/objectifs/autre/acheter", { method: "POST" })).status, 404);
  } finally { process.env.LUCIEN_AUTH = avant; }
});
