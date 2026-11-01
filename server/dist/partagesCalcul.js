const centimes = (n) => Math.round(n * 100);
/** Each participant's share, in cents, the remainder spread on the first ones so the total is exact. */
export function parts(montant, participants) {
    const total = centimes(montant), n = participants.length;
    const base = Math.floor(total / n), reste = total - base * n;
    return new Map(participants.map((p, i) => [p, base + (i < reste ? 1 : 0)]));
}
/** Balances in euros: positive = owed to the person, negative = the person owes. */
export function soldes(depenses, reglements, membres) {
    const c = new Map(membres.map((m) => [m.id, 0]));
    const add = (id, v) => c.set(id, (c.get(id) ?? 0) + v);
    for (const d of depenses) {
        add(d.paye_par, centimes(d.montant));
        for (const [p, part] of parts(d.montant, d.participants))
            add(p, -part);
    }
    for (const r of reglements) {
        add(r.de, centimes(r.montant));
        add(r.a, -centimes(r.montant));
    }
    return membres.map((m) => ({ member_id: m.id, prenom: m.prenom, solde: (c.get(m.id) ?? 0) / 100 }));
}
/** The fewest transfers to settle everything: the biggest debtor pays the biggest creditor, and so on. */
export function suggestions(s) {
    const dus = s.filter((x) => x.solde < -0.004).map((x) => ({ id: x.member_id, v: centimes(-x.solde) })).sort((a, b) => b.v - a.v);
    const crediteurs = s.filter((x) => x.solde > 0.004).map((x) => ({ id: x.member_id, v: centimes(x.solde) })).sort((a, b) => b.v - a.v);
    const out = [];
    let i = 0, j = 0;
    while (i < dus.length && j < crediteurs.length) {
        const v = Math.min(dus[i].v, crediteurs[j].v);
        if (v > 0)
            out.push({ de: dus[i].id, a: crediteurs[j].id, montant: v / 100 });
        dus[i].v -= v;
        crediteurs[j].v -= v;
        if (dus[i].v === 0)
            i++;
        if (crediteurs[j].v === 0)
            j++;
    }
    return out;
}
