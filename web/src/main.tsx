import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// Ancien nom (Nidou) : les préférences gardées sur le téléphone (email, nom, langue…) passent sous le nouveau nom.
try {
  for (const k of Object.keys(localStorage)) {
    if (!k.startsWith("nidou.")) continue;
    const nouvelle = "lucien." + k.slice("nidou.".length);
    if (localStorage.getItem(nouvelle) === null) localStorage.setItem(nouvelle, localStorage.getItem(k)!);
    localStorage.removeItem(k);
  }
} catch {}

// A link shared by a partner accountant: ...?partenaire=CODE (before or after the #), kept until the household is logged in.
try {
  const code = new URLSearchParams(location.search).get("partenaire") ?? new URLSearchParams(location.hash.split("?")[1] ?? "").get("partenaire");
  if (code && /^[A-Za-z0-9-]{4,20}$/.test(code)) localStorage.setItem("lucien.partenaire", code.toUpperCase());
} catch {}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Rangées de pastilles qui défilent (catégories, situation…) : la pastille touchée vient au centre, dans les deux sens.
document.addEventListener("click", (e) => {
  const pill = (e.target as HTMLElement | null)?.closest?.(".pills .pill") as HTMLElement | null;
  if (!pill) return;
  const row = pill.parentElement!;
  if (row.scrollWidth <= row.clientWidth) return;
  const target = pill.offsetLeft - row.offsetLeft - (row.clientWidth - pill.offsetWidth) / 2;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  row.scrollTo({ left: Math.max(0, target), behavior: reduce ? "auto" : "smooth" });
});
