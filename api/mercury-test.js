// TEMPORARY end-to-end test of the lead capture. Delete before production.
//
// Drives the real api/lead.js handler with obviously-fake data, then reads the record
// back to confirm which fields persisted. This DOES write one contact to the CRM —
// search for "ZZTest ClaudeProbe" to delete it.

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

  const out = {};

  // 1. Drive the real lead handler.
  const mockRes = makeMockRes();
  await leadHandler({ method: 'POST', body: TEST_LEAD }, mockRes);
  out.leadHandler = { status: mockRes.code, body: mockRes.body };

  // 2. Read back what persisted. Values shown are the synthetic lead above, not
  //    real client data.
  const search = encodeURIComponent(JSON.stringify({ email: TEST_LEAD.email }));
  const found = await get(`${API_BASE}/${token}/contacts?search=true&searchParams=${search}`, key);
  out.searchByEmail = { status: found.status, error: found.error };

  const results = found.json && Array.isArray(found.json.results) ? found.json.results : [];
  const rec = results.find(c => c && c.email === TEST_LEAD.email) || null;
  out.searchMatches = found.json && found.json.totalCount;

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
        personDataType: rec.personDataType,
        createdOn: rec.createdOn
      }
    : 'not found by email search';

  return res.status(200).json(out);
};

async function get(url, key) {
  try {
    const r = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' } });
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
