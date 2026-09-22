// TEMPORARY schema discovery for the Mercury API. Read-only — it never writes.
// Returns the SHAPE of records (key names and types) and never their values, so no
// client PII leaves the CRM. Delete this file before deploying to production.

module.exports = async function handler(req, res) {
  const key = process.env.MERCURY_API_KEY;
  const token = process.env.MERCURY_API_TOKEN;
  if (!key || !token) return res.status(500).json({ error: 'Credentials not configured' });

  const bases = [
    'https://apis.connective.com.au/mercury/v1',
    'https://apis.connective.com.au/mercury-v1'
  ];

  const out = {};
  for (const base of bases) {
    out[base] = await probeBase(base, token, key);
  }
  return res.status(200).json(out);
};

async function probeBase(base, token, key) {
  const result = {};

  const search = encodeURIComponent(JSON.stringify({ lastUpdated: '2020-01-01' }));
  const list = await get(`${base}/${token}/contacts?search=true&searchParams=${search}`, key);
  result['GET /contacts'] = { status: list.status, shape: shape(list.json), error: list.error };

  const first = firstRecord(list.json);
  const id = first && (first.id || first.contactId || first.contactID);
  if (!id) return result;

  result.sampleContactId = String(id);

  // The key open question: is contactmethods a real child endpoint?
  for (const child of ['contactmethods', 'contactMethods', 'contact-methods', 'addresses', 'employment']) {
    const r = await get(`${base}/${token}/contacts/${id}/${child}`, key);
    result[`GET /contacts/{id}/${child}`] = { status: r.status, shape: shape(r.json), error: r.error };
  }

  const one = await get(`${base}/${token}/contacts/${id}`, key);
  result['GET /contacts/{id}'] = { status: one.status, shape: shape(one.json), error: one.error };

  return result;
}

async function get(url, key) {
  try {
    const r = await fetch(url, { headers: { 'x-api-key': key, accept: 'application/json' } });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { status: r.status, json, error: r.ok ? null : text.slice(0, 200) };
  } catch (err) {
    return { status: 0, json: null, error: err.message };
  }
}

function firstRecord(json) {
  if (!json) return null;
  if (Array.isArray(json)) return json[0];
  for (const k of ['data', 'items', 'results', 'contacts']) {
    if (Array.isArray(json[k])) return json[k][0];
  }
  return typeof json === 'object' ? json : null;
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
