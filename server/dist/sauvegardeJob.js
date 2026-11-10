/**
 * The daily backup, as one function: a consistent snapshot of the database (VACUUM INTO, the service keeps running),
 * the household's files and the coffre's disk key, in one archive encrypted with LUCIEN_SAUVEGARDE_CLE, kept on the
 * disk (a few copies) and sent off the server (LUCIEN_S3_*). Used by scripts/sauvegarde.mjs (a VPS with cron) and by
 * the server itself (`planifierSauvegardes`, for hosts without cron such as Render).
 */
import { DatabaseSync } from "node:sqlite";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { chiffrer, envoyerS3, s3Config, tar } from "./sauvegarde.js";
export async function faireSauvegarde(o) {
    const out = o.out ?? join(o.data, "sauvegardes");
    const cle = o.cle ?? "";
    const garder = o.garder ?? 14;
    const stamp = (o.maintenant ?? new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const dir = join(out, stamp);
    mkdirSync(dir, { recursive: true });
    if (!cle && o.s3) {
        rmSync(dir, { recursive: true, force: true });
        throw new Error("LUCIEN_S3_* est réglé mais pas LUCIEN_SAUVEGARDE_CLE : rien n'est envoyé hors du serveur sans chiffrement.");
    }
    let res;
    try {
        // 1. consistent snapshot
        const base = existsSync(join(o.data, "lucien.sqlite")) ? "lucien.sqlite" : "nidou.sqlite";
        const db = new DatabaseSync(join(o.data, base));
        try {
            db.exec(`VACUUM INTO '${join(dir, "lucien.sqlite").replace(/'/g, "''")}'`);
        }
        finally {
            db.close();
        }
        if (existsSync(join(o.data, "uploads")))
            cpSync(join(o.data, "uploads"), join(dir, "uploads"), { recursive: true });
        // the coffre's disk key: without it the files encrypted with it could not be read after a restore
        // (only inside the encrypted archive: never copied in clear next to a clear backup)
        if (cle && existsSync(join(o.data, "cle-coffre")))
            cpSync(join(o.data, "cle-coffre"), join(dir, "cle-coffre"));
        // 2. encrypted archive, then off the server
        if (cle) {
            const fichiers = [];
            const parcourir = (d) => { for (const n of readdirSync(d)) {
                const p = join(d, n);
                if (statSync(p).isDirectory())
                    parcourir(p);
                else
                    fichiers.push({ nom: relative(dir, p), contenu: readFileSync(p) });
            } };
            parcourir(dir);
            const archive = chiffrer(tar(fichiers), cle);
            const nom = `${stamp}.lucienbk`;
            writeFileSync(join(out, nom), archive);
            rmSync(dir, { recursive: true, force: true }); // no clear copy left on the server
            let envoyee = null;
            if (o.s3) {
                await envoyerS3(o.s3, `lucien/${nom}`, archive, o.fetchImpl);
                envoyee = `${o.s3.bucket}/lucien/${nom}`;
            }
            res = { nom, octets: archive.length, chiffree: true, envoyee, gardees: 0 };
        }
        else {
            res = { nom: stamp, octets: 0, chiffree: false, envoyee: null, gardees: 0 };
        }
    }
    catch (e) {
        rmSync(dir, { recursive: true, force: true });
        throw e;
    }
    // 3. the last ones stay on the server
    const anciennes = readdirSync(out).filter((n) => /^\d{4}-/.test(n)).sort();
    for (const n of anciennes.slice(0, Math.max(0, anciennes.length - garder)))
        rmSync(join(out, n), { recursive: true, force: true });
    res.gardees = Math.min(anciennes.length, garder);
    return res;
}
/** When the last backup on the disk was made (from its name), or null. */
export function derniereSauvegarde(out) {
    if (!existsSync(out))
        return null;
    const n = readdirSync(out).filter((x) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/.test(x)).sort().pop();
    if (!n)
        return null;
    const d = new Date(n.slice(0, 19).replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3") + "Z");
    return isNaN(d.getTime()) ? null : d;
}
/**
 * For hosts without cron (Render): one encrypted backup a day, made by the server itself — a few minutes after
 * start-up if the last one is older than 22 h, then checked every hour. Does nothing without LUCIEN_SAUVEGARDE_CLE
 * (no clear copy of everyone's papers on a small disk), and says so once in the journal.
 */
export function planifierSauvegardes(data) {
    const cle = process.env.LUCIEN_SAUVEGARDE_CLE ?? "";
    if (process.env.LUCIEN_SAUVEGARDE_AUTO === "0")
        return () => { };
    if (cle.length < 20) {
        console.warn("[sauvegarde] aucune sauvegarde automatique : réglez LUCIEN_SAUVEGARDE_CLE (20 caractères au moins) et LUCIEN_S3_* pour une copie chiffrée chaque jour hors du serveur.");
        return () => { };
    }
    const out = join(data, "sauvegardes");
    let enCours = false;
    const tick = async () => {
        if (enCours)
            return;
        const d = derniereSauvegarde(out);
        if (d && Date.now() - d.getTime() < 22 * 3600_000)
            return;
        enCours = true;
        try {
            const s3 = s3Config();
            const r = await faireSauvegarde({ data, cle, s3, garder: Number(process.env.LUCIEN_SAUVEGARDES_GARDER ?? 3) });
            console.log(`[sauvegarde] ${r.nom} faite, chiffrée (${(r.octets / 1e6).toFixed(1)} Mo) · ${r.envoyee ? `envoyée hors du serveur : ${r.envoyee}` : "PAS envoyée hors du serveur (réglez LUCIEN_S3_*)"} · ${r.gardees} gardée(s) sur le serveur`);
        }
        catch (e) {
            console.error(`[sauvegarde] ÉCHEC : ${e.message}`);
        }
        finally {
            enCours = false;
        }
    };
    const premier = setTimeout(tick, 90_000);
    const t = setInterval(tick, 3600_000);
    premier.unref?.();
    t.unref?.();
    return () => { clearTimeout(premier); clearInterval(t); };
}
