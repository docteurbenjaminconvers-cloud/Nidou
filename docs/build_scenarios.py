"""Adds the 'Scénarios' tab (frozen values computed from the Hypothèses tab)."""
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill
import subprocess, sys
RECALC = "/root/.claude/skills/synced/26c5500e-6130-40f6-999a-03ee2ab6084b_cd0ad7a5-8dc3-40e4-9491-98a4eee14b5e/xlsx/scripts/recalc.py"
SRC = "/home/claude/lucien/docs/Lucien-previsionnel.xlsx"
def run(changes):
    wb = load_workbook(SRC); hy = wb["Hypothèses"]; labels = {hy.cell(r, 1).value: r for r in range(1, hy.max_row + 1)}
    for k, v in changes.items(): hy.cell(labels[k], 2, v)
    out = "/tmp/claude-0/-home-claude/bc755e62-93e2-5258-acfc-4e08856930ba/scratchpad/sc.xlsx"; wb.save(out)
    subprocess.run([sys.executable, RECALC, out, "60"], capture_output=True)
    ws = load_workbook(out, data_only=True)["Prévisionnel"]
    for r in ws.iter_rows(min_row=4, max_row=ws.max_row):
        if str(r[0].value).startswith("RÉSULTAT"): return [round(c.value) for c in r[1:6]]
sc = [
    ("A — Solo / Duo / Tribu (30 / 50 / 20 %), hypothèses de base (Bridge au tarif public 1 €)", {}),
    ("B — même grille, Bridge négocié à 0,60 € par compte", {"Agrégation bancaire Bridge, par compte connecté (€)": 0.6}),
    ("C — même grille, churn à 5 % par mois (pessimiste)", {"Churn mensuel des abonnés": 0.05}),
    ("D — même grille, 15 comptes gratuits par payant (conversion faible)", {"Utilisateurs gratuits par abonné payant": 15}),
    ("E — pour mémoire : 4 € / 40 €, hypothèses de base", {"Prix mensuel TTC (€)": 4, "Prix annuel TTC (€)": 40}),
]
res = [(l, run(c)) for l, c in sc]
wb = load_workbook(SRC)
if "Scénarios" in wb.sheetnames: del wb["Scénarios"]
ws = wb.create_sheet("Scénarios", 0)
F = lambda **k: Font(name="Arial", **k)
ws.column_dimensions["A"].width = 72
for c in "BCDEF": ws.column_dimensions[c].width = 14
ws["A1"] = "Lucien — résultat mensuel avant impôt selon les hypothèses (€)"; ws["A1"].font = F(bold=True, size=13)
ws["A2"] = "Valeurs figées, calculées à partir de l'onglet Hypothèses. Pour rejouer un scénario, modifiez les cellules jaunes de cet onglet : le Prévisionnel se recalcule. L'onglet Lancement 3 mois donne la trésorerie des premiers mois."; ws["A2"].font = F(italic=True, size=9)
for j, h in enumerate(["Scénario", "1 000 abonnés", "5 000", "20 000", "100 000", "500 000"]):
    c = ws.cell(4, 1 + j, h); c.font = F(bold=True); c.fill = PatternFill("solid", fgColor="EEEEEE")
for i, (l, v) in enumerate(res):
    ws.cell(5 + i, 1, l).font = F()
    for j, x in enumerate(v): c = ws.cell(5 + i, 2 + j, x); c.number_format = '#,##0 €;(#,##0 €);-'; c.font = F(color="0000FF")
ws.cell(11, 1, "Lecture").font = F(bold=True)
notes = [
    "Avec la grille Solo 6,90 € / Duo 9,90 € / Tribu 13,90 € (mélange 30 / 50 / 20 %), le prix moyen est ≈ 9,80 € TTC et il reste ≈ 7,20 € nets par abonné après TVA et Stripe, pour ≈ 1,90 € de coûts variables (dont Bridge, plus élevé en Tribu). Le modèle est positif à tous les paliers, y compris au tarif public de Bridge.",
    "Le seuil de rentabilité de chaque palier (couvrir l'équipe et le support prévus) est atteint avec 20 à 35 % des abonnés du palier.",
    "Un abonné vaut ≈ 240 € nets sur sa durée de vie à 3 % de churn : un coût d'acquisition jusqu'à 60 à 80 € reste rentable.",
    "Le gratuit coûte ≈ 2 centimes par compte et par mois (IA en modèle rapide au quota, stockage, push). 15 gratuits par payant restent supportables (scénario D).",
    "Le risque principal est le churn : à 5 % par mois (scénario C), la valeur d'un abonné baisse d'un tiers. La rétention (économies réellement constatées) est le vrai moteur.",
]
for i, n in enumerate(notes): ws.cell(12 + i, 1, n).font = F(size=10)
wb.save(SRC)
subprocess.run([sys.executable, RECALC, SRC, "60"], capture_output=True)
for l, v in res: print(l[:60], v)
