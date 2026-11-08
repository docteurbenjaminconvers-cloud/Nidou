/**
 * Outbound email: Brevo transactional API when BREVO_API_KEY is set, otherwise the console (development).
 * Returns true when a real email left; false when it was only logged, so callers can show the link in dev.
 */
import { traduire } from "./traduire.js";
export async function envoyerEmail(mail) {
    const l = mail.langue === "en" ? "en" : "fr";
    const m = l === "en" ? { ...mail, subject: traduire(mail.subject, l), text: traduire(mail.text, l) } : mail;
    const key = process.env.BREVO_API_KEY;
    const from = m.de ?? process.env.LUCIEN_EMAIL_FROM ?? "Lucien <bonjour@monlucien.fr>";
    if (!key) {
        // Development: the email (with its login link) is printed. In production the content stays out of the logs.
        if ((process.env.LUCIEN_PUBLIC_URL ?? "").startsWith("https://"))
            console.error(`[email] aucun service d'email configuré (BREVO_API_KEY) : « ${m.subject} » non envoyé`);
        else
            console.log(`[email → ${m.to}${m.cc ? ` (copie ${m.cc})` : ""}${m.replyTo ? ` (répondre à ${m.replyTo})` : ""}${m.pieces?.length ? ` [${m.pieces.map((p) => p.nom).join(", ")}]` : ""}] ${m.subject}\n${m.text}\n`);
        return false;
    }
    const [, name, email] = from.match(/^(.*?)\s*<([^>]+)>$/) ?? [null, "Lucien", from];
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ sender: { name: name || "Lucien", email }, to: [{ email: m.to }], ...(m.cc ? { cc: [{ email: m.cc }] } : {}), ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}), ...(m.pieces?.length ? { attachment: m.pieces.map((p) => ({ name: p.nom, content: Buffer.from(p.contenu).toString("base64") })) } : {}), subject: m.subject, textContent: m.text, htmlContent: m.html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(m.text)}</pre>` }),
    });
    if (!r.ok) {
        console.error("[email] Brevo", r.status, await r.text().catch(() => ""));
        return false;
    }
    return true;
}
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
