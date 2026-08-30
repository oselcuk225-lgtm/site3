'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------------------
//  YAPILANDIRMA
// ---------------------------------------------------------------------------
const PG_URL = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL || '';
const STORE_ID = 'velocity:keys';

// ---------------------------------------------------------------------------
//  VERİ KATMANI
//  Supabase Postgres bağlıysa kalıcı; değilse geçici bellek modu.
// ---------------------------------------------------------------------------
let memory = null;
let pool = null;
let table_ok = false;

const pg_ready = () => !!PG_URL;

function get_pool() {
  if (!pg_ready() || pool) return pool;
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: PG_URL,
      max: 1,
      connectionTimeoutMillis: 5000,
      ssl: { rejectUnauthorized: false },
    });
  } catch {
    pool = null;
  }
  return pool;
}

async function ensure_table() {
  if (table_ok) return true;
  const p = get_pool();
  if (!p) return false;
  try {
    await p.query(
      'CREATE TABLE IF NOT EXISTS app_state (id TEXT PRIMARY KEY, payload JSONB NOT NULL)'
    );
    table_ok = true;
    return true;
  } catch {
    return false;
  }
}

function empty_store() {
  return { keys: {}, licenses: {} };
}

async function load_store() {
  const p = get_pool();
  if (!p) return (memory = memory || empty_store());
  try {
    await ensure_table();
    const r = await p.query('SELECT payload FROM app_state WHERE id = $1', [STORE_ID]);
    if (r.rows.length && r.rows[0].payload) {
      const parsed = r.rows[0].payload;
      parsed.keys = parsed.keys || {};
      parsed.licenses = parsed.licenses || {};
      memory = parsed;
      return parsed;
    }
  } catch {}
  return (memory = memory || empty_store());
}

async function save_store(store) {
  memory = store;
  const p = get_pool();
  if (!p) return false;
  try {
    await ensure_table();
    await p.query(
      'INSERT INTO app_state (id, payload) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload',
      [STORE_ID, JSON.stringify(store)]
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
//  YARDIMCILAR
// ---------------------------------------------------------------------------
function gen_key() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 20; i++) {
    s += chars[crypto.randomInt(chars.length)];
    if (i === 4 || i === 9 || i === 14) s += '-';
  }
  return s;
}

function best_license(licenses) {
  let name = 'free';
  for (const key in licenses || {}) {
    if (licenses[key] > (licenses[name] || 0)) name = key;
  }
  return name;
}

function days_left(ms) {
  return Math.max(0, Math.floor((ms - Date.now()) / 86400000));
}
function iso(date) {
  return date ? date.toISOString() : '';
}
function send(res, data) {
  data.storage = pg_ready() ? 'pg' : 'memory';
  res.status(200).json(data);
}

// ---------------------------------------------------------------------------
//  ROUTE  /api?action=...
// ---------------------------------------------------------------------------
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return send(res, { status: 'ok' });

  const q = req.query || {};
  const action = (q.action || '').toString().trim();
  const key = (q.key || '').toString().trim().toUpperCase();

  try {
    // --- basit yoklama ---
    if (action === 'ping') {
      return send(res, { status: 'ok', msg: 'API calisiyor' });
    }

    const store = await load_store();

    // --- aktivasyon (loader) ---
    if (action === 'activate') {
      if (!key) return send(res, { status: 'fail', message: 'Anahtar bos.' });
      const rec = store.keys[key];
      if (!rec) return send(res, { status: 'fail', message: 'Anahtar bulunamadi.' });
      if (rec.status === 'banned') return send(res, { status: 'fail', message: 'Anahtar banli.' });
      const hwid = (q.hwid || '').toString().trim();
      if (!hwid) return send(res, { status: 'fail', message: 'HWID gerekli.' });
      const now = Date.now();
      if (rec.expires_at && now > rec.expires_at) {
        rec.status = 'expired';
        return send(res, { status: 'fail', message: 'Anahtar suresi doldu.' });
      }
      if (rec.hwid && rec.hwid !== hwid) {
        return send(res, { status: 'fail', message: 'Anahtar baska bilgisayarda aktif.' });
      }
      rec.hwid = hwid;
      rec.activated_at = rec.activated_at || now;
      rec.status = 'active';
      await save_store(store);
      return send(res, {
        status: 'ok',
        licence: best_license(store.licenses),
        expires: iso(rec.expires_at ? new Date(rec.expires_at) : null),
      });
    }

    // --- durum sorgu ---
    if (action === 'check') {
      if (!key) return send(res, { status: 'fail', message: 'Anahtar bos.' });
      const rec = store.keys[key];
      if (!rec) return send(res, { status: 'fail', message: 'Anahtar bulunamadi.' });
      const now = Date.now();
      const expired = !!(rec.expires_at && now > rec.expires_at);
      if (expired && rec.status !== 'banned') rec.status = 'expired';
      return send(res, {
        status: expired ? 'fail' : 'ok',
        message: expired ? 'Anahtar suresi doldu.' : (rec.status === 'banned' ? 'Anahtar banli.' : ''),
        licence: best_license(store.licenses),
        expires: iso(rec.expires_at ? new Date(rec.expires_at) : null),
        hwid: rec.hwid || '',
      });
    }

    // --- panel islemleri ---
    if (action === 'generate') {
      const raw_count = parseInt(q.count || '1', 10);
      const count = Math.min(Math.max(isNaN(raw_count) ? 1 : raw_count, 1), 100);
      const raw_days = parseInt(q.days || '0', 10);
      const days = Math.max(isNaN(raw_days) ? 0 : raw_days, 0);
      const now = Date.now();
      const made = [];
      for (let i = 0; i < count; i++) {
        let k = gen_key();
        while (store.keys[k]) k = gen_key();
        const rec = {
          status: 'unused',
          hwid: '',
          activated_at: 0,
          created_at: now,
          expires_at: days > 0 ? now + days * 86400000 : 0,
        };
        store.keys[k] = rec;
        made.push({ key: k, days, expires: iso(rec.expires_at ? new Date(rec.expires_at) : null) });
      }
      await save_store(store);
      return send(res, { status: 'ok', keys: made });
    }

    if (action === 'list') {
      const items = Object.entries(store.keys).map(([k, rec]) => ({
        key: k,
        status: rec.status,
        hwid: rec.hwid,
        created: iso(rec.created_at ? new Date(rec.created_at) : null),
        activated: iso(rec.activated_at ? new Date(rec.activated_at) : null),
        expires: iso(rec.expires_at ? new Date(rec.expires_at) : null),
        remaining: rec.expires_at ? days_left(rec.expires_at) : 0,
      }));
      items.sort((a, b) => (b.key < a.key ? 1 : -1));
      return send(res, { status: 'ok', keys: items });
    }

    if (action === 'ban') {
      if (!key || !store.keys[key]) return send(res, { status: 'fail', message: 'Anahtar bulunamadi.' });
      store.keys[key].status = store.keys[key].status === 'banned' ? 'unused' : 'banned';
      store.keys[key].hwid = '';
      await save_store(store);
      return send(res, { status: 'ok', current: store.keys[key].status });
    }

    return send(res, { status: 'fail', message: 'Bilinmeyen islem: ' + action });
  } catch (e) {
    return send(res, {
      status: 'fail',
      message: 'Sunucu hatasi: ' + (e && e.message ? e.message : e),
    });
  }
};
