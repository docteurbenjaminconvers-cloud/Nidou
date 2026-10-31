import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./db.js";
import { seedDemo } from "./seed.js";
import { createApi, typePhoto } from "./api.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

test("photo d'un membre : vraies images seulement, servies comme images, remplacées proprement", async () => {
  process.env.LUCIEN_AUTH = "0";
  const db = new Db(":memory:");
  const h = seedDemo(db);
  const api = createApi(db, { uploadDir: "/tmp/lucien-test-uploads" });
  const m = db.listMembers(h.id)[0];
  assert.equal((await api.request(`/members/${m.id}/photo`)).status, 404, "no photo yet");
  const html = new TextEncoder().encode("<svg onload=alert(1)></svg>");
  assert.equal((await api.request(`/members/${m.id}/photo`, { method: "PUT", body: html, headers: { "content-type": "image/jpeg" } })).status, 400, "the declared type is not trusted");
  const r = await api.request(`/members/${m.id}/photo`, { method: "PUT", body: JPEG });
  assert.equal(r.status, 200);
  const v1 = (await r.json()).photo as string;
  assert.match(v1, /^membre-.+\.jpg$/);
  const g = await api.request(`/members/${m.id}/photo`);
  assert.equal(g.headers.get("content-type"), "image/jpeg");
  assert.equal(g.headers.get("x-content-type-options"), "nosniff");
  const v2 = (await (await api.request(`/members/${m.id}/photo`, { method: "PUT", body: JPEG })).json()).photo;
  assert.notEqual(v2, v1, "a new name each time, so caches refresh");
  assert.equal((await api.request(`/members/${m.id}/photo`, { method: "PUT", body: new Uint8Array(700 * 1024).fill(0xff) })).status, 413);
  await api.request(`/members/${m.id}/photo`, { method: "DELETE" });
  assert.equal(db.getMember(m.id)!.photo, null);
  assert.equal(typePhoto(new TextEncoder().encode("RIFF0000WEBPVP8 ")), "webp");
});
