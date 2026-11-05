/* If the app's code cannot even start (an old or unusual browser), say so instead of leaving a blank page. */
window.__lucienErreur = function (m) {
  var r = document.getElementById("root");
  if (!r || r.childElementCount) return;
  r.innerHTML = '<div class="erreur-fatale" style="max-width:440px;margin:18vh auto 0;padding:24px;font-family:system-ui,sans-serif;color:#3a2a33"><h1 style="font-size:22px;margin:0 0 10px">Lucien n\'a pas pu s\'afficher</h1><p style="margin:0 0 14px;line-height:1.45">Rechargez la page. Si cela recommence, envoyez une capture de cet écran à l\'équipe Lucien.</p><button onclick="location.reload()" style="padding:12px 18px;border-radius:999px;border:0;background:#d9644a;color:#fff;font-size:16px">Recharger</button><pre style="margin-top:18px;white-space:pre-wrap;font-size:12px;color:#7a6470"></pre></div>';
  r.querySelector("pre").textContent = String(m) + "\n" + navigator.userAgent;
};
window.addEventListener("error", function (e) { setTimeout(function () { window.__lucienErreur((e.error && e.error.stack) || e.message || "erreur de chargement"); }, 0); });
setTimeout(function () { window.__lucienErreur("L'appli ne s'est pas lancée après 40 secondes."); }, 40000);

/* Diagnostics sent to the server log (never the page's text): what went wrong when the app could not show itself. */
window.__lucienDiag = function (quoi) {
  try {
    var r = document.getElementById("root");
    fetch("/api/diagnostic", { method: "POST", headers: { "content-type": "text/plain" }, keepalive: true,
      body: JSON.stringify({ garde: quoi, enfants: r ? r.childElementCount : null, route: location.hash.split("?")[0].slice(0, 40), ua: navigator.userAgent, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller) }) }).catch(function () {});
  } catch (e) {}
};
window.addEventListener("error", function (e) { window.__lucienDiag("erreur: " + String((e.error && (e.error.name + ": " + e.error.message + " @ " + String(e.error.stack || "").split("\n").slice(0, 3).join(" | "))) || e.message || "chargement").slice(0, 600)); });
setTimeout(function () { var r = document.getElementById("root"); if (!r || !r.childElementCount) window.__lucienDiag("rien d'affiché après 8 s"); }, 8000);
