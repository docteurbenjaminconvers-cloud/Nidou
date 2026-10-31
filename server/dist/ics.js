/**
 * Agenda au format iCalendar (.ics) : les échéances du foyer (journées entières, avec rappel) et les activités
 * hebdomadaires des enfants (récurrentes, heure de Paris). Fonction pure : le serveur publie un abonnement,
 * l'appli de démo fabrique le même fichier dans le navigateur.
 */
const RRULE_JOUR = ["", "MO", "TU", "WE", "TH", "FR", "SA", "SU"];
/** RFC 5545 text escaping and 75-octet line folding. */
const esc = (s) => s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
function plier(ligne) {
    const out = [];
    let cur = "", octets = 0;
    for (const ch of ligne) {
        const n = new TextEncoder().encode(ch).length;
        if (octets + n > (out.length ? 74 : 75)) {
            out.push(cur);
            cur = "";
            octets = 0;
        }
        cur += ch;
        octets += n;
    }
    out.push(cur);
    return out.join("\r\n ");
}
const compact = (iso) => iso.replace(/-/g, "");
const plusJour = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const horodatage = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
/** Next date (YYYY-MM-DD, from `today`) falling on ISO weekday `jour` (1 = Monday). */
function prochainJour(today, jour) {
    const j = ((new Date(today + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
    return plusJour(today, (jour - j + 7) % 7);
}
export function agendaIcs(e, now = new Date()) {
    const today = now.toISOString().slice(0, 10);
    const stamp = horodatage(now);
    const L = [
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lucien//Agenda de la famille//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        `X-WR-CALNAME:${esc(`Lucien · ${e.foyer.replace(/\s*\(démo\)$/, "")}`)}`, "X-WR-TIMEZONE:Europe/Paris", "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
        // Paris time zone (rules valid since 1996), so recurring activities stay at the right hour all year.
        "BEGIN:VTIMEZONE", "TZID:Europe/Paris",
        "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
        "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
        "END:VTIMEZONE",
    ];
    for (const d of e.echeances) {
        const desc = [d.note, e.lien ? `Dans Lucien : ${e.lien}` : null].filter(Boolean).join("\n\n");
        L.push("BEGIN:VEVENT", `UID:echeance-${d.id.replace(/[^\w.-]/g, "_")}@monlucien.fr`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${compact(d.date)}`, `DTEND;VALUE=DATE:${compact(plusJour(d.date, 1))}`, `SUMMARY:${esc(d.titre)}`, ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []), "TRANSP:TRANSPARENT", "CATEGORIES:Lucien");
        if (d.rappel_jours > 0)
            L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${esc(d.titre)}`, `TRIGGER:-P${d.rappel_jours}D`, "END:VALARM");
        L.push("END:VEVENT");
    }
    const hh = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const c of e.creneaux) {
        const h0 = c.heure_debut;
        if (!h0 || !hh.test(h0) || c.type === "cantine")
            continue; // only well-formed times reach the feed
        const debut = prochainJour(today, c.jour);
        const fin = (c.heure_fin && hh.test(c.heure_fin) ? c.heure_fin : null) ?? `${String(Math.min(23, Number(h0.slice(0, 2)) + 1)).padStart(2, "0")}${h0.slice(2)}`;
        const uid = `activite-${(c.activite_id ?? `${c.jour}-${h0}-${c.titre}`).replace(/[^\w.-]/g, "_")}@monlucien.fr`;
        L.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, `DTSTART;TZID=Europe/Paris:${compact(debut)}T${h0.replace(":", "")}00`, `DTEND;TZID=Europe/Paris:${compact(debut)}T${fin.replace(":", "")}00`, `RRULE:FREQ=WEEKLY;BYDAY=${RRULE_JOUR[c.jour]}`, `SUMMARY:${esc(`${c.titre}${c.membre ? ` · ${c.membre}` : ""}`)}`, ...(c.lieu ? [`LOCATION:${esc(c.lieu)}`] : []), "CATEGORIES:Lucien", "END:VEVENT");
    }
    L.push("END:VCALENDAR");
    return L.map(plier).join("\r\n") + "\r\n";
}
