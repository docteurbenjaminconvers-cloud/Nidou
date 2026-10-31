import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { demandeAutorisee } from "./auth.js";
const CSP_APPLI = [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' data: blob:", "media-src 'self' blob:",
    "connect-src 'self'", "worker-src 'self'", "manifest-src 'self'", "frame-ancestors 'none'", "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com https://billing.stripe.com", "object-src 'none'",
].join("; ");
/** The marketing site has small inline scripts (forms, languages) and its video. */
const CSP_SITE = [
    "default-src 'self'", "script-src 'self' 'unsafe-inline'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com", "img-src 'self' data:", "media-src 'self'", "connect-src 'self'",
    "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'",
].join("; ");
export const entetesSecurite = async (c, next) => {
    await next();
    const h = c.res.headers;
    const chemin = new URL(c.req.url).pathname;
    if (!h.has("content-security-policy") && !chemin.startsWith("/mcp"))
        h.set("content-security-policy", chemin.startsWith("/site") ? CSP_SITE : CSP_APPLI);
    h.set("x-content-type-options", "nosniff");
    h.set("x-frame-options", "DENY");
    h.set("referrer-policy", h.get("referrer-policy") ?? "strict-origin-when-cross-origin");
    h.set("permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=()");
    h.set("cross-origin-opener-policy", "same-origin");
    if ((process.env.LUCIEN_PUBLIC_URL ?? "").startsWith("https://"))
        h.set("strict-transport-security", "max-age=31536000; includeSubDomains");
};
/** Origins allowed to call the public forms from the browser (the marketing site lives on its own domain). */
export function originesSite() {
    const env = process.env.LUCIEN_CORS_ORIGINES;
    if (env)
        return env.split(",").map((s) => s.trim()).filter(Boolean);
    return ["https://monlucien.fr", "https://www.monlucien.fr", "https://docteurbenjaminconvers-cloud.github.io", process.env.LUCIEN_PUBLIC_URL ?? ""].filter(Boolean).map((o) => o.replace(/\/$/, ""));
}
const FORMULAIRES_PUBLICS = ["/api/waitlist", "/api/partenaires"];
const limiteInscriptions = async (c, next) => {
    if (c.req.method !== "POST")
        return next();
    const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || c.req.header("x-real-ip") || "inconnue";
    if (!demandeAutorisee(`form:${ip}`, 5))
        return c.json({ error: "trop_de_demandes", message: "Trop d'envois depuis ce réseau. Réessayez dans 15 minutes." }, 429);
    return next();
};
const trop = (c) => c.json({ error: "trop_lourd", message: "Fichier trop lourd : 15 Mo au plus." }, 413);
export function securiser(app) {
    app.use("*", entetesSecurite);
    for (const p of FORMULAIRES_PUBLICS) {
        app.use(p, cors({ origin: originesSite(), allowMethods: ["POST", "OPTIONS"], allowHeaders: ["content-type"] }));
        app.use(p, limiteInscriptions);
    }
    // papers, photos and statements: 15 MB; any other request: 1 MB (refused before reading the body)
    app.use("/api/*", async (c, next) => {
        const p = new URL(c.req.url).pathname;
        const lourd = (c.req.method === "POST" || c.req.method === "PUT") && /^\/api\/(documents|transactions\/import|members\/[^/]+\/photo|inbox|veilles)$/.test(p);
        return bodyLimit({ maxSize: lourd ? 15 * 1024 * 1024 + 64 * 1024 : 1024 * 1024, onError: trop })(c, next);
    });
}
