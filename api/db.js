// Lunch Hondenrace — gedeelde opslag (Vercel Function + Upstash Redis via de REST-API, geen npm-pakketten nodig).
//
// GET  /api/db?since=N   -> { v } als er niets veranderd is, anders { v, docs: { pad: { v, data } } }
// GET  /api/db?whoami    -> { admin, adminConfigured }
// POST /api/db           -> { op: 'set' | 'delete' | 'acquire', path, data, baseV }
//
// Rollen
// - beheerder: stuurt de header x-admin-code mee die gelijk is aan de omgevingsvariabele ADMIN_CODE.
//   Mag alles (restaurants, instellingen, races starten).
// - collega: iedereen met de link. Mag alleen zijn eigen hond in de startlijst zetten, wisselen of weghalen
//   (één hond per persoon, herkend aan de x-client-id die de browser zelf kiest).
// Zonder ADMIN_CODE is iedereen beheerder (handig om te testen, niet voor dagelijks gebruik).

const REDIS_URL = (process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/+$/, '');
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const ADMIN_CODE = String(process.env.ADMIN_CODE || '').trim();
const P = 'lhr:';
const MAX_RUNNERS = 10;
const MAX_RACES = 150;
const PATH_RE = /^[A-Za-z0-9_-]{1,40}\/[A-Za-z0-9_.:-]{1,100}$/;

async function redis(cmds) {
    const r = await fetch(REDIS_URL + '/pipeline', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + REDIS_TOKEN, 'Content-Type': 'application/json' },
        body: JSON.stringify(cmds),
    });
    const text = await r.text();
    if (!r.ok) throw new Error('database ' + r.status + ': ' + text.slice(0, 200));
    return JSON.parse(text).map(x => { if (x && x.error) throw new Error(x.error); return x ? x.result : null; });
}

async function getDoc(path) {
    const [raw] = await redis([['GET', P + 'd:' + path]]);
    return raw ? JSON.parse(raw) : null;
}

async function nextSeq() { const [v] = await redis([['INCR', P + 'seq']]); return Number(v); }
async function writeDoc(path, data, preV) {
    const v = preV || await nextSeq();
    const cmds = [['SET', P + 'd:' + path, JSON.stringify({ v, data })], ['SADD', P + 'paths', path]];
    if (path.startsWith('races/')) cmds.push(['ZADD', P + 'races', String(Number(data && data.at) || Date.now()), path], ['ZCARD', P + 'races']);
    cmds.push(['INCR', P + 'ver']);
    const out = await redis(cmds);
    if (path.startsWith('races/')) {
        const n = Number(out[3]);
        if (n > MAX_RACES) {
            const [old] = await redis([['ZRANGE', P + 'races', '0', String(n - MAX_RACES - 1)]]);
            if (old && old.length) await redis([['DEL', ...old.map(p => P + 'd:' + p)], ['SREM', P + 'paths', ...old], ['ZREM', P + 'races', ...old], ['INCR', P + 'ver']]);
        }
    }
    return { v, data };
}

async function deleteDoc(path) {
    await redis([['DEL', P + 'd:' + path], ['SREM', P + 'paths', path], ['ZREM', P + 'races', path], ['INCR', P + 'ver']]);
}

// alleen de velden die een hond nodig heeft, met nette lengtes
const STR = (v, n) => typeof v === 'string' ? v.slice(0, n) : null;
const NUM = v => typeof v === 'number' && isFinite(v) ? v : null;
function cleanRunner(r, clientId) {
    const out = {
        key: STR(r.key, 40), rid: STR(r.rid, 120), name: STR(r.name, 120), cuisine: STR(r.cuisine, 60),
        cuisines: Array.isArray(r.cuisines) ? r.cuisines.filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 60)) : [],
        rating: NUM(r.rating), ratingCount: NUM(r.ratingCount) || 0, deliveryMinutes: NUM(r.deliveryMinutes), deliveryMax: NUM(r.deliveryMax),
        url: STR(r.url, 500) || '', urls: r.urls && typeof r.urls === 'object' ? { thuisbezorgd: STR(r.urls.thuisbezorgd, 500), ubereats: STR(r.urls.ubereats, 500) } : null, image: STR(r.image, 600), logo: STR(r.logo, 600), minOrder: NUM(r.minOrder), brand: STR(r.brand, 80),
        coat: STR(r.coat, 40), seed: NUM(r.seed), dogName: STR(r.dogName, 80),
        schedule: r.schedule && typeof r.schedule === 'object' && JSON.stringify(r.schedule).length < 3000 ? r.schedule : null,
        by: STR(r.by, 24) || 'Collega', byId: clientId,
    };
    if (!out.key || !out.name) return null;
    return out;
}

async function writeLineup(req, res, { data, baseV }, isAdmin, clientId) {
    const cur = await getDoc('app/lineup');
    const curData = cur && cur.data && typeof cur.data === 'object' ? cur.data : { round: 'r1', runners: [] };
    const curRunners = Array.isArray(curData.runners) ? curData.runners.filter(Boolean) : [];
    const next = data && typeof data === 'object' ? data : {};
    const nextRunners = Array.isArray(next.runners) ? next.runners.filter(r => r && typeof r === 'object') : [];
    let result;
    if (isAdmin) {
        // honden die collega's net toevoegden terwijl de beheerder een oudere lijst had, niet kwijtraken
        const keys = new Set(nextRunners.map(r => r.key));
        const base = Number(baseV);
        const missed = cur && isFinite(base) && base < cur.v ? curRunners.filter(r => (r.addedV || 0) > base && !keys.has(r.key)) : [];
        result = { ...next, runners: [...nextRunners, ...missed].slice(0, MAX_RUNNERS) };
    } else {
        if (!clientId) return res.status(400).json({ error: 'invalid_argument', message: 'Geen browser-id' });
        const mineNew = nextRunners.filter(r => r.byId === clientId).slice(-1).map(r => cleanRunner(r, clientId)).filter(Boolean);
        const others = curRunners.filter(r => r.byId !== clientId);
        const mineCur = curRunners.filter(r => r.byId === clientId);
        if (mineNew.length && mineCur.length && mineCur[0].key === mineNew[0].key) result = curData; // niets veranderd
        else {
            if (mineNew.length && others.length >= MAX_RUNNERS) return res.status(409).json({ error: 'full', message: 'De startlijst is vol' });
            result = { ...curData, runners: [...others, ...mineNew] };
        }
    }
    const curKeys = new Set(curRunners.map(r => r.key));
    const v = await nextSeq();
    result = { ...result, runners: (result.runners || []).map(r => curKeys.has(r.key) ? r : { ...r, addedV: v }) };
    const saved = await writeDoc('app/lineup', result, v);
    return res.status(200).json({ ok: true, doc: saved });
}

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (!REDIS_URL || !REDIS_TOKEN) return res.status(503).json({ error: 'no_db', message: 'De database is nog niet gekoppeld (Upstash Redis in Vercel → Storage).' });
    const code = String(req.headers['x-admin-code'] || '').trim();
    const isAdmin = !ADMIN_CODE || code === ADMIN_CODE;
    const clientId = String(req.headers['x-client-id'] || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
    try {
        const q = req.query || {};
        if (req.method === 'GET') {
            if (q.whoami !== undefined) return res.status(200).json({ admin: isAdmin, adminConfigured: !!ADMIN_CODE });
            const since = q.since === undefined ? NaN : Number(q.since);
            const [ver] = await redis([['GET', P + 'ver']]);
            const v = Number(ver || 0);
            if (v === since) return res.status(200).json({ v });
            const [paths] = await redis([['SMEMBERS', P + 'paths']]);
            const docs = {};
            if (paths && paths.length) {
                const [vals] = await redis([['MGET', ...paths.map(p => P + 'd:' + p)]]);
                paths.forEach((p, i) => { if (vals[i]) docs[p] = JSON.parse(vals[i]); });
            }
            return res.status(200).json({ v, docs });
        }
        if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const { op, path } = body;
        if (!PATH_RE.test(String(path || ''))) return res.status(400).json({ error: 'invalid_argument', message: 'Ongeldig pad' });
        if (op === 'acquire') return res.status(200).json({ acquired: isAdmin });
        if (op === 'set' && path === 'app/lineup') return await writeLineup(req, res, body, isAdmin, clientId);
        if (!isAdmin) return res.status(403).json({ error: 'invalid_argument', message: 'Alleen de beheerder kan dit wijzigen' });
        if (op === 'set') {
            if (body.data === undefined || JSON.stringify(body.data).length > 900000) return res.status(400).json({ error: 'invalid_argument', message: 'Ongeldige of te grote waarde' });
            const saved = await writeDoc(path, body.data);
            return res.status(200).json({ ok: true, doc: saved });
        }
        if (op === 'delete') { await deleteDoc(path); return res.status(200).json({ ok: true }); }
        return res.status(400).json({ error: 'invalid_argument', message: 'Onbekende actie' });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: 'server', message: String(e && e.message || e) });
    }
};
