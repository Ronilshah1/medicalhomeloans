// Shared behaviour for every page: mobile menu, embed fallbacks, and the enquiry form.
(function () {
  var links = document.getElementById('nav-links');
  var toggle = document.getElementById('nav-toggle');

  // Mobile menu
  if (toggle) toggle.addEventListener('click', function () {
    var open = links.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  if (links) links.addEventListener('click', function (e) {
    if (e.target.closest('a')) { links.classList.remove('open'); toggle.setAttribute('aria-expanded', 'false'); }
  });

  // Arriving from another page on a link like /#lmi: jump to that section once it exists.
  if (location.hash.length > 1) {
    var target = document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView();
  }

  // Embeds (calculator, booking calendar): if the host is blocked — as it is inside the
  // Claude artifact sandbox — swap the frame for a card that opens it in a new tab.
  document.querySelectorAll('.embed-frame').forEach(function (frame) {
    var f = frame.querySelector('iframe');
    var card = frame.querySelector('.embed-fallback');
    if (!f || !card) return;
    function fall() { if (frame.dataset.state === 'ok') return; f.hidden = true; card.hidden = false; }
    f.addEventListener('load', function () {
      if (frame.dataset.state === 'blocked') return;
      frame.dataset.state = 'ok'; f.hidden = false; card.hidden = true;
    });
    setTimeout(function () { if (frame.dataset.state !== 'ok') fall(); }, 6000);
    frame.__fall = function () { frame.dataset.state = 'blocked'; fall(); };
  });
  document.addEventListener('securitypolicyviolation', function (e) {
    if (e.violatedDirective && e.violatedDirective.indexOf('frame') === -1) return;
    var host = '';
    try { host = new URL(e.blockedURI, location.href).hostname; } catch (err) { return; }
    document.querySelectorAll('.embed-frame').forEach(function (frame) {
      var f = frame.querySelector('iframe');
      if (f && host && f.src.indexOf(host) !== -1 && frame.__fall) frame.__fall();
    });
  });

  // Hero enquiry form -> /api/lead -> Connective Mercury CRM.
  var form = document.getElementById('lead-form');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var status = document.getElementById('form-status');
      var button = form.querySelector('button[type="submit"]');
      var missing = Array.prototype.filter.call(form.querySelectorAll('[required]'), function (el) { return !el.value.trim() || !el.checkValidity(); });
      status.hidden = false;
      if (missing.length) {
        status.textContent = 'Please complete ' + missing.map(function (el) { return el.placeholder; }).join(', ') + '.';
        missing[0].focus();
        return;
      }

      var first = document.getElementById('lf-first').value.trim();
      button.disabled = true;
      status.textContent = 'Sending…';

      fetch('/api/lead', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          first_name: first,
          last_name: document.getElementById('lf-last').value.trim(),
          phone: document.getElementById('lf-phone').value.trim(),
          email: document.getElementById('lf-email').value.trim(),
          occupation: document.getElementById('lf-occupation').value,
          company: document.getElementById('lf-company').value
        })
      }).then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (data) {
          if (!r.ok) throw new Error(data.error || 'Your enquiry could not be sent.');
          return data;
        });
      }).then(function () {
        status.textContent = 'Thanks ' + first + ' — we’ve got your details and will be in touch shortly.';
        form.reset();
      }).catch(function (err) {
        status.textContent = err.message + ' You can also reach us on ronil@coincapital.com.au.';
      }).then(function () {
        button.disabled = false;
      });
    });
  }
})();
