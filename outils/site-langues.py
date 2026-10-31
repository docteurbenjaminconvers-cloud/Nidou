#!/usr/bin/env python3
"""Génère une page par langue du site vitrine (en/, es/, it/, ar/) à partir de index.html.

La page reste la même (le texte est traduit par i18n.js) ; chaque version a sa propre adresse, son titre, sa
description, sa langue déclarée et les liens hreflang, pour que les moteurs de recherche référencent chaque langue.
À relancer après chaque modification de index.html :  python3 outils/site-langues.py site [demo-site]
"""
import json, re, sys
from pathlib import Path

BASE = "https://monlucien.fr/"
LANGUES = {
    "en": ("Lucien, the butler for your paperwork and your budget", "en_GB", "ltr"),
    "es": ("Lucien, el mayordomo de sus papeles y su presupuesto", "es_ES", "ltr"),
    "it": ("Lucien, il maggiordomo dei suoi documenti e del suo budget", "it_IT", "ltr"),
    "ar": ("لوسيان، خادم أوراقك وميزانيتك", "ar_AR", "rtl"),
}

def descriptions(i18n: str) -> dict:
    out = {}
    for lang in LANGUES:
        m = re.search(r'\b%s: \{.*?_desc: ("(?:[^"\\]|\\.)*")' % lang, i18n, re.S)
        if m: out[lang] = json.loads(m.group(1))
    return out

def alternates() -> str:
    liens = [f'<link rel="alternate" hreflang="fr" href="{BASE}">'] + [f'<link rel="alternate" hreflang="{l}" href="{BASE}{l}/">' for l in LANGUES]
    liens.append(f'<link rel="alternate" hreflang="x-default" href="{BASE}">')
    return "\n".join(liens)

def generer(dossier: Path):
    src = (dossier / "index.html").read_text()
    desc = descriptions((dossier / "i18n.js").read_text())
    # the French page gets its alternates once
    racine = re.sub(r'\n?<link rel="alternate" hreflang[^>]*>', "", src)
    racine = racine.replace('<link rel="canonical" href="https://monlucien.fr/">', '<link rel="canonical" href="https://monlucien.fr/">\n' + alternates())
    (dossier / "index.html").write_text(racine)
    for lang, (titre, locale, sens) in LANGUES.items():
        s = racine
        # local files are one folder up
        s = re.sub(r'((?:src|href|poster)=")(?!https?:|#|/|mailto:|data:|\.\./)([^"]+)"', r'\1../\2"', s)
        s = s.replace('<html lang="fr">', f'<html lang="{lang}" dir="{sens}">', 1)
        s = re.sub(r"<title>.*?</title>", f"<title>{titre}</title>", s, count=1)
        if lang in desc:
            s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % desc[lang].replace('"', "&quot;"), s, count=1)
        s = s.replace('<link rel="canonical" href="https://monlucien.fr/">', f'<link rel="canonical" href="{BASE}{lang}/">', 1)
        s = s.replace('<meta property="og:url" content="https://monlucien.fr/">', f'<meta property="og:url" content="{BASE}{lang}/">', 1)
        s = s.replace('<meta property="og:locale" content="fr_FR">', f'<meta property="og:locale" content="{locale}">', 1)
        s = s.replace('<script src="../i18n.js"></script>', f'<script>window.LUCIEN_LANG_PAGE = "{lang}";</script>\n<script src="../i18n.js"></script>', 1)
        (dossier / lang).mkdir(exist_ok=True)
        (dossier / lang / "index.html").write_text(s)
    # sitemap with the language versions
    urls = [("", 1.0)] + [(f"{l}/", 0.9) for l in LANGUES]
    alt = "".join(f'\n    <xhtml:link rel="alternate" hreflang="{h}" href="{BASE}{p}"/>' for h, p in [("fr", "")] + [(l, f"{l}/") for l in LANGUES])
    corps = "".join(f"\n  <url><loc>{BASE}{u}</loc><priority>{p}</priority>{alt}\n  </url>" for u, p in urls)
    corps += f"\n  <url><loc>{BASE}mentions-legales.html</loc><priority>0.2</priority></url>\n  <url><loc>{BASE}confidentialite.html</loc><priority>0.2</priority></url>"
    (dossier / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">{corps}\n</urlset>\n')
    print(f"{dossier} : pages {', '.join(LANGUES)} générées")

for d in sys.argv[1:] or ["site"]:
    generer(Path(d))
