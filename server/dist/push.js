import webpush from "web-push";
/**
 * Web Push (VAPID). Keys: `npx web-push generate-vapid-keys` → VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY, VAPID_SUBJECT = mailto:…
 * Without keys, sends are logged to the console. Dead subscriptions (404/410) are removed on the fly.
 */
export const pushOn = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
let configured = false;
function setup() {
    if (configured || !pushOn())
        return;
    webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:bonjour@monlucien.fr", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
    configured = true;
}
/** Sends to every device of the household. Returns the number of successful deliveries. */
export async function envoyerPush(db, household_id, m) {
    const subs = db.listPushSubscriptions(household_id);
    if (!pushOn()) {
        console.log(`[push ×${subs.length} → foyer ${household_id}] ${m.titre} — ${m.corps}`);
        return 0;
    }
    setup();
    let ok = 0;
    const payload = JSON.stringify({ title: m.titre, body: m.corps, url: m.url ?? "/#/notifs", tag: m.tag ?? "lucien", icon: "/icon-192.png", badge: "/icon-192.png" });
    for (const s of subs) {
        try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 86400, urgency: "normal" });
            ok++;
        }
        catch (e) {
            const code = e.statusCode;
            if (code === 404 || code === 410)
                db.deletePushSubscription(s.endpoint);
            else
                console.error("[push]", code, e.message);
        }
    }
    return ok;
}
