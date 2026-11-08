/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, matchPrecache } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Parameters<typeof precacheAndRoute>[0] };

// Offline shell (precached build) ; MCP is never cached, the API only partly (below).
cleanupOutdatedCaches();
// Le site vitrine (/site) et les pages publiques servies par le serveur ne doivent jamais être remplacés par l'appli.
// Pages: always the latest version from the server when online (an old copy kept by the phone must never be shown
// after an update); the copy kept on the phone is only used without network. Registered BEFORE the precache:
// Workbox takes the first matching route, and the precache would otherwise answer « / » with the old index.html.
registerRoute(new NavigationRoute(new NetworkFirst({
  cacheName: "lucien-pages", networkTimeoutSeconds: 6,
  plugins: [{ handlerDidError: async () => (await matchPrecache("index.html")) ?? Response.error() }],
}), { denylist: [/^\/api/, /^\/mcp/, /^\/site(\/|$)/, /^\/health/] }));
precacheAndRoute(self.__WB_MANIFEST);
// Offline, only what helps at a counter without network: the household, the list of papers (without their content),
// deadlines, family, week, folders. Never files, bank, budget, spaces, exports, accountant or elder-watch data.
// The page empties this cache at logout and when the account is deleted (api.ts).
const HORS_LIGNE = /^\/api\/(household|documents|documents\/[^/]+|deadlines|famille|semaine|charges|dossiers|rappels)$/;
registerRoute(({ url }) => HORS_LIGNE.test(url.pathname), new NetworkFirst({ cacheName: "lucien-api", networkTimeoutSeconds: 4 }), "GET");

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Web Push: payload { title, body, url, tag, icon, badge } sent by server/src/push.ts
self.addEventListener("push", (event) => {
  let data: { title?: string; body?: string; url?: string; tag?: string; icon?: string; badge?: string } = {};
  try { data = event.data?.json() ?? {}; } catch { data = { title: "Lucien", body: event.data?.text() ?? "" }; }
  event.waitUntil(
    self.registration.showNotification(data.title ?? "Lucien", {
      body: data.body ?? "",
      icon: data.icon ?? "/icon-192.png",
      badge: data.badge ?? "/icon-192.png",
      tag: data.tag ?? "lucien",
      data: { url: data.url ?? "/#/notifs" },
      lang: "fr",
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data as { url?: string } | undefined)?.url ?? "/#/notifs";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const target = new URL(url, self.location.origin).href;
      for (const c of list) { if ("focus" in c) { c.navigate(target); return c.focus(); } }
      return self.clients.openWindow(target);
    })
  );
});
