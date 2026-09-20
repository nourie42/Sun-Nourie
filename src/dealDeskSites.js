// Generated from deal-desk/lib/sites.ts.
const aliases = {
    name: ['site name', 'store name', 'location name', 'station name'],
    id: ['site id', 'store id', 'site number', 'store number', 'location id', 'site #', 'store #'],
    address: ['address', 'street address', 'site address', 'location address'],
    city: ['city', 'town'], state: ['state', 'province'], zip: ['zip', 'zip code', 'postal code'],
    ownership: ['ownership', 'owned leased', 'real estate', 'tenure'], brand: ['brand', 'fuel brand'],
    period: ['period', 'fiscal year', 'reporting period', 'year'],
    gallons: ['annual gallons', 'annual fuel gallons', 'annual fuel volume'],
    fuelCpg: ['fuel margin cpg', 'fuel cpg', 'fuel margin cents per gallon'],
    insideGp: ['annual inside gross profit', 'inside gross profit', 'inside gp'],
    sellerOpex: ['annual operating expense', 'annual opex', 'seller opex'],
};
const norm = (v) => String(v ?? '').toLowerCase().replace(/[_.\-/()]/g, ' ').replace(/\s+/g, ' ').trim();
export function sitesFromRows(rows, sourceId, sheet) {
    const headerIndex = rows.findIndex(row => row.some(c => aliases.address.includes(norm(c))) && row.some(c => [...aliases.id, ...aliases.name, ...aliases.city].includes(norm(c))));
    if (headerIndex < 0)
        return [];
    const headers = rows[headerIndex].map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`);
    const columns = headers.map(h => Object.keys(aliases).find(k => aliases[k].includes(norm(h))));
    return rows.slice(headerIndex + 1).flatMap((row, index) => {
        if (!row.some(v => v !== null && v !== undefined && v !== ''))
            return [];
        const raw = Object.fromEntries(headers.map((h, i) => [headers.indexOf(h) === i ? h : `${h} (${i + 1})`, row[i] ?? null]));
        const site = { id: `${sourceId}:${sheet}:${headerIndex + index + 2}`, sourceId, locator: `${sheet}!row ${headerIndex + index + 2}`, raw };
        columns.forEach((key, i) => {
            if (!key || row[i] === null || row[i] === undefined || row[i] === '')
                return;
            if (['gallons', 'fuelCpg', 'insideGp', 'sellerOpex'].includes(key)) {
                const v = typeof row[i] === 'number' ? row[i] : Number(String(row[i]).replace(/[$,]/g, ''));
                if (Number.isFinite(v) && v >= 0)
                    site[key] = v;
            }
            else
                site[key] = String(row[i]);
        });
        // Totals and empty address rows remain in the source; they are not new sites.
        if (!site.address || /^(total|grand total|subtotal)$/i.test(site.address.trim()))
            return [];
        return [site];
    });
}
export function mergeSites(lists) {
    const sites = lists.flat();
    const counts = new Map();
    const key = (s) => norm(`${s.address}|${s.city}|${s.state}|${s.zip}`);
    for (const site of sites) {
        const k = key(site);
        counts.set(k, (counts.get(k) || 0) + 1);
    }
    return sites.map(s => ({ ...s, duplicate: (counts.get(key(s)) || 0) > 1 }));
}
export function aggregateSites(sites, period, complete) {
    const out = {};
    if (!complete || !sites.length || sites.some(s => s.duplicate || s.reviewRequired))
        return out;
    out.sites = sites.length;
    if (!period || sites.some(s => s.period !== period))
        return out;
    for (const key of ['gallons', 'insideGp', 'sellerOpex']) {
        if (sites.every(s => Number.isFinite(s[key])))
            out[key] = sites.reduce((sum, s) => sum + s[key], 0);
    }
    if (out.gallons > 0 && sites.every(s => Number.isFinite(s.fuelCpg)))
        out.fuelCpg = sites.reduce((sum, s) => sum + s.gallons * s.fuelCpg, 0) / out.gallons;
    return out;
}
