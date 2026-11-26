/**
 * The forwarding address plugs itself in: once LUCIEN_INBOX_DOMAIN, LUCIEN_INBOX_SECRET and BREVO_API_KEY are set (and
 * the domain's MX records point to Brevo), the server asks Brevo, at start-up, to post the emails received on that
 * domain to POST /api/inbox. Done once; the address is corrected by itself when the public address of Lucien changes.
 */
const API = "https://api.brevo.com/v3";
export async function brancherBoite(env = process.env, f = fetch) {
    const { LUCIEN_INBOX_DOMAIN: domaine, LUCIEN_INBOX_SECRET: secret, BREVO_API_KEY: cle } = env;
    const base = (env.LUCIEN_PUBLIC_URL ?? "").replace(/\/$/, "");
    if (!domaine || !secret || !cle || !base.startsWith("https://"))
        return "inactif";
    const url = `${base}/api/inbox?secret=${encodeURIComponent(secret)}`;
    const headers = { "api-key": cle, "content-type": "application/json", accept: "application/json" };
    try {
        const r = await f(`${API}/webhooks?type=inbound`, { headers });
        const hooks = r.ok ? (await r.json()).webhooks ?? [] : [];
        const le = hooks.find((h) => (h.type ?? "inbound") === "inbound" && (h.domain === domaine || /\/api\/inbox(\?|$)/.test(h.url)));
        if (le?.url === url)
            return "deja";
        if (le) {
            const m = await f(`${API}/webhooks/${le.id}`, { method: "PUT", headers, body: JSON.stringify({ url, domain: domaine, events: ["inboundEmailProcessed"] }) });
            if (!m.ok)
                throw new Error(`Brevo ${m.status} ${(await m.text()).slice(0, 200)}`);
            return "corrige";
        }
        const c = await f(`${API}/webhooks`, { method: "POST", headers, body: JSON.stringify({ type: "inbound", events: ["inboundEmailProcessed"], url, domain: domaine, description: "Lucien — papiers reçus par email" }) });
        if (!c.ok)
            throw new Error(`Brevo ${c.status} ${(await c.text()).slice(0, 200)}`);
        return "cree";
    }
    catch (e) {
        console.error(`[boîte email] branchement impossible : ${e.message.replace(secret, "…")}`);
        return "echec";
    }
}
export function demarrerBoite() {
    if (!process.env.LUCIEN_INBOX_DOMAIN) {
        console.log("[boîte email] fermée : LUCIEN_INBOX_DOMAIN non réglé");
        return;
    }
    void brancherBoite().then((r) => console.log(`[boîte email] ${process.env.LUCIEN_INBOX_DOMAIN} : ${{ inactif: "en attente (LUCIEN_INBOX_SECRET, BREVO_API_KEY et une adresse publique https sont nécessaires)", deja: "branchée", cree: "branchée à l'instant chez Brevo", corrige: "adresse de réception corrigée chez Brevo", echec: "non branchée (voir l'erreur ci-dessus)" }[r]}`));
}
