import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { accuserReception, processInboundEmail, codeFromAddress, cleanBody, boiteAddress, fromBrevo, texteDuHtml } from "./inbox.js";
import { brancherBoite } from "./boiteBrevo.js";
import { PDFDocument } from "pdf-lib";
import { deflateSync, crc32 } from "node:zlib";
import { randomBytes } from "node:crypto";

/** A real PNG of noise (n × n pixels): heavy enough not to be taken for a logo. */
function png(n: number): Buffer {
  const bloc = (type: string, data: Buffer) => { const t = Buffer.concat([Buffer.from(type), data]); const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(t) >>> 0); return Buffer.concat([l, t, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  const brut = Buffer.concat(Array.from({ length: n }, () => Buffer.concat([Buffer.from([0]), randomBytes(n * 3)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc("IHDR", ihdr), bloc("IDAT", deflateSync(brut)), bloc("IEND", Buffer.alloc(0))]);
}

test("adresse de transfert : un email transféré devient un papier avec ses échéances", async () => {
  const db = new Db(":memory:");
  const h = db.createHousehold("Test", 15); // trial → famille
  const to = boiteAddress(h.boite_code)!;
  assert.match(to, /^foyer-[a-z0-9]{6}@in\.monlucien\.fr$/);
  assert.equal(codeFromAddress(to), h.boite_code);
  const mail = {
    message_id: "<m1@example>", to: [to], from: "noreply@maif.fr", subject: "Fwd: Avis d'échéance",
    text: "---------- Message transféré ----------\nMAIF — Avis d'échéance\nContrat n° AUT-4471-8820\nCotisation annuelle : 612 €\nPériode du 01/12/2026 au 30/11/2027\n> ancienne citation\n-- \nEnvoyé de mon iPhone",
    attachments: [],
  };
  const plan = () => "famille" as const;
  const r = await processInboundEmail(db, mail, { plan });
  assert.equal(r.statut, "ok");
  if (r.statut !== "ok") return;
  assert.equal(r.documents.length, 1);
  assert.equal(r.documents[0].source, "email");
  assert.equal(r.documents[0].organisme, "MAIF");
  assert.ok(db.listDeadlines(h.id).length >= 1, "deadlines derived");
  // same message again: ignored
  const again = await processInboundEmail(db, mail, { plan });
  assert.deepEqual(again, { statut: "ignore", raison: "deja_traite" });
  // unknown recipient / free plan
  assert.deepEqual(await processInboundEmail(db, { ...mail, message_id: "m2", to: ["foyer-zzzzzz@in.monlucien.fr"] }, { plan }), { statut: "ignore", raison: "destinataire_inconnu" });
  assert.deepEqual(await processInboundEmail(db, { ...mail, message_id: "m3" }, { plan: () => "gratuit" }), { statut: "ignore", raison: "plan_gratuit" });
});

test("nettoyage du corps : citations et signature retirées", () => {
  assert.equal(cleanBody("Bonjour\n> cité\n> encore\n-- \nSignature"), "Bonjour");
});

test("email transféré : la signature placée au-dessus (Gmail) ne fait pas perdre le message ; Apple Mail est décité", () => {
  const gmail = "Pour Lucien\n-- \nBenjamin\n06 00 00 00 00\n\n---------- Forwarded message ---------\nDe: EDF <facture@edf.fr>\nDate: lun. 2 nov. 2026\nSubject: Votre facture\n\nMontant : 312,40 €\nÉchéance le 17/11/2026";
  const c = cleanBody(gmail);
  assert.match(c, /^Montant : 312,40 €/); assert.match(c, /Email reçu de : EDF <facture@edf\.fr>$/); assert.doesNotMatch(c, /06 00 00/);
  const apple = "Envoyé de mon iPhone\n\nDébut du message transféré :\n\n> De: Free <f@free.fr>\n> Objet: Facture\n> \n> Total 29,99 €\n";
  assert.match(cleanBody(apple), /Total 29,99 €/); assert.doesNotMatch(cleanBody(apple), /iPhone|^>/m);
  assert.equal(cleanBody("Nom : ____________\nSuite du texte"), "Nom : ____________\nSuite du texte", "underscores of a form are not a forward");
  assert.equal(texteDuHtml("<html><head><style>p{}</style></head><body><p>Facture n&deg; 12</p><table><tr><td>Total</td><td>29,99&nbsp;&euro;</td></tr></table></body></html>"), "Facture n° 12\nTotal 29,99 €");
});

test("email : deux photos = un seul papier ; les logos sont ignorés ; accusé de réception au membre du foyer seulement", async () => {
  const cle = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  const log = console.log; const vus: string[] = []; console.log = (...a: unknown[]) => { vus.push(a.join(" ")); };
  try {
    const db = new Db(":memory:");
    const h = db.createHousehold("Test", 15);
    const u = db.raw.prepare("INSERT INTO users (id, email, prenom, cree_le) VALUES ('u1', 'ben@x.fr', 'Ben', '2026-01-01') RETURNING id").get() as any;
    db.raw.prepare("INSERT INTO household_users (household_id, user_id, role, rejoint_le) VALUES (?, ?, 'titulaire', '2026-01-01')").run(h.id, u.id);
    const to = boiteAddress(h.boite_code)!;
    // a real (tiny) PNG, padded over the logo threshold with a second copy as "page"
    const pdf = await PDFDocument.create(); pdf.addPage(); const unPdf = Buffer.from(await pdf.save()).toString("base64");
    const logo = { nom: "logo.png", mime: "image/png", base64: Buffer.alloc(2000).toString("base64") };
    const texte = "MAIF — Avis d'échéance. Assurance habitation, contrat n° HAB-778899. Cotisation annuelle 312,00 €. Échéance le 01/03/2027.";
    const r = await processInboundEmail(db, { message_id: "a1", to: [to], from: "Ben@x.fr", subject: "Fwd: Avis MAIF", text: texte, attachments: [logo, { nom: "avis.pdf", mime: "application/pdf", base64: unPdf }] }, { plan: () => "famille" });
    assert.equal(r.statut, "ok"); if (r.statut !== "ok") return;
    assert.equal(r.documents.length, 1, "the logo is not a paper");
    assert.equal(await accuserReception(db, { message_id: "a1", to: [to], from: "Ben@x.fr", subject: "Fwd: Avis MAIF", text: texte, attachments: [] }, r), true);
    assert.ok(vus.some((v) => /\[email → ben@x\.fr.*Lucien — Avis MAIF/.test(v)), vus.join("|"));
    assert.equal(await accuserReception(db, { message_id: "a1", to: [to], from: "noreply@maif.fr", subject: "x", text: texte, attachments: [] }, r), false, "never an answer to a company");
    // two photos of the same letter: one paper (a PDF of two pages)
    const photo = { nom: "IMG_1.png", mime: "image/png", base64: png(110).toString("base64") };
    const deux = await processInboundEmail(db, { message_id: "a3", to: [to], from: "ben@x.fr", subject: "courrier", text: texte, attachments: [photo, { ...photo, nom: "IMG_2.png" }] }, { plan: () => "famille" });
    assert.equal(deux.statut, "ok"); if (deux.statut !== "ok") return;
    assert.equal(deux.documents.length, 1); assert.equal(deux.documents[0].mime, "application/pdf");
    const rien = await processInboundEmail(db, { message_id: "a2", to: [to], from: "ben@x.fr", subject: "coucou", text: "ok", attachments: [logo] }, { plan: () => "famille" });
    assert.deepEqual(rien, { statut: "ignore", raison: "rien_a_lire" });
    assert.equal(await accuserReception(db, { message_id: "a2", to: [to], from: "ben@x.fr", subject: "coucou", text: "ok", attachments: [] }, rien), true);
    assert.ok(vus.some((v) => /rien trouvé à lire/.test(v) || /Lucien — coucou/.test(v)));
  } finally { console.log = log; if (cle) process.env.ANTHROPIC_API_KEY = cle; }
});

test("Brevo : Uuid en tableau, email sans texte lu depuis son HTML ; branchement créé une fois, corrigé si l'adresse change", async () => {
  const [m] = await fromBrevo({ items: [{ Uuid: ["u-1"], From: { Address: "a@b.fr" }, To: [{ Address: "x@y.fr" }], Cc: [{ Address: "foyer-abc123@in.monlucien.fr" }], Subject: "S", RawTextBody: " ", RawHtmlBody: "<p>Bonjour</p><p>Total 12 &euro;</p>" }] });
  assert.equal(m.message_id, "u-1"); assert.equal(m.text, "Bonjour\nTotal 12 €"); assert.ok(m.to.includes("foyer-abc123@in.monlucien.fr"));
  const env = { LUCIEN_INBOX_DOMAIN: "in.monlucien.fr", LUCIEN_INBOX_SECRET: "s3cret-s3cret", BREVO_API_KEY: "k", LUCIEN_PUBLIC_URL: "https://app.monlucien.fr" } as any;
  let hooks: any[] = []; const appels: string[] = [];
  const f = (async (u: string, o: any = {}) => {
    appels.push(`${o.method ?? "GET"} ${u.replace("https://api.brevo.com/v3", "")}`);
    if (!o.method) return new Response(JSON.stringify({ webhooks: hooks }));
    const b = JSON.parse(o.body);
    if (o.method === "POST") { hooks = [{ id: 7, url: b.url, type: "inbound", domain: b.domain }]; return new Response(JSON.stringify({ id: 7 }), { status: 201 }); }
    hooks[0].url = b.url; return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;
  assert.equal(await brancherBoite({ ...env, LUCIEN_INBOX_SECRET: undefined }, f), "inactif");
  assert.equal(await brancherBoite(env, f), "cree");
  assert.equal(hooks[0].url, "https://app.monlucien.fr/api/inbox?secret=s3cret-s3cret");
  assert.equal(await brancherBoite(env, f), "deja");
  assert.equal(await brancherBoite({ ...env, LUCIEN_PUBLIC_URL: "https://autre.monlucien.fr/" }, f), "corrige");
  assert.equal(hooks[0].url, "https://autre.monlucien.fr/api/inbox?secret=s3cret-s3cret");
  assert.deepEqual(appels.filter((a) => !a.startsWith("GET")), ["POST /webhooks", "PUT /webhooks/7"]);
});
