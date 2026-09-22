// Hero enquiry form -> Connective Mercury CRM.
//
// The Mercury key is Partner-level (full CRUD on every contact and opportunity), so it
// lives only in Vercel env vars and is never sent to the browser.
//
// UNVERIFIED: the payload shapes below come from the Mercury API docs, not from the
// swagger — check /contacts and /contacts/{id}/contactmethods before trusting them.

const API_BASE = 'https://apis.connective.com.au/mercury/v1';

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

  const key = process.env.MERCURY_API_KEY;
  const token = process.env.MERCURY_API_TOKEN;
  if (!key || !token) {
    console.error('LEAD NOT SENT — Mercury credentials missing:', lead);
    return res.status(500).json({ error: 'Your enquiry could not be sent. Please call us instead.' });
  }

  try {
    const contact = await mercury('POST', `/${token}/contacts`, key, {
      firstName: lead.firstName,
      lastName: lead.lastName,
      notes: lead.occupation
        ? `Website enquiry — occupation: ${lead.occupation}`
        : 'Website enquiry'
    });

    const contactId = contact && (contact.id || contact.contactId);
    if (contactId) {
      await Promise.allSettled([
        mercury('POST', `/${token}/contacts/${contactId}/contactmethods`, key,
          { type: 'Email', value: lead.email, isPrimary: true }),
        mercury('POST', `/${token}/contacts/${contactId}/contactmethods`, key,
          { type: 'Mobile', value: lead.phone, isPrimary: true })
      ]);
    }

    console.log('Lead created in Mercury:', { contactId, email: lead.email });
    return res.status(200).json({ ok: true });
  } catch (err) {
    // Log the lead so a Mercury outage leaves it recoverable from the runtime logs
    // rather than silently dropped.
    console.error('LEAD NOT SENT — Mercury API error:', err.message, lead);
    return res.status(502).json({ error: 'Your enquiry could not be sent. Please call us instead.' });
  }
};

async function mercury(method, path, key, payload) {
  const r = await fetch(API_BASE + path, {
    method,
    headers: { 'x-api-key': key, 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}
