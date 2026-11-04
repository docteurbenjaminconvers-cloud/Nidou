/* If the app's code cannot even start (an old or unusual browser), say so instead of leaving a blank page. */
window.__lucienErreur = function (m) {
  var r = document.getElementById("root");
  if (!r || r.childElementCount) return;
  r.innerHTML = '<div class="erreur-fatale" style="max-width:440px;margin:18vh auto 0;padding:24px;font-family:system-ui,sans-serif;color:#3a2a33"><h1 style="font-size:22px;margin:0 0 10px">Lucien n\'a pas pu s\'afficher</h1><p style="margin:0 0 14px;line-height:1.45">Rechargez la page. Si cela recommence, envoyez une capture de cet écran à l\'équipe Lucien.</p><button onclick="location.reload()" style="padding:12px 18px;border-radius:999px;border:0;background:#d9644a;color:#fff;font-size:16px">Recharger</button><pre style="margin-top:18px;white-space:pre-wrap;font-size:12px;color:#7a6470"></pre></div>';
  r.querySelector("pre").textContent = String(m) + "\n" + navigator.userAgent;
};
window.addEventListener("error", function (e) { setTimeout(function () { window.__lucienErreur((e.error && e.error.stack) || e.message || "erreur de chargement"); }, 0); });
setTimeout(function () { window.__lucienErreur("L'appli ne s'est pas lancée après 40 secondes."); }, 40000);
