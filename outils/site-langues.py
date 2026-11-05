#!/usr/bin/env python3
"""Génère une page par langue du site vitrine (en/, es/, it/, el/, ar/) à partir de index.html.

Chaque version est écrite directement dans la langue (textes, titre, description, aperçu de partage, données
structurées), pour que les moteurs de recherche et les aperçus de liens la lisent sans exécuter de script et que la page
ne « saute » pas au chargement ; i18n.js reste pour le menu des langues et les messages des formulaires.
À relancer après chaque modification de index.html :  python3 outils/site-langues.py site [demo-site]
"""
import json, re, subprocess, sys
from pathlib import Path

BASE = "https://monlucien.fr/"
LANGUES = {
    "en": ("Lucien, the butler for your paperwork and your budget", "en_GB", "ltr"),
    "es": ("Lucien, el mayordomo de sus papeles y su presupuesto", "es_ES", "ltr"),
    "it": ("Lucien, il maggiordomo dei suoi documenti e del suo budget", "it_IT", "ltr"),
    "el": ("Lucien, ο μπάτλερ των εγγράφων και του προϋπολογισμού σας", "el_GR", "ltr"),
    "ar": ("لوسيان، خادم أوراقك وميزانيتك", "ar_AR", "rtl"),
}

def descriptions(i18n: str) -> dict:
    out = {}
    for lang in LANGUES:
        m = re.search(r'\b%s: \{.*?_desc: ("(?:[^"\\]|\\.)*")' % lang, i18n, re.S)
        if m: out[lang] = json.loads(m.group(1))
    return out

VIDES = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}

# alt texts, aria labels and the few words written outside data-i18n, so that images and screen readers follow the page language
ATTRIBUTS = {
    "Lucien, accueil": {"en": "Lucien, home", "es": "Lucien, inicio", "it": "Lucien, home", "el": "Lucien, αρχική", "ar": "لوسيان، الصفحة الرئيسية"},
    "Langue": {"en": "Language", "es": "Idioma", "it": "Lingua", "el": "Γλώσσα", "ar": "اللغة"},
    "Aperçu de l'application Lucien": {"en": "Preview of the Lucien app", "es": "Vista previa de la aplicación Lucien", "it": "Anteprima dell'app Lucien", "el": "Προεπισκόπηση της εφαρμογής Lucien", "ar": "معاينة تطبيق لوسيان"},
    "Écran Lucien : 1 949 € d'économies faciles trouvées par an": {"en": "Lucien screen: €1,949 of easy savings found per year", "es": "Pantalla de Lucien: 1949 € de ahorro fácil encontrados al año", "it": "Schermata di Lucien: 1.949 € di risparmi facili trovati all'anno", "el": "Οθόνη Lucien: 1.949 € εύκολης εξοικονόμησης τον χρόνο", "ar": "شاشة لوسيان: 1949 يورو من التوفير السهل سنويًا"},
    "Visite de l'appli Lucien : l'accueil, les économies trouvées dans un relevé, l'agenda, les papiers": {"en": "Tour of the Lucien app: home, savings found in a statement, the calendar, the paperwork", "es": "Recorrido por la aplicación Lucien: inicio, ahorros encontrados en un extracto, la agenda, los papeles", "it": "Visita dell'app Lucien: home, risparmi trovati in un estratto conto, l'agenda, i documenti", "el": "Περιήγηση στην εφαρμογή Lucien: αρχική, εξοικονόμηση σε ένα αντίγραφο κίνησης, ημερολόγιο, έγγραφα", "ar": "جولة في تطبيق لوسيان: الصفحة الرئيسية، التوفير في كشف الحساب، التقويم، الأوراق"},
    "Mettre la vidéo en pause": {"en": "Pause the video", "es": "Pausar el vídeo", "it": "Metti in pausa il video", "el": "Παύση του βίντεο", "ar": "إيقاف الفيديو مؤقتًا"},
    "Écrans de l'application Lucien": {"en": "Screens of the Lucien app", "es": "Pantallas de la aplicación Lucien", "it": "Schermate dell'app Lucien", "el": "Οθόνες της εφαρμογής Lucien", "ar": "شاشات تطبيق لوسيان"},
    "Accueil de Lucien": {"en": "Lucien home screen", "es": "Inicio de Lucien", "it": "Home di Lucien", "el": "Αρχική οθόνη του Lucien", "ar": "الشاشة الرئيسية للوسيان"},
    "Agenda de Lucien": {"en": "Lucien calendar", "es": "Agenda de Lucien", "it": "Agenda di Lucien", "el": "Ημερολόγιο του Lucien", "ar": "تقويم لوسيان"},
    "Papiers rangés dans Lucien": {"en": "Paperwork filed in Lucien", "es": "Papeles ordenados en Lucien", "it": "Documenti archiviati in Lucien", "el": "Τακτοποιημένα έγγραφα στο Lucien", "ar": "أوراق مرتبة في لوسيان"},
    "La famille dans Lucien": {"en": "The family in Lucien", "es": "La familia en Lucien", "it": "La famiglia in Lucien", "el": "Η οικογένεια στο Lucien", "ar": "العائلة في لوسيان"},
    "La page de Léa dans Lucien": {"en": "Léa's page in Lucien", "es": "La página de Léa en Lucien", "it": "La pagina di Léa in Lucien", "el": "Η σελίδα της Léa στο Lucien", "ar": "صفحة ليا في لوسيان"},
    "Budget et économies dans Lucien": {"en": "Budget and savings in Lucien", "es": "Presupuesto y ahorro en Lucien", "it": "Budget e risparmi in Lucien", "el": "Προϋπολογισμός και εξοικονόμηση στο Lucien", "ar": "الميزانية والتوفير في لوسيان"},
    "La semaine de Lucien": {"en": "The week with Lucien", "es": "La semana con Lucien", "it": "La settimana con Lucien", "el": "Η εβδομάδα με τον Lucien", "ar": "الأسبوع مع لوسيان"},
    "Dossier de location préparé par Lucien": {"en": "Rental application prepared by Lucien", "es": "Expediente de alquiler preparado por Lucien", "it": "Dossier per l'affitto preparato da Lucien", "el": "Φάκελος ενοικίασης από τον Lucien", "ar": "ملف إيجار أعدّه لوسيان"},
    "Écran précédent": {"en": "Previous screen", "es": "Pantalla anterior", "it": "Schermata precedente", "el": "Προηγούμενη οθόνη", "ar": "الشاشة السابقة"},
    "Écran suivant": {"en": "Next screen", "es": "Pantalla siguiente", "it": "Schermata successiva", "el": "Επόμενη οθόνη", "ar": "الشاشة التالية"},
    "Espace Budget expert de Lucien": {"en": "Lucien's expert Budget space", "es": "Espacio Presupuesto experto de Lucien", "it": "Spazio Budget esperto di Lucien", "el": "Χώρος προχωρημένου προϋπολογισμού του Lucien", "ar": "مساحة الميزانية المتقدمة في لوسيان"},
    "Espace Vie pro de Lucien": {"en": "Lucien's Work space", "es": "Espacio Vida profesional de Lucien", "it": "Spazio Vita professionale di Lucien", "el": "Χώρος επαγγελματικής ζωής του Lucien", "ar": "مساحة الحياة المهنية في لوسيان"},
    "Espace Patrimoine locatif de Lucien": {"en": "Lucien's Rental property space", "es": "Espacio Patrimonio en alquiler de Lucien", "it": "Spazio Immobili in affitto di Lucien", "el": "Χώρος ενοικιαζόμενων ακινήτων του Lucien", "ar": "مساحة العقارات المؤجرة في لوسيان"},
    "Exemple d'économies repérées pour une famille": {"en": "Example of savings spotted for a family", "es": "Ejemplo de ahorros detectados para una familia", "it": "Esempio di risparmi individuati per una famiglia", "el": "Παράδειγμα εξοικονόμησης για μια οικογένεια", "ar": "مثال على توفير تم رصده لعائلة"},
    "Prix mensuel": {"en": "Monthly price", "es": "Precio mensual", "it": "Prezzo mensile", "el": "Μηνιαία τιμή", "ar": "السعر الشهري"},
    "Exemple de conversation avec un assistant connecté à Lucien": {"en": "Example conversation with an assistant connected to Lucien", "es": "Ejemplo de conversación con un asistente conectado a Lucien", "it": "Esempio di conversazione con un assistente collegato a Lucien", "el": "Παράδειγμα συνομιλίας με βοηθό συνδεδεμένο με τον Lucien", "ar": "مثال على محادثة مع مساعد متصل بلوسيان"},
    "Période de facturation": {"en": "Billing period", "es": "Periodo de facturación", "it": "Periodo di fatturazione", "el": "Περίοδος χρέωσης", "ar": "فترة الفوترة"},
    "Votre adresse email": {"en": "Your email address", "es": "Su dirección de correo", "it": "Il suo indirizzo email", "el": "Η διεύθυνση email σας", "ar": "بريدك الإلكتروني"},
    "Votre situation (facultatif)": {"en": "Your situation (optional)", "es": "Su situación (opcional)", "it": "La sua situazione (facoltativo)", "el": "Η κατάστασή σας (προαιρετικό)", "ar": "وضعك (اختياري)"},
}
TEXTES = {
    ">Guides pratiques<": {"en": ">Practical guides (in French)<", "es": ">Guías prácticas (en francés)<", "it": ">Guide pratiche (in francese)<", "el": ">Πρακτικοί οδηγοί (στα γαλλικά)<", "ar": ">أدلة عملية (بالفرنسية)<"},
    ">Guides pratiques : combien de temps garder ses papiers, résilier une assurance, dossier de location, déménagement →<": {"en": ">Practical guides, in French: how long to keep papers, cancelling insurance, rental applications, moving house →<", "es": ">Guías prácticas en francés: cuánto tiempo guardar los papeles, cancelar un seguro, expediente de alquiler, mudanza →<", "it": ">Guide pratiche in francese: per quanto conservare i documenti, disdire un'assicurazione, dossier per l'affitto, trasloco →<", "el": ">Πρακτικοί οδηγοί στα γαλλικά: πόσο κρατάμε τα έγγραφα, καταγγελία ασφάλισης, φάκελος ενοικίασης, μετακόμιση →<", "ar": ">أدلة عملية بالفرنسية: مدة الاحتفاظ بالأوراق، إلغاء التأمين، ملف الإيجار، الانتقال →<"},
    ">Vous pouvez aussi nous écrire : <": {"en": ">You can also write to us: <", "es": ">También puede escribirnos: <", "it": ">Può anche scriverci: <", "el": ">Μπορείτε επίσης να μας γράψετε: <", "ar": ">يمكنك أيضًا مراسلتنا: <"},
}

def attributs(html: str, lang: str) -> str:
    html = re.sub(r'\b(alt|aria-label)="([^"]+)"', lambda m: (lambda t: f'{m.group(1)}="{t[lang]}"' if t else m.group(0))(ATTRIBUTS.get(m.group(2))), html)
    for fr, tr in TEXTES.items(): html = html.replace(fr, tr[lang])
    return html

def dictionnaire(dossier: Path) -> dict:
    """The translations of i18n.js, read by Node (the file is a JavaScript object, not JSON)."""
    js = r"""const s=require("fs").readFileSync(process.argv[1],"utf8");const i=s.indexOf("window.LUCIEN_I18N");
const j=s.indexOf("\n};",i);const window={};eval(s.slice(i,j+3));process.stdout.write(JSON.stringify(window.LUCIEN_I18N));"""
    return json.loads(subprocess.run(["node", "-e", js, str(dossier / "i18n.js")], check=True, capture_output=True, text=True).stdout)

def fin_element(html: str, debut: int, tag: str) -> tuple:
    """(start of the inner content, start of the closing tag) of the element whose opening tag starts at `debut`."""
    ouv = html.index(">", debut) + 1
    prof, pos = 1, ouv
    motif = re.compile(r"<(/?)%s\b[^>]*>" % re.escape(tag), re.I)
    while prof:
        m = motif.search(html, pos)
        if not m: raise ValueError(f"<{tag}> sans fin à {debut}")
        prof += -1 if m.group(1) else 1
        pos = m.end()
    return ouv, m.start()

def prerendre(html: str, d: dict) -> str:
    """Puts each data-i18n text of the dictionary into the HTML, as i18n.js would in the browser."""
    morceaux, pos = [], 0
    for m in re.finditer(r'<([a-zA-Z][\w-]*)\b[^>]*\sdata-i18n="([^"]+)"[^>]*>', html):
        if m.start() < pos: continue  # inside an element already replaced
        tag, cle = m.group(1).lower(), m.group(2)
        if cle not in d or tag in VIDES: continue
        ouv, ferm = fin_element(html, m.start(), tag)
        morceaux += [html[pos:ouv], d[cle]]
        pos = ferm
    html = "".join(morceaux) + html[pos:]
    def ph(m):
        cle = re.search(r'data-i18n-ph="([^"]+)"', m.group(0)).group(1)
        if cle not in d: return m.group(0)
        return re.sub(r'placeholder="[^"]*"', 'placeholder="%s"' % d[cle].replace('"', "&quot;"), m.group(0))
    return re.sub(r'<[^>]*data-i18n-ph="[^"]+"[^>]*>', ph, html)

def texte(fragment: str) -> str:
    import html as h
    return re.sub(r"\s+", " ", h.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()

def donnees_structurees(html: str, url: str, description: str, langue: str) -> str:
    """Organisation, site, application and the page's questions, in the page's own language."""
    faq = [{"@type": "Question", "name": texte(q), "acceptedAnswer": {"@type": "Answer", "text": texte(r)}}
           for q, r in re.findall(r"<details><summary[^>]*>(.*?)</summary><p[^>]*>(.*?)</p>", html, re.S)]
    logo = BASE + "apple-touch-icon.png"
    graphe = [
        {"@type": "Organization", "@id": BASE + "#organisation", "name": "Lucien", "url": BASE, "logo": logo, "email": "bonjour@monlucien.fr"},
        {"@type": "WebSite", "@id": BASE + "#site", "name": "Lucien", "url": BASE, "inLanguage": ["fr", *LANGUES], "publisher": {"@id": BASE + "#organisation"}},
        {"@type": "SoftwareApplication", "name": "Lucien", "applicationCategory": "FinanceApplication", "operatingSystem": "Web, iOS, Android",
         "description": description, "url": url, "inLanguage": langue, "image": BASE + "img/partage.png", "publisher": {"@id": BASE + "#organisation"},
         "offers": {"@type": "Offer", "price": "6.90", "priceCurrency": "EUR"}},
    ]
    if faq: graphe.append({"@type": "FAQPage", "inLanguage": langue, "mainEntity": faq})
    bloc = json.dumps({"@context": "https://schema.org", "@graph": graphe}, ensure_ascii=False).replace("</", "<\\/")
    return re.sub(r'<script type="application/ld\+json">.*?</script>', lambda _m: f'<script type="application/ld+json">{bloc}</script>', html, count=1, flags=re.S)

def meta(html: str, attr: str, nom: str, valeur: str) -> str:
    v = valeur.replace("&", "&amp;").replace('"', "&quot;")
    return re.sub(r'<meta %s="%s" content="[^"]*">' % (attr, re.escape(nom)), lambda _m: f'<meta {attr}="{nom}" content="{v}">', html, count=1)

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
    desc_fr = re.search(r'<meta name="description" content="([^"]*)">', racine).group(1)
    racine = donnees_structurees(racine, BASE, texte(desc_fr), "fr")
    (dossier / "index.html").write_text(racine)
    dico = dictionnaire(dossier)
    for lang, (titre, locale, sens) in LANGUES.items():
        s = attributs(prerendre(racine, dico[lang]), lang)
        if lang in desc:
            s = donnees_structurees(s, f"{BASE}{lang}/", desc[lang], lang)
            for a, n, v in (("property", "og:title", titre), ("property", "og:description", desc[lang]), ("name", "twitter:title", titre), ("name", "twitter:description", desc[lang])):
                s = meta(s, a, n, v)
        # local files are one folder up
        s = re.sub(r'((?:src|href|poster)=")(?!https?:|#|/|mailto:|data:|\.\./)([^"]+)"', r'\1../\2"', s)
        s = s.replace('<html lang="fr">', f'<html lang="{lang}" dir="{sens}">', 1)
        s = re.sub(r"<title>.*?</title>", f"<title>{titre}</title>", s, count=1)
        if lang in desc:
            s = re.sub(r'<meta name="description" content="[^"]*">', '<meta name="description" content="%s">' % desc[lang].replace('"', "&quot;"), s, count=1)
        s = s.replace('<link rel="canonical" href="https://monlucien.fr/">', f'<link rel="canonical" href="{BASE}{lang}/">', 1)
        s = s.replace('<meta property="og:url" content="https://monlucien.fr/">', f'<meta property="og:url" content="{BASE}{lang}/">', 1)
        s = s.replace('<meta property="og:locale" content="fr_FR">', f'<meta property="og:locale" content="{locale}">', 1)
        s = s.replace('<script src="../i18n.js"></script>', f'<script>window.LUCIEN_LANG_PAGE = "{lang}"; window.LUCIEN_PRERENDU = true;</script>\n<script src="../i18n.js"></script>', 1)
        (dossier / lang).mkdir(exist_ok=True)
        (dossier / lang / "index.html").write_text(s)
    # sitemap with the language versions
    urls = [("", 1.0)] + [(f"{l}/", 0.9) for l in LANGUES]
    alt = "".join(f'\n    <xhtml:link rel="alternate" hreflang="{h}" href="{BASE}{p}"/>' for h, p in [("fr", "")] + [(l, f"{l}/") for l in LANGUES])
    corps = "".join(f"\n  <url><loc>{BASE}{u}</loc><priority>{p}</priority>{alt}\n  </url>" for u, p in urls)
    corps += f"\n  <url><loc>{BASE}mentions-legales.html</loc><priority>0.2</priority></url>\n  <url><loc>{BASE}confidentialite.html</loc><priority>0.2</priority></url>\n  <url><loc>{BASE}cgu.html</loc><priority>0.2</priority></url>\n  <url><loc>{BASE}cgv.html</loc><priority>0.2</priority></url>"
    guides = sorted(p.parent.relative_to(dossier).as_posix() + "/" for p in (dossier / "guides").glob("**/index.html")) if (dossier / "guides").exists() else []
    for g in guides:
        m = re.search(r'"dateModified": "([0-9-]+)"', (dossier / g / "index.html").read_text())
        corps += f"\n  <url><loc>{BASE}{g}</loc>" + (f"<lastmod>{m.group(1)}</lastmod>" if m else "") + f"<priority>{0.8 if g == 'guides/' else 0.7}</priority></url>"
    (dossier / "sitemap.xml").write_text(f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">{corps}\n</urlset>\n')
    print(f"{dossier} : pages {', '.join(LANGUES)} générées")

for d in sys.argv[1:] or ["site"]:
    generer(Path(d))
