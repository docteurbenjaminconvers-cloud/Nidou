import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { consommerLien, demanderLien } from "./auth.js";

test("lien magique : création du compte et du nid, puis invitation du conjoint", async () => {
  const db = new Db(":memory:");
  const r1 = await demanderLien(db, "Benjamin@Example.org", { prenom: "Benjamin" });
  assert.ok(r1.lien && !r1.envoye, "no transport → link returned");
  const token = new URL(r1.lien!).searchParams.get("token")!;
  const c1 = consommerLien(db, token, 15);
  assert.ok(c1.ok); if (!c1.ok) return;
  assert.equal(c1.user.email, "benjamin@example.org");
  assert.equal(db.householdsOfUser(c1.user.id)[0].role, "proprietaire");
  assert.equal(db.effectivePlan(c1.household), "famille", "trial starts");
  assert.ok(db.userBySession(c1.session));
  // a link is single-use
  assert.deepEqual(consommerLien(db, token, 15), { ok: false, raison: "utilise" });
  // invitation
  const inv = await demanderLien(db, "camille@example.org", { household_id: c1.household.id, prenom: "Camille", invite_par: "Benjamin" });
  const t2 = new URL(inv.lien!).searchParams.get("token")!;
  assert.equal(db.listInvitations(c1.household.id).length, 1);
  const c2 = consommerLien(db, t2, 15);
  assert.ok(c2.ok); if (!c2.ok) return;
  assert.equal(c2.household.id, c1.household.id, "joined the same nest");
  assert.equal(db.usersOfHousehold(c1.household.id).length, 2);
  assert.ok(db.listMembers(c1.household.id).some((m) => m.prenom === "Camille"), "member card created");
  assert.equal(db.listInvitations(c1.household.id).length, 0);
  // MCP token per household
  assert.equal(db.householdByMcpToken(c1.household.mcp_token!)?.id, c1.household.id);
  assert.deepEqual(consommerLien(db, "nope", 15), { ok: false, raison: "invalide" });
});
