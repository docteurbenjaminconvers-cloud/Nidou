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
    const envois = await (await api.request(`/courriers/${doc.id}/envois`, { headers: ck })).json() as any;
    assert.equal(envois.envois.length, 1);
    assert.equal(db.raw.prepare("SELECT expediteur_adresse a FROM households WHERE id = ?").get(hid)!.a, "1 rue X\n34000 Montpellier", "the sender is remembered");
  } finally {
    console.log = log; process.env.LUCIEN_AUTH = avant;
  }
});
