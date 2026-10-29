import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

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
