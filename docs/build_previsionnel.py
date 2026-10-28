"""Builds docs/Nidou-previsionnel.xlsx : hypothèses éditables + compte de résultat mensuel par palier d'abonnés."""
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.comments import Comment
from openpyxl.utils import get_column_letter

wb = Workbook()
FONT = "Arial"
BLUE, BLACK, GREEN = Font(name=FONT, color="0000FF"), Font(name=FONT), Font(name=FONT, color="008000")
BOLD = Font(name=FONT, bold=True)
H = Font(name=FONT, bold=True, size=13)
YELLOW = PatternFill("solid", fgColor="FFFF00")
GREY = PatternFill("solid", fgColor="EEEEEE")
THIN = Border(bottom=Side(style="thin", color="999999"))
EUR = '#,##0 €;(#,##0 €);-'
EUR2 = '#,##0.00 €;(#,##0.00 €);-'
PCT = '0.0%;(0.0%);-'
INT = '#,##0;(#,##0);-'

# ---------------- Hypothèses ----------------
hy = wb.active
hy.title = "Hypothèses"
hy.column_dimensions["A"].width = 58
hy.column_dimensions["B"].width = 16
hy.column_dimensions["C"].width = 70
hy["A1"] = "Nidou — hypothèses du prévisionnel"; hy["A1"].font = H
hy["A2"] = "Cellules en bleu sur fond jaune : à modifier librement. Tout le reste se recalcule."; hy["A2"].font = Font(name=FONT, italic=True)

rows = [
    ("REVENUS", None, None, None),
    ("Prix mensuel TTC (€)", 9.9, EUR2, "Plan Famille, décision du 28/10/2026"),
    ("Prix annuel TTC (€)", 99, EUR2, "Plan Famille, décision du 28/10/2026"),
    ("Part des abonnés en formule annuelle", 0.5, PCT, "Hypothèse : moitié mensuel, moitié annuel"),
    ("TVA", 0.20, PCT, "Service numérique en France : 20 %"),
    ("Commission moyenne de paiement (Stripe), % du TTC", 0.015, PCT, "Cartes européennes ≈ 1,5 % + 0,25 € ; les stores (Apple/Google) prendraient 15 à 30 % : à éviter, paiement web"),
    ("Frais fixes par transaction (€)", 0.25, EUR2, "Stripe, par paiement ; un abonné annuel paie 1 fois par an, un mensuel 12 fois"),
    ("Utilisateurs gratuits par abonné payant", 8, INT, "Hypothèse de conversion ≈ 11 % (1 payant pour 9 comptes). À vérifier après lancement"),
    ("Churn mensuel des abonnés", 0.03, PCT, "3 % par mois : ordre de grandeur des applis grand public bien notées"),
    ("COÛTS VARIABLES (par foyer et par mois)", None, None, None),
    ("IA — extraction de documents, foyer payant (€)", 0.05, EUR2, "≈ 5 documents/mois : modèle rapide (Haiku ≈ 0,5 c) avec repli sur le modèle précis (Sonnet ≈ 2 c) pour 15 % des documents, + catégorisation bancaire + courriers"),
    ("IA — foyer gratuit (€)", 0.0, EUR2, "Gratuit nu : lecture locale sans IA, pas d'import de relevés ni de banque. 0 € d'IA (NIDOU_IA_LECTURES_GRATUIT=0 ; un quota rouvrable plus tard reste plafonné par NIDOU_IA_PLAFOND_GRATUIT_EUR)"),
    ("Agrégation bancaire Bridge, par compte connecté (€)", 1.0, EUR2, "Tarif public indicatif 0,5 à 2 € par compte et par mois ; à négocier au volume"),
    ("Part des abonnés qui connectent leur banque", 0.6, PCT, "Hypothèse"),
    ("Nombre de comptes connectés par foyer connecté", 1.3, '0.0', "Compte joint + un compte perso"),
    ("Stockage et bande passante, tous foyers (€)", 0.01, EUR2, "OVH Object Storage ≈ 0,01 €/Go ; 50 documents × 2 Mo = 0,1 Go par foyer"),
    ("Emails et notifications push (€)", 0.02, EUR2, "Payants : push + email (Brevo). Gratuits : push seulement, donc ≈ 0 ; la moyenne tous foyers est surestimée ici par prudence"),
    ("Coût d'acquisition d'un abonné payant (€)", 20, EUR2, "Mix parrainage + publicité (15 €) + le coût de l'essai inversé des inscrits non convertis (≈ 5 € par payant gagné, voir onglet Lancement) ; dépensé pour remplacer le churn"),
    ("COÛTS FIXES PAR PALIER (€ / mois)", None, None, None),
]
r = 4
ref = {}
for label, val, fmt, note in rows:
    hy.cell(r, 1, label)
    if val is None:
        hy.cell(r, 1).font = BOLD; hy.cell(r, 1).fill = GREY
    else:
        c = hy.cell(r, 2, val); c.font = BLUE; c.fill = YELLOW; c.number_format = fmt
        hy.cell(r, 3, note).font = Font(name=FONT, size=9, color="555555")
        ref[label] = f"Hypothèses!$B${r}"
    r += 1

# Fixed costs per tier: a small table
tiers = [1000, 5000, 20000, 100000, 500000]
tier_row = r
hy.cell(r, 1, "Abonnés payants (palier)").font = BOLD
for j, t in enumerate(tiers):
    c = hy.cell(r, 2 + j, t); c.font = BLUE; c.fill = YELLOW; c.number_format = INT
    hy.column_dimensions[get_column_letter(2 + j)].width = 16
r += 1
fixed = [
    ("Hébergement OVH (serveurs, base, sauvegardes)", [60, 180, 600, 2500, 9000], "VPS puis instances Public Cloud + base managée ; France"),
    ("Équipe technique (salaires chargés)", [0, 6000, 18000, 60000, 180000], "0 : fondateur + Claude ; puis 1, 3, 10, 30 personnes à 6 000 € chargés"),
    ("Support client", [0, 2000, 7000, 28000, 100000], "0,5 puis 2, 8, 30 personnes à 3 500 € chargés ; 1 agent pour ~2 500 à 5 000 payants"),
    ("Juridique, comptable, assurance, banque", [500, 1000, 2500, 8000, 20000], "Expert-comptable, RGPD, CGV, RC pro"),
    ("Outils et licences (Stripe hors commissions, Brevo, monitoring, domaine)", [100, 300, 800, 3000, 8000], ""),
    ("Marketing de marque (hors acquisition payante)", [500, 2000, 8000, 40000, 150000], "Contenu, RP, partenariats"),
]
fixed_rows = {}
for label, vals, note in fixed:
    hy.cell(r, 1, label)
    for j, v in enumerate(vals):
        c = hy.cell(r, 2 + j, v); c.font = BLUE; c.fill = YELLOW; c.number_format = EUR
    hy.cell(r, 8, note).font = Font(name=FONT, size=9, color="555555")
    fixed_rows[label] = r
    r += 1
hy.column_dimensions["H"].width = 60
hy.cell(r + 1, 1, "Sources : prix Stripe et Bridge d'après leurs grilles publiques (ordres de grandeur, à confirmer par devis) ; coûts IA estimés d'après la consommation du prototype ; salaires chargés France. Tous les autres chiffres sont des hypothèses de travail.").font = Font(name=FONT, size=9, italic=True)
for row in hy.iter_rows(min_row=1, max_row=r + 1):
    for c in row:
        if c.font.name != FONT: c.font = Font(name=FONT, bold=c.font.bold, italic=c.font.italic, size=c.font.size or 11, color=c.font.color)

# ---------------- Prévisionnel ----------------
pv = wb.create_sheet("Prévisionnel")
pv.column_dimensions["A"].width = 52
for j in range(len(tiers)): pv.column_dimensions[get_column_letter(2 + j)].width = 18
pv["A1"] = "Nidou — compte de résultat mensuel par palier d'abonnés payants"; pv["A1"].font = H
pv["A2"] = "Régime de croisière à chaque palier (hors phase de lancement). Montants hors taxes, par mois."; pv["A2"].font = Font(name=FONT, italic=True)

def L(j): return get_column_letter(2 + j)
R = ref
def put(row, label, formula_fn, fmt=EUR, bold=False, font=BLACK):
    pv.cell(row, 1, label).font = BOLD if bold else Font(name=FONT)
    for j in range(len(tiers)):
        c = pv.cell(row, 2 + j, formula_fn(j)); c.number_format = fmt; c.font = Font(name=FONT, bold=bold, color=font.color)

row = 4
pv.cell(row, 1, "Abonnés payants").font = BOLD
for j in range(len(tiers)):
    c = pv.cell(row, 2 + j, f"=Hypothèses!{L(j)}${tier_row}"); c.font = GREEN; c.number_format = INT; c.font = Font(name=FONT, bold=True, color="008000")
SUBS = row; row += 1
put(row, "Comptes gratuits", lambda j: f"={L(j)}{SUBS}*{R['Utilisateurs gratuits par abonné payant']}", INT); FREE = row; row += 1
put(row, "Foyers au total", lambda j: f"={L(j)}{SUBS}+{L(j)}{FREE}", INT); TOTAL = row; row += 2

pv.cell(row, 1, "REVENUS").font = BOLD; pv.cell(row, 1).fill = GREY; row += 1
put(row, "Revenu TTC moyen par abonné et par mois", lambda j: f"=({R['Prix mensuel TTC (€)']}*(1-{R['Part des abonnés en formule annuelle']})+{R['Prix annuel TTC (€)']}/12*{R['Part des abonnés en formule annuelle']})", EUR2); ARPU = row; row += 1
put(row, "Chiffre d'affaires TTC", lambda j: f"={L(j)}{SUBS}*{L(j)}{ARPU}"); CATTC = row; row += 1
put(row, "TVA collectée", lambda j: f"=-{L(j)}{CATTC}*{R['TVA']}/(1+{R['TVA']})"); TVA = row; row += 1
put(row, "Chiffre d'affaires HT", lambda j: f"={L(j)}{CATTC}+{L(j)}{TVA}", bold=True); CAHT = row; row += 1
put(row, "Commissions de paiement", lambda j: f"=-({L(j)}{CATTC}*{R['Commission moyenne de paiement (Stripe), % du TTC']}+{L(j)}{SUBS}*((1-{R['Part des abonnés en formule annuelle']})*1+{R['Part des abonnés en formule annuelle']}/12)*{R['Frais fixes par transaction (€)']})"); STRIPE = row; row += 1
put(row, "Revenu net encaissé", lambda j: f"={L(j)}{CAHT}+{L(j)}{STRIPE}", bold=True); NET = row; row += 2

pv.cell(row, 1, "COÛTS VARIABLES").font = BOLD; pv.cell(row, 1).fill = GREY; row += 1
put(row, "IA (extraction, catégorisation, courriers)", lambda j: f"=-({L(j)}{SUBS}*{R['IA — extraction de documents, foyer payant (€)']}+{L(j)}{FREE}*{R['IA — foyer gratuit (€)']})"); IA = row; row += 1
put(row, "Agrégation bancaire (Bridge)", lambda j: f"=-{L(j)}{SUBS}*{R['Part des abonnés qui connectent leur banque']}*{R['Nombre de comptes connectés par foyer connecté']}*{R['Agrégation bancaire Bridge, par compte connecté (€)']}"); BR = row; row += 1
put(row, "Stockage, emails, notifications", lambda j: f"=-{L(j)}{TOTAL}*({R['Stockage et bande passante, tous foyers (€)']}+{R['Emails et notifications push (€)']})"); ST = row; row += 1
CAC = R["Coût d'acquisition d'un abonné payant (€)"]
put(row, "Acquisition pour remplacer le churn", lambda j: f"=-{L(j)}{SUBS}*{R['Churn mensuel des abonnés']}*{CAC}"); ACQ = row; row += 1
put(row, "Total coûts variables", lambda j: f"=SUM({L(j)}{IA}:{L(j)}{ACQ})", bold=True); VAR = row; row += 1
put(row, "Marge sur coûts variables", lambda j: f"={L(j)}{NET}+{L(j)}{VAR}", bold=True); MCV = row; row += 1
put(row, "Marge sur coûts variables, % du CA HT", lambda j: f"=IF({L(j)}{CAHT}=0,0,{L(j)}{MCV}/{L(j)}{CAHT})", PCT); row += 2

pv.cell(row, 1, "COÛTS FIXES").font = BOLD; pv.cell(row, 1).fill = GREY; row += 1
first_fixed = row
for label, _, _ in fixed:
    fr = fixed_rows[label]
    put(row, label, lambda j, fr=fr: f"=-Hypothèses!{L(j)}${fr}", font=GREEN); row += 1
put(row, "Total coûts fixes", lambda j: f"=SUM({L(j)}{first_fixed}:{L(j)}{row-1})", bold=True); FIX = row; row += 2

put(row, "RÉSULTAT MENSUEL (avant impôt)", lambda j: f"={L(j)}{MCV}+{L(j)}{FIX}", bold=True); RES = row
for j in range(len(tiers)): pv.cell(row, 2 + j).fill = YELLOW
row += 1
put(row, "Résultat annuel (×12)", lambda j: f"={L(j)}{RES}*12", bold=True); row += 1
put(row, "Marge nette, % du CA HT", lambda j: f"=IF({L(j)}{CAHT}=0,0,{L(j)}{RES}/{L(j)}{CAHT})", PCT); row += 2

pv.cell(row, 1, "REPÈRES").font = BOLD; pv.cell(row, 1).fill = GREY; row += 1
put(row, "Revenu net par abonné et par mois", lambda j: f"=IF({L(j)}{SUBS}=0,0,{L(j)}{NET}/{L(j)}{SUBS})", EUR2); row += 1
put(row, "Coût variable par abonné et par mois", lambda j: f"=IF({L(j)}{SUBS}=0,0,-{L(j)}{VAR}/{L(j)}{SUBS})", EUR2); row += 1
put(row, "Abonnés payants nécessaires pour couvrir les coûts fixes du palier", lambda j: f"=IF({L(j)}{MCV}=0,0,ROUNDUP(-{L(j)}{FIX}/({L(j)}{MCV}/{L(j)}{SUBS}),0))", INT); row += 1
put(row, "Chiffre d'affaires annuel HT", lambda j: f"={L(j)}{CAHT}*12"); row += 1
put(row, "Valeur d'un abonné sur sa durée de vie (revenu net / churn)", lambda j: f"=IF({R['Churn mensuel des abonnés']}=0,0,{L(j)}{NET}/{L(j)}{SUBS}/{R['Churn mensuel des abonnés']})", EUR); row += 2
pv.cell(row, 1, "Lecture : chaque colonne est un palier atteint, en régime stable. Les coûts fixes par palier sont des choix d'organisation (équipe, support) ; les faire varier dans l'onglet Hypothèses déplace immédiatement le seuil de rentabilité.").font = Font(name=FONT, size=9, italic=True)
pv.freeze_panes = "B4"
for rr in pv.iter_rows(min_row=3, max_row=row):
    for c in rr:
        if c.font.name != FONT: c.font = Font(name=FONT, bold=c.font.bold, color=c.font.color)

# L'onglet Scénarios est ajouté séparément (valeurs figées) après génération.
wb.save("/home/claude/nidou/docs/Nidou-previsionnel.xlsx")
print("ok")
