import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Db } from "./db.js";
import { createApi } from "./api.js";
import { consommerLien, demanderLien, oublierDemandes } from "./auth.js";
import { initCoffre } from "./coffre.js";
import { courrierModele, emailsDuTexte } from "./courriers.js";
import { texteLettre } from "./lettres.js";
import { etatSuivi, mediateurPour } from "./suiviCourriers.js";

const RELANCE = `DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES
Centre des Finances Publiques
Service de gestion comptable d'Uzès
2 place de la Mairie
30700 Uzès
sgc.uzes@dgfip.finances.gouv.fr — ne-pas-repondre@dgfip.finances.gouv.fr
Lettre de relance n° 53894425132
Facture n° 15695 du 05/08/2026, contrat n° EA-A05297, montant 24,42 €`;

test("courrier de réclamation : sans IA, les mots de la personne, le montant, les références et l'adresse du papier", () => {
  assert.deepEqual(emailsDuTexte(RELANCE), ["sgc.uzes@dgfip.finances.gouv.fr"], "never a no-reply address");
  const doc = { id: "d", household_id: "h", member_id: null, title: "Lettre de relance 24,42 € — Finances Publiques (SGC Uzès)", category: "autre", organisme: "Centre des Finances Publiques", numero_contrat: "EA-A05297", montant: 24.42, periodicite: "unique", date_document: "2026-10-12", date_debut: null, date_fin: null, preavis_jours: null, resume: null, texte: RELANCE, fichier: null, mime: null, confiance: 0.8, verifie: 0, source: "app", cree_le: "" } as any;
  const l = courrierModele({ type: "reclamation", doc, motif: "C'est déjà payé", explication: "J'ai payé par virement le 20 août 2026", expediteur: { nom: "Benjamin Convers", adresse: "1 rue X\n34000 Montpellier" }, aujourdhui: "2026-11-09" });
  const t = texteLettre(l);
  assert.match(t, /Références : contrat n° EA-A05297/);
  assert.match(t, /C'est déjà payé\./);
  assert.match(t, /J'ai payé par virement le 20 août 2026\./);
  assert.match(t, /24,42 €/);
  assert.match(t, /2 place de la Mairie\n30700 Uzès/);
  assert.match(l.objet, /^Contestation/);
});

test("courrier : rédigé, puis envoyé seulement à une adresse lue dans les papiers du foyer, la personne en copie", async () => {
  const avant = process.env.LUCIEN_AUTH; process.env.LUCIEN_AUTH = "1"; oublierDemandes();
  const data = mkdtempSync(join(tmpdir(), "courrier-api-"));
  initCoffre(data);
  const log = console.log; const vus: string[] = []; console.log = (...a: unknown[]) => { vus.push(a.join(" ")); };
  try {
    const db = new Db(":memory:");
    const api = createApi(db, { uploadDir: join(data, "uploads") });
    const r = await demanderLien(db, "ben@x.fr", { prenom: "Benjamin" });
    const s = consommerLien(db, new URL(r.lien!).searchParams.get("token")!, 15); assert.ok(s.ok);
    const ck = { cookie: `lucien_session=${s.ok ? s.session : ""}`, "content-type": "application/json" };
    const hid = s.ok ? s.household.id : "";
    const vide = { member_id: null, montant: 24.42, periodicite: "unique", date_document: null, date_debut: null, date_fin: null, preavis_jours: null, resume: null, fichier: null, mime: null, confiance: 1 };
    const doc = db.insertDocument({ ...vide, household_id: hid, title: "Lettre de relance — SGC Uzès", category: "autre", organisme: "Centre des Finances Publiques", numero_contrat: "EA-A05297", texte: RELANCE } as any);

    const red = await api.request("/courriers/rediger", { method: "POST", headers: ck, body: JSON.stringify({ document_id: doc.id, type: "reclamation", motif: "deja_paye", explication: "J'ai payé par virement le 20 août 2026" }) });
    assert.equal(red.status, 200);
    const b = await red.json() as any;
    assert.deepEqual(b.emails, ["sgc.uzes@dgfip.finances.gouv.fr"]);
    assert.match(b.corps, /20 août 2026/);
    assert.equal(b.email_client, "ben@x.fr");

    const courrier = { document_id: doc.id, expediteur: { nom: "Benjamin Convers", adresse: "1 rue X\n34000 Montpellier" }, destinataire: b.lettre.destinataire, objet: b.lettre.objet, reference: b.lettre.reference, corps: b.corps };
    const pdf = await api.request("/courriers/pdf", { method: "POST", headers: ck, body: JSON.stringify(courrier) });
    assert.equal(pdf.status, 200); assert.equal(pdf.headers.get("content-type"), "application/pdf");

    const ailleurs = await api.request("/courriers/envoyer", { method: "POST", headers: ck, body: JSON.stringify({ ...courrier, email: "quelquun@ailleurs.fr" }) });
    assert.equal(ailleurs.status, 400, "never to an address that is not in the papers");
    const ok = await api.request("/courriers/envoyer", { method: "POST", headers: ck, body: JSON.stringify({ ...courrier, email: "sgc.uzes@dgfip.finances.gouv.fr" }) });
    assert.equal(ok.status, 201);
    assert.ok(vus.some((v) => /\[email → sgc\.uzes@dgfip\.finances\.gouv\.fr \(copie ben@x\.fr\) \(répondre à ben@x\.fr\) \[Courrier-.*\.pdf\]\] Contestation/.test(v)));
    // an address the AI read on the photo of a paper (no text kept): recorded by « rédiger », then allowed
    db.raw.prepare("INSERT INTO courrier_emails (household_id, document_id, email) VALUES (?, ?, ?)").run(hid, doc.id, "sip.uzes@dgfip.finances.gouv.fr");
    assert.equal((await api.request("/courriers/envoyer", { method: "POST", headers: ck, body: JSON.stringify({ ...courrier, email: "sip.uzes@dgfip.finances.gouv.fr" }) })).status, 201);
    const envois = await (await api.request(`/courriers/${doc.id}/envois`, { headers: ck })).json() as any;
    assert.equal(envois.envois.length, 2);
    // the answer is awaited: one agenda line 15 days from now, moved by the second letter
    const attentes = () => db.listDeadlines(hid, { includeDone: true }).filter((x) => x.type === "courrier");
    assert.equal(attentes().length, 1); assert.match(attentes()[0].titre, /Réponse attendue de Centre des Finances Publiques/);
    let suivi = (await (await api.request("/courriers/suivi", { headers: ck })).json() as any).suivis;
    assert.equal(suivi.length, 1); assert.equal(suivi[0].statut, "attente"); assert.equal(suivi[0].envois.length, 2);
    // 16 days later, a single letter: time for the reminder, written from the letter kept
    db.raw.prepare("DELETE FROM lettres_envoyees WHERE destinataire LIKE 'sip.%'").run();
    db.raw.prepare("UPDATE lettres_envoyees SET envoye_le = ?").run(new Date(Date.now() - 16 * 86400_000).toISOString());
    suivi = (await (await api.request("/courriers/suivi", { headers: ck })).json() as any).suivis;
    assert.equal(suivi[0].statut, "relancer"); assert.match(suivi[0].mediateur.nom, /consommation/);
    const rel = await (await api.request("/courriers/relance", { method: "POST", headers: ck, body: JSON.stringify({ document_id: doc.id }) })).json() as any;
    assert.match(rel.lettre.objet, /^Relance — Contestation/); assert.match(rel.corps, /resté sans réponse/); assert.match(rel.corps, /médiateur de la consommation/);
    assert.deepEqual(rel.emails, ["sgc.uzes@dgfip.finances.gouv.fr"]); assert.equal(rel.lettre.destinataire.adresse, b.lettre.destinataire.adresse);
    assert.equal((await api.request("/courriers/envoyer", { method: "POST", headers: ck, body: JSON.stringify({ ...courrier, objet: rel.lettre.objet, corps: rel.corps, email: rel.emails[0] }) })).status, 201);
    suivi = (await (await api.request("/courriers/suivi", { headers: ck })).json() as any).suivis;
    assert.equal(suivi[0].statut, "attente"); assert.match(attentes().find((x) => !x.fait)!.note!, /Relance envoyée/);
    // still nothing 15 days after the reminder: the mediator ; then the answer comes
    db.raw.prepare("UPDATE lettres_envoyees SET envoye_le = ? WHERE objet LIKE 'Relance%'").run(new Date(Date.now() - 15 * 86400_000).toISOString());
    suivi = (await (await api.request("/courriers/suivi", { headers: ck })).json() as any).suivis;
    assert.equal(suivi[0].statut, "mediateur");
    assert.equal((await api.request("/courriers/suivi/repondu", { method: "POST", headers: ck, body: JSON.stringify({ document_id: doc.id, repondu: true }) })).status, 200);
    suivi = (await (await api.request("/courriers/suivi", { headers: ck })).json() as any).suivis;
    assert.equal(suivi[0].statut, "repondu"); assert.ok(attentes().every((x) => x.fait));
    assert.equal(db.raw.prepare("SELECT expediteur_adresse a FROM households WHERE id = ?").get(hid)!.a, "1 rue X\n34000 Montpellier", "the sender is remembered");
  } finally {
    console.log = log; process.env.LUCIEN_AUTH = avant;
  }
});

test("suivi d'un courrier : attente, relance à 15 jours, médiateur après la relance ; le bon médiateur selon le papier", () => {
  const doc = { id: "d", title: "Facture EDF", organisme: "EDF", category: "energie" };
  const e1 = { id: "1", destinataire: "a@edf.fr", objet: "Contestation", envoye_le: "2026-11-01T10:00:00.000Z" };
  assert.equal(etatSuivi(doc, [e1], null, "2026-11-15").statut, "attente");
  const s = etatSuivi(doc, [e1], null, "2026-11-16");
  assert.equal(s.statut, "relancer"); assert.equal(s.prochaine_etape_le, "2026-11-16"); assert.equal(s.mediateur_des_le, "2026-12-31");
  const e2 = { ...e1, id: "2", envoye_le: "2026-11-17T09:00:00.000Z" };
  assert.equal(etatSuivi(doc, [e1, e2], null, "2026-11-20").statut, "attente");
  assert.equal(etatSuivi(doc, [e1, e2], null, "2026-12-02").statut, "mediateur");
  assert.equal(etatSuivi(doc, [e1, e2], "2026-12-03", "2026-12-10").statut, "repondu");
  assert.match(mediateurPour("telecom").site!, /mediation-telecom/); assert.match(mediateurPour("impots").nom, /Conciliateur fiscal/); assert.equal(mediateurPour("autre").attente_jours, null);
});
