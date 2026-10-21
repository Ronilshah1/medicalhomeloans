// GoHighLevel (LeadConnector) webhook -> Connective Mercury CRM + email notification.
//
// The site's enquiry form is now the LeadConnector embed, so nothing in the browser calls
// this any more. It accepts only authenticated webhook posts, which also closes the
// public write path that previously let anyone insert contacts into the CRM.
//
// The Mercury key is Partner-level (full CRUD on every contact and opportunity), so it
// lives only in Vercel env vars and is never sent to the browser.
//
// Mercury field names verified against a live GET /contacts response: email, mobile and
// occupation are flat fields on the contact, and the identifier is `uniqueId`.

const crypto = require('crypto');

const MERCURY_BASE = 'https://apis.connective.com.au/mercury/v1';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.LEAD_WEBHOOK_SECRET;
  if (!secret) {
    console.error('LEAD_WEBHOOK_SECRET not configured — refusing to accept webhooks.');
    return res.status(500).json({ error: 'Not configured' });
  }
  if (!matches(req.headers['x-webhook-secret'], secret)) {
    console.warn('Rejected webhook: bad or missing x-webhook-secret');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = req.body || {};
  // GoHighLevel's payload shape varies with how the workflow is built. Logging the keys
  // (never the values) makes the mapping below correctable against a real delivery.
  console.log('Webhook payload keys:', Object.keys(body).join(','));

  const lead = mapLead(body);
  if (!lead.firstName || !lead.email) {
    console.error('Webhook rejected — no usable name/email. Keys:', Object.keys(body).join(','));
    return res.status(400).json({ error: 'Payload has no usable first name or email' });
  }

  const crm = await sendToMercury(lead);
  const mail = await sendNotification(lead, crm);

  if (!crm.ok) console.error('Mercury write failed:', crm.error);
  if (!mail.ok) console.error('Email notification failed:', mail.error);

  if (!crm.ok) {
    // GoHighLevel already holds this lead, so the only job here is the Mercury write.
    // A non-2xx lets GHL surface and retry the delivery instead of silently dropping it.
    console.error('LEAD NOT WRITTEN TO MERCURY:', lead);
    return res.status(502).json({ error: 'CRM write failed', detail: crm.error });
  }

  console.log('Lead written to Mercury:', { uniqueId: crm.uniqueId, email: lead.email, emailed: mail.ok });
  return res.status(200).json({ ok: true, uniqueId: crm.uniqueId });
};

function matches(supplied, expected) {
  if (typeof supplied !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// GoHighLevel sends first_name/last_name on most workflow payloads, but falls back to a
// combined name on some. Custom fields land either at the top level or under customData.
function mapLead(body) {
  const custom = body.customData && typeof body.customData === 'object' ? body.customData : {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = body[k] !== undefined ? body[k] : custom[k];
      if (v !== undefined && v !== null && String(v).trim()) return String(v).trim();
    }
    return '';
  };

  let firstName = pick('first_name', 'firstName');
  let lastName = pick('last_name', 'lastName');
  const combined = pick('full_name', 'fullName', 'name', 'contact_name');
  if (!firstName && combined) {
    const parts = combined.split(/\s+/);
    firstName = parts.shift() || '';
    if (!lastName) lastName = parts.join(' ');
  }

  return {
    firstName,
    lastName,
    email: pick('email', 'contact_email'),
    phone: pick('phone', 'phone_number', 'mobile'),
    occupation: pick('occupation', 'What is your Occupation?', 'profession')
  };
}

async function sendToMercury(lead) {
  const key = process.env.MERCURY_API_KEY;
  const token = process.env.MERCURY_API_TOKEN;
  if (!key || !token) return { ok: false, error: 'Mercury credentials not configured' };

  const payload = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    mobile: lead.phone,
    notes: 'Website enquiry via medicalhomeloans.au (GoHighLevel)'
  };
  if (lead.occupation) payload.occupation = lead.occupation;

  try {
    const r = await fetch(`${MERCURY_BASE}/${token}/contacts`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `${r.status} ${text.slice(0, 300)}` };
    let uniqueId = null;
    try { uniqueId = JSON.parse(text).uniqueId; } catch (_) { /* no body */ }
    return { ok: true, uniqueId };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function sendNotification(lead, crm) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };

  const to = process.env.LEAD_NOTIFY_TO || 'ronil.meera@gmail.com';
  const from = process.env.LEAD_NOTIFY_FROM || 'onboarding@resend.dev';

  const received = new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Perth', dateStyle: 'medium', timeStyle: 'short'
  });

  const crmLine = crm.ok
    ? `Saved to Mercury${crm.uniqueId ? ` (contact ${crm.uniqueId})` : ''}.`
    : `NOT saved to Mercury — add this contact manually. Reason: ${crm.error}`;

  const rows = [
    ['Name', `${lead.firstName} ${lead.lastName}`.trim()],
    ['Email', lead.email],
    ['Phone', lead.phone || '—'],
    ['Occupation', lead.occupation || '—'],
    ['Received', `${received} (Perth)`]
  ];

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        reply_to: lead.email,
        subject: `New enquiry — ${lead.firstName} ${lead.lastName}`.trim(),
        text: rows.map(([k, v]) => `${k}: ${v}`).join('\n') + `\n\n${crmLine}`,
        html:
          `<table style="font:14px system-ui,sans-serif;border-collapse:collapse">` +
          rows.map(([k, v]) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#666">${escapeHtml(k)}</td>` +
            `<td style="padding:4px 0"><strong>${escapeHtml(v)}</strong></td></tr>`
          ).join('') +
          `</table><p style="font:13px system-ui,sans-serif;color:${crm.ok ? '#666' : '#b00'}">${escapeHtml(crmLine)}</p>`
      })
    });
    const text = await r.text();
    if (!r.ok) return { ok: false, error: `${r.status} ${text.slice(0, 300)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
