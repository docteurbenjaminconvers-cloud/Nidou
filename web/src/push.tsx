import { useEffect, useState } from "react";
import type { Api } from "./api";

/** Web Push subscription on this device (service worker + VAPID key from the server). */
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

export type PushEtat = "indisponible" | "serveur_sans_cle" | "refuse" | "inactif" | "actif" | "ios_non_installe";

export function usePush(api: Api) {
  const [etat, setEtat] = useState<PushEtat>("indisponible");
  const [busy, setBusy] = useState(false);
  const [cle, setCle] = useState<string | null>(null);

  const refresh = async () => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone);
      setEtat(ios ? "ios_non_installe" : "indisponible"); return;
    }
    try {
      const info = await api.pushCle();
      setCle(info.cle);
      if (!info.actif) { setEtat("serveur_sans_cle"); return; }
    } catch { setEtat("serveur_sans_cle"); return; }
    if (Notification.permission === "denied") { setEtat("refuse"); return; }
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    setEtat(sub ? "actif" : "inactif");
  };
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activer = async () => {
    if (!cle) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setEtat("refuse"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(cle) as BufferSource });
      const j = sub.toJSON();
      await api.pushAbonner({ endpoint: sub.endpoint, keys: { p256dh: j.keys!.p256dh, auth: j.keys!.auth }, appareil: navigator.userAgent.slice(0, 120) });
      setEtat("actif");
    } finally { setBusy(false); }
  };

  const desactiver = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) { await api.pushDesabonner(sub.endpoint); await sub.unsubscribe(); }
      setEtat("inactif");
    } finally { setBusy(false); }
  };

  return { etat, busy, activer, desactiver, tester: api.pushTest };
}

export function PushCard({ api, toast }: { api: Api; toast: (m: string) => void }) {
  const p = usePush(api);
  const TEXTE: Record<PushEtat, string> = {
    indisponible: "Ce navigateur ne prend pas en charge les notifications sur l'écran verrouillé.",
    ios_non_installe: "Sur iPhone, ajoutez d'abord Lucien à l'écran d'accueil (Partager → Sur l'écran d'accueil), puis revenez ici.",
    serveur_sans_cle: "Les notifications push seront activées à la mise en production (clés VAPID côté serveur).",
    refuse: "Les notifications sont bloquées pour Lucien dans les réglages du téléphone.",
    inactif: "Recevez vos rappels d'échéances et vos économies même quand l'appli est fermée.",
    actif: "Ce téléphone reçoit les rappels de Lucien.",
  };
  return (
    <div className="lock" style={{ marginTop: 12 }}>
      <b>Notifications sur ce téléphone</b>
      <p>{TEXTE[p.etat]}</p>
      {p.etat === "inactif" && <button className="btn" disabled={p.busy} onClick={p.activer}>{p.busy ? <span className="spinner" /> : "Activer les notifications"}</button>}
      {p.etat === "actif" && (
        <div style={{ display: "flex", gap: 14 }}>
          <button className="link" onClick={async () => { const r = await p.tester(); toast(r.envoyes ? "Notification envoyée" : "Aucun appareil joignable"); }}>Envoyer un test</button>
          <button className="link" style={{ color: "var(--mist)" }} disabled={p.busy} onClick={p.desactiver}>Désactiver</button>
        </div>
      )}
    </div>
  );
}
