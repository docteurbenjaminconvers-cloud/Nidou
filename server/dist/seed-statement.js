/** Builds a fictional 4-month bank statement (CSV) for demos and tests, relative to `today`. */
export function demoStatement(today = new Date().toISOString().slice(0, 10)) {
    const base = new Date(today + "T00:00:00Z");
    const rows = [];
    const d = (monthOffset, day) => {
        const x = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - monthOffset, Math.min(day, 28)));
        return x.toISOString().slice(0, 10);
    };
    const add = (m, day, label, amount) => { if (d(m, day) <= today)
        rows.push([d(m, day), label, amount]); };
    for (let m = 3; m >= 0; m--) {
        add(m, 1, "VIR SALAIRE SOCIETE DUPONT", 2850);
        add(m, 2, "VIR SALAIRE CLINIQUE SAINT ROCH", 2100);
        add(m, 5, "CAF ALLOCATIONS FAMILIALES", 141.5);
        add(m, 3, "PRLV SEPA CREDIT IMMO BNP 000456", -1180);
        add(m, 4, "PRLV SEPA EDF CLIENTS PARTICULIERS", m >= 1 ? -96 : -117);
        add(m, 6, "PRLV SEPA ORANGE SA", -64.99);
        add(m, 8, "PRLV SEPA MATMUT ASSURANCE HAB", -38.5);
        add(m, 8, "PRLV SEPA HARMONIE MUTUELLE", -148);
        add(m, 10, "CB NETFLIX.COM", -13.49);
        add(m, 11, "CB DISNEY PLUS", -8.99);
        add(m, 12, "CB SPOTIFY AB", -17.99);
        add(m, 12, "CB AMAZON PRIME FR", -6.99);
        add(m, 13, "PRLV SEPA BASIC FIT FRANCE", -29.99);
        add(m, 14, "CB APPLE.COM/BILL ICLOUD", -2.99);
        add(m, 15, "CB CANAL+ ABONNEMENT", -24.99);
        add(m, 16, "CB KEEPCOOL MONTPELLIER", -34.9);
        add(m, 20, "PRLV SEPA MAIRIE CANTINE JEAN MOULIN", -68);
        add(m, 2, "COTISATION CARTE VISA PREMIER", -11);
        add(m, 28, "COMMISSION INTERVENTION", m === 2 ? -8 : 0);
        // variable spending
        const groceries = m === 0 ? [92, 110, 88, 134, 97, 71] : [84, 96, 78, 102, 88];
        groceries.forEach((a, i) => add(m, 3 + i * 4, i % 2 ? "CB CARREFOUR MARKET 11/10 MONTPELLIER" : "CB LIDL 2210 UZES", -a));
        add(m, 7, "CB TOTALENERGIES RELAIS A9", -72.4);
        add(m, 21, "CB TOTALENERGIES RELAIS A9", -68.1);
        add(m, 9, "CB PHARMACIE DU PEYROU", -23.6);
        add(m, 17, "CB RESTAURANT LE PETIT JARDIN", m === 0 ? -86 : -54);
        add(m, 23, "CB UBER EATS", m === 0 ? -41.5 : -27);
        add(m, 25, "CB DECATHLON", m === 1 ? -129 : 0);
        add(m, 26, "CB AMAZON EU SARL", m === 0 ? -164 : -58);
        add(m, 27, "RETRAIT DAB BNP MONTPELLIER", -60);
        add(m, 19, "VIR LIVRET A EPARGNE", -300);
    }
    const lines = ["Date;Libellé;Montant", ...rows.filter((r) => r[2] !== 0).sort((a, b) => a[0].localeCompare(b[0])).map(([dt, l, a]) => `${dt.split("-").reverse().join("/")};${l};${a.toFixed(2).replace(".", ",")}`)];
    return lines.join("\n");
}
