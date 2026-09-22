// Hero enquiry form -> Connective Mercury CRM + email notification.
//
// The Mercury key is Partner-level (full CRUD on every contact and opportunity), so it
// lives only in Vercel env vars and is never sent to the browser.
//
// Mercury field names verified against a live GET /contacts response: email, mobile and
// occupation are flat fields on the contact, and the identifier is `uniqueId`.
//
// The email is a second, independent delivery path rather than a nicety: if Mercury
// rejects the write, the enquiry still reaches a human. The visitor is only shown an
// error when BOTH paths fail.

const MERCURY_BASE = 'https://apis.connective.com.au/mercury/v1';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body || {};

  // Honeypot: only bots fill this, and they get a success they can't distinguish.
  if (body.company) return res.status(200).json({ ok: true });

  const lead = {
    firstName: String(body.first_name || '').trim(),
    lastName: String(body.last_name || '').trim(),
    phone: String(body.phone || '').trim(),
    email: String(body.email || '').trim(),
    occupation: String(body.occupation || '').trim()
  };

  if (!lead.firstName || !lead.lastName || !lead.phone || !lead.email) {
    return res.status(400).json({ error: 'Please complete all required fields.' });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lead.email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  const crm = await sendToMercury(lead);
  const mail = await sendNotification(lead, crm);

  // Report each failure on its own. One path succeeding must not hide why the other
  // broke, or a half-working setup looks healthy.
  if (!crm.ok) console.error('Mercury write failed:', crm.error);
  if (!mail.ok) console.error('Email notification failed:', mail.error);

  if (crm.ok || mail.ok) {
    console.log('Lead received:', { crm: crm.ok, email: mail.ok, uniqueId: crm.uniqueId });
    return res.status(200).json({ ok: true });
  }

  // Both paths failed — log the lead so it stays recoverable from the runtime logs.
  console.error('LEAD NOT SENT — CRM and email both failed:', lead);
  return res.status(502).json({ error: 'Your enquiry could not be sent. Please call us instead.' });
};

async function sendToMercury(lead) {
  const key = process.env.MERCURY_API_KEY;
  const token = process.env.MERCURY_API_TOKEN;
  if (!key || !token) return { ok: false, error: 'Mercury credentials not configured' };

  const payload = {
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    mobile: lead.phone,
    notes: 'Website enquiry via medicalhomeloans.au'
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

  const to = process.env.LEAD_NOTIFY_TO || 'ronil@coincapital.com.au';
  const from = process.env.LEAD_NOTIFY_FROM || 'onboarding@resend.dev';

  const received = new Date().toLocaleString('en-AU', {
    timeZone: 'Australia/Perth', dateStyle: 'medium', timeStyle: 'short'
  });

  const crmLine = crm.ok
    ? `Saved to Mercury${crm.uniqueId ? ` (contact ${crm.uniqueId})` : ''}.`
    : `NOT saved to Mercury — add this contact manually. Reason: ${crm.error}`;

  const rows = [
    ['Name', `${lead.firstName} ${lead.lastName}`],
    ['Email', lead.email],
    ['Phone', lead.phone],
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
        subject: `New enquiry — ${lead.firstName} ${lead.lastName}${lead.occupation ? ` (${lead.occupation})` : ''}`,
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
