import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { handleMcpRequest } from "./mcp.js";

async function rpc(db: Db, token: string, method: string, params: unknown) {
  const r = await handleMcpRequest(db, new Request("http://x/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }));
  assert.equal(r.status, 200, await r.clone().text());
  return (await r.json() as any).result;
}
const appel = async (db: Db, token: string, name: string, args: unknown) => JSON.parse((await rpc(db, token, "tools/call", { name, arguments: args })).content[0].text);

test("connecteur : lecture seule par défaut ; avec l'accord du foyer, l'assistant range un papier, ajoute une échéance et une activité", async () => {
  const cle = process.env.ANTHROPIC_API_KEY; delete process.env.ANTHROPIC_API_KEY;
  try {
    const db = new Db(":memory:");
    const h = db.createHousehold("Famille");
    db.raw.prepare("UPDATE households SET plan = 'famille' WHERE id = ?").run(h.id);
    const token = db.getHousehold(h.id)!.mcp_token!;
    db.addMember(h.id, "Daphné", "enfant", {} as never);

    const outils = (await rpc(db, token, "tools/list", {})).tools.map((t: any) => t.name);
    assert.ok(outils.includes("echeances")); assert.ok(!outils.includes("ranger_papier"), "no writing tool unless allowed");

    db.raw.prepare("UPDATE households SET mcp_ecriture = 1 WHERE id = ?").run(h.id);
    const liste = (await rpc(db, token, "tools/list", {})).tools;
    for (const n of ["ranger_papier", "ajouter_echeance", "echeance_faite", "ajouter_activite"]) assert.equal(liste.find((t: any) => t.name === n)?.annotations?.destructiveHint, false, n);
    assert.ok(!liste.some((t: any) => /supprim|envoy|modifi/.test(t.name)), "never a deletion, a change or a sending");

    const p = await appel(db, token, "ranger_papier", { texte: "MAIF — Avis d'échéance. Assurance habitation, contrat n° HAB-778899. Cotisation annuelle 312,00 €. Échéance le 01/03/2027.", nom: "Avis d'échéance MAIF" });
    assert.equal(p.range, true);
    assert.equal(db.listDocuments(h.id).length, 1); assert.equal(db.listDocuments(h.id)[0].source, "assistant");

    const e = await appel(db, token, "ajouter_echeance", { titre: "Renouveler le passeport", date: "2027-03-15" });
    assert.equal(e.ajoutee, true);
    assert.deepEqual(await appel(db, token, "echeance_faite", { id: e.id }), { ok: true });
    assert.equal(db.listDeadlines(h.id, { includeDone: true }).find((x) => x.id === e.id)!.fait, 1);

    assert.match((await appel(db, token, "ajouter_activite", { titre: "Piano", jour: "mardi", heure_debut: "18:00", pour: "Inconnu" })).erreur, /Daphné/);
    const a = await appel(db, token, "ajouter_activite", { titre: "Piano", jour: "mardi", heure_debut: "18:00", pour: "daphne" });
    assert.equal(a.ajoutee, true); assert.equal(db.listActivites(h.id)[0].jour, 2);

    const journal = db.listMcpAccess(h.id).map((x) => x.outil);
    for (const n of ["ranger_papier", "ajouter_echeance", "echeance_faite", "ajouter_activite"]) assert.ok(journal.includes(n), `${n} in the access log`);
    // thirty additions a day at most
    for (let i = 0; i < 30; i++) db.logMcpAccess(h.id, "ajouter_echeance", {});
    assert.match((await appel(db, token, "ajouter_echeance", { titre: "Une de trop", date: "2027-01-01" })).erreur, /Trente ajouts/);
  } finally { if (cle) process.env.ANTHROPIC_API_KEY = cle; }
});
