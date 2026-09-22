// TEMPORARY Mercury diagnostics. Delete before deploying to production.
//
// Default: read-only. Returns the SHAPE of records (key names and types) only, never
// their values, so no client PII leaves the CRM.
//
// ?test=1: invokes the real api/lead.js handler with obviously-fake data, then reads
// the record back to confirm the fields persisted. This DOES write one contact.

const leadHandler = require('./lead.js');

const API_BASE = 'https://apis.connective.com.au/mercury/v1';

const TEST_LEAD = {
  first_name: 'ZZTest',
  last_name: 'ClaudeProbe',
  phone: '0400000000',
  email: 'zztest.claudeprobe@example.com',
  occupation: 'Doctor / Specialist'
};

module.exports = async function handler(req, res) {
  const key = process.env.MERCURY_API_KEY;
  const token = process.env.MERCURY_API_TOKEN;
  if (!key || !token) return res.status(500).json({ error: 'Credentials not configured' });

  if (req.query && req.query.test === '1') {
    return res.status(200).json(await runCreateTest(token, key));
  }

  const search = encodeURIComponent(JSON.stringify({ lastUpdated: '2020-01-01' }));
  const list = await call('GET', `${API_BASE}/${token}/contacts?search=true&searchParams=${search}`, key);
  return res.status(200).json({
    'GET /contacts': { status: list.status, shape: shape(list.json), error: list.error }
  });
};

async function runCreateTest(token, key) {
  const out = {};

  // 1. Drive the real lead handler.
  const mockRes = makeMockRes();
  await leadHandler({ method: 'POST', body: TEST_LEAD }, mockRes);
  out.leadHandler = { status: mockRes.code, body: mockRes.body };

  // 2. Find the record it created and show what actually persisted. Values here are
  //    the synthetic test lead above, not real client data.
  const search = encodeURIComponent(JSON.stringify({ email: TEST_LEAD.email }));
  const found = await call('GET', `${API_BASE}/${token}/contacts?search=true&searchParams=${search}`, key);
  out.searchByEmail = { status: found.status, error: found.error };

  const rec = found.json && Array.isArray(found.json.results)
    ? found.json.results.find(c => c && c.email === TEST_LEAD.email)
    : null;

  out.persisted = rec
    ? {
        uniqueId: rec.uniqueId,
        firstName: rec.firstName,
        lastName: rec.lastName,
        email: rec.email,
        mobile: rec.mobile,
        occupation: rec.occupation,
        notes: rec.notes,
        contactType: rec.contactType,
        personDataType: rec.personDataType
      }
    : 'not found by email search';

  if (found.json && typeof found.json.totalCount === 'number') {
    out.searchMatches = found.json.totalCount;
  }

  return out;
}

async function call(method, url, key, payload) {
  try {
    const r = await fetch(url, {
      method,
      headers: { 'x-api-key': key, 'content-type': 'application/json', accept: 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: r.status, json, error: r.ok ? null : text.slice(0, 300) };
  } catch (err) {
    return { status: 0, json: null, error: err.message };
  }
}

function makeMockRes() {
  const r = { code: null, body: null };
  r.setHeader = () => {};
  r.status = c => { r.code = c; return r; };
  r.json = b => { r.body = b; return r; };
  return r;
}

// Types and key names only — deliberately never values.
function shape(v, depth = 0) {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) {
    if (depth > 3) return '[...]';
    return v.length ? [shape(v[0], depth + 1), `len:${v.length}`] : 'empty[]';
  }
  if (typeof v === 'object') {
    if (depth > 3) return '{...}';
    const o = {};
    for (const k of Object.keys(v)) o[k] = shape(v[k], depth + 1);
    return o;
  }
  return typeof v;
}
