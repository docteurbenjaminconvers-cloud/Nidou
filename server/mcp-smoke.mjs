// Smoke test: talks to the Nidou MCP endpoint like Claude or ChatGPT would.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.NIDOU_URL ?? "http://localhost:3000/mcp";
const token = process.env.NIDOU_MCP_TOKEN ?? "";
const t = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} } });
const c = new Client({ name: "nidou-smoke", version: "0" });
await c.connect(t);
const tools = await c.listTools();
console.log("outils:", tools.tools.map((x) => x.name).join(", "));
const items = JSON.parse((await c.callTool({ name: "echeances", arguments: {} })).content[0].text);
console.log("échéances 90 j:", items.length, "→", items[0]?.date, items[0]?.titre);
const ch = JSON.parse((await c.callTool({ name: "charges_fixes", arguments: {} })).content[0].text);
console.log("charges: total", ch.total_mensuel, "€/mois, alertes", ch.alertes.length);
const s = JSON.parse((await c.callTool({ name: "rechercher", arguments: { q: "passeport" } })).content[0].text);
console.log("recherche passeport:", s.map((x) => x.titre).join(" | "));
const bad = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" }, body: "{}" });
console.log("sans token →", bad.status);
await c.close();
