(async () => {
  const $ = (id) => document.getElementById(id);
  const data = await (await fetch('/api/map')).json();
  $('title').textContent = data.title;
  document.title = data.title;

  if (data.logo) {
    $('logo').src = data.logo.url;
    $('logo').alt = `Logo ${data.title}`;
    $('logo').hidden = false;
  }

  if (data.intro) {
    $('intro-title').textContent = data.title;
    $('intro-text').textContent = data.intro; // platte tekst; alinea's via CSS
    $('intro-btn').hidden = false;
    $('intro-btn').onclick = () => $('intro-dialog').showModal();
    $('intro-close').onclick = () => $('intro-dialog').close();
    // de eerste keer (of na een wijziging van de tekst) automatisch tonen
    let seen = '';
    const key = 'sm-intro-seen';
    const hash = String(data.intro.length) + ':' + data.intro.slice(0, 40);
    try { seen = localStorage.getItem(key); } catch {}
    if (seen !== hash) {
      $('intro-dialog').showModal();
      try { localStorage.setItem(key, hash); } catch {}
    }
  }

  const map = Wijk.createMap($('vp'), data.view, data.houses);
  Wijk.map = map;
  for (const h of data.houses) {
    if (h.status === 'none') continue;
    const poly = L.polygon(h.points, Wijk.houseStyle(h.status)).addTo(map);
    const box = document.createElement('div');
    const t = document.createElement('strong');
    t.textContent = h.label || 'Huis';
    box.append(t, document.createElement('br'), `${Wijk.STATUS[h.status].name}${h.note ? ' · ' + h.note : ''}`);
    poly.bindPopup(box);
  }

  // kaart alvast klaarzetten voor offline gebruik
  if (navigator.serviceWorker) navigator.serviceWorker.ready.then(() => Wijk.prefetchTiles(data.houses, data.view));

  const pdfName = `${data.title.replace(/[^\w-]+/g, '-')}.pdf`;
  const pdfButtons = ['pdf-view', 'pdf-dl'].map($);
  async function run(btn, fn) {
    const label = btn.textContent;
    pdfButtons.forEach((b) => (b.disabled = true));
    btn.textContent = 'Bezig…';
    try { await fn(); }
    catch (e) { alert('PDF maken mislukt: ' + e.message); }
    finally { btn.textContent = label; pdfButtons.forEach((b) => (b.disabled = false)); }
  }
  const make = () => Wijk.buildPdf({ title: data.title, houses: data.houses, view: data.view, intro: data.intro, logo: data.logo });

  $('pdf-dl').onclick = (e) => run(e.currentTarget, async () => (await make()).save(pdfName));
  $('pdf-view').onclick = (e) => {
    const win = window.open('', '_blank'); // synchroon openen i.v.m. pop-up blokkers
    run(e.currentTarget, async () => {
      const url = (await make()).output('bloburl');
      if (win) win.location.href = url; else location.href = url;
    });
  };
})();
