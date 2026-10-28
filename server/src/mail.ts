/**
 * Outbound email: Brevo transactional API when BREVO_API_KEY is set, otherwise the console (development).
 * Returns true when a real email left; false when it was only logged, so callers can show the link in dev.
 */
export interface Mail { to: string; subject: string; text: string; html?: string }

export async function envoyerEmail(m: Mail): Promise<boolean> {
  const key = process.env.BREVO_API_KEY;
  const from = process.env.NIDOU_EMAIL_FROM ?? "Nidou <bonjour@nidou.fr>";
  if (!key) {
    console.log(`[email → ${m.to}] ${m.subject}\n${m.text}\n`);
    return false;
  }
  const [, name, email] = from.match(/^(.*?)\s*<([^>]+)>$/) ?? [null, "Nidou", from];
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json" },
    body: JSON.stringify({ sender: { name: name || "Nidou", email }, to: [{ email: m.to }], subject: m.subject, textContent: m.text, htmlContent: m.html ?? `<pre style="font-family:sans-serif;white-space:pre-wrap">${escapeHtml(m.text)}</pre>` }),
  });
  if (!r.ok) { console.error("[email] Brevo", r.status, await r.text().catch(() => "")); return false; }
  return true;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
