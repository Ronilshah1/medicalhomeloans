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

  // The enquiry form is now the LeadConnector (GoHighLevel) embed, which submits to GHL
  // on its own. The handler that posted to /api/lead has been removed with it.
  // api/lead.js is left in place: it still works, and is the endpoint a GHL webhook
  // would post to if leads also need to reach Mercury.
})();
