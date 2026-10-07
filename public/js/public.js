(async () => {
  const $ = (id) => document.getElementById(id);
  const data = await (await fetch('/api/map')).json();
  $('title').textContent = data.title;
  document.title = data.title;
  const iosTitle = data.appShortName || data.appName || data.title;
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', iosTitle);

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
  const shownHouses = data.houses.filter((h) => h.status !== 'none');
  const polys = new Map(); // huis-id -> polygoon
  for (const h of shownHouses) {
    const poly = L.polygon(h.points, Wijk.houseStyle(h.status)).addTo(map);
    const box = document.createElement('div');
    const t = document.createElement('strong');
    t.textContent = Wijk.houseTitle(h);
    box.append(t, document.createElement('br'), `${Wijk.STATUS[h.status].name}${h.note ? ' · ' + h.note : ''}`);
    poly.bindPopup(box);
    polys.set(h.id, poly);
  }

  // straten tonen/verbergen (keuze wordt onthouden)
  const OTHER = '';
  const streetName = (h) => h.street || OTHER;
  const streets = [...new Set(shownHouses.map(streetName))].sort((a, b) => (a === OTHER) - (b === OTHER) || Wijk.natCompare(a, b));
  const hidden = new Set();
  try { JSON.parse(localStorage.getItem('sm-hidden-streets') || '[]').forEach((x) => streets.includes(x) && hidden.add(x)); } catch {}
  const visibleHouses = () => shownHouses.filter((h) => !hidden.has(streetName(h)));

  const nums = Wijk.createNumberLayer(map);
  function applyStreets() {
    for (const h of shownHouses) {
      const poly = polys.get(h.id);
      const show = !hidden.has(streetName(h));
      if (show && !map.hasLayer(poly)) poly.addTo(map);
      if (!show && map.hasLayer(poly)) { poly.closePopup(); map.removeLayer(poly); }
    }
    nums.rebuild(visibleHouses());
    try { localStorage.setItem('sm-hidden-streets', JSON.stringify([...hidden])); } catch {}
  }

  if (streets.length > 1 || (streets.length === 1 && streets[0] !== OTHER)) {
    $('streets-btn').hidden = false;
    const list = $('streets-list');
    const rows = new Map();
    for (const name of streets) {
      const count = shownHouses.filter((h) => streetName(h) === name).length;
      const row = document.createElement('label');
      row.className = 'street-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.setAttribute('role', 'switch'); cb.checked = !hidden.has(name);
      cb.onchange = () => { cb.checked ? hidden.delete(name) : hidden.add(name); applyStreets(); };
      const track = document.createElement('span'); track.className = 'track'; track.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('span'); thumb.className = 'thumb'; track.append(thumb);
      const text = document.createElement('span'); text.className = 'street-name'; text.textContent = name || 'Overige huizen';
      const n = document.createElement('span'); n.className = 'street-count'; n.textContent = `${count}`;
      row.append(cb, track, text, n);
      list.append(row);
      rows.set(name, cb);
    }
    const setAll = (on) => { streets.forEach((x) => { on ? hidden.delete(x) : hidden.add(x); rows.get(x).checked = on; }); applyStreets(); };
    $('streets-all').onclick = () => setAll(true);
    $('streets-none').onclick = () => setAll(false);
    $('streets-btn').onclick = () => $('streets-dialog').showModal();
    $('streets-close').onclick = () => $('streets-dialog').close();
  }

  // huisnummers (schakelaar in de menubalk; keuze wordt onthouden, de beheerder bepaalt de standaard)
  let pref = null;
  try { pref = localStorage.getItem('sm-numbers'); } catch {}
  $('num-switch').checked = pref === null ? !!data.view?.showNumbers : pref === '1';
  $('num-switch').onchange = () => {
    nums.setVisible($('num-switch').checked);
    try { localStorage.setItem('sm-numbers', $('num-switch').checked ? '1' : '0'); } catch {}
  };
  applyStreets();
  nums.setVisible($('num-switch').checked);

  // kaart alvast klaarzetten voor offline gebruik
  if (navigator.serviceWorker) navigator.serviceWorker.ready.then(() => Wijk.prefetchTiles(data.houses, data.view));

  const pdfName = `${data.title.replace(/[^\w-]+/g, '-')}.pdf`;
  const pdfButtons = ['pdf-view', 'pdf-dl'].map($);
  async function run(btn, fn) {
    const html = btn.innerHTML;
    pdfButtons.forEach((b) => (b.disabled = true));
    btn.innerHTML = '<span class="ico">⏳</span><span class="lbl">Bezig…</span>';
    try { await fn(); }
    catch (e) { alert('PDF maken mislukt: ' + e.message); }
    finally { btn.innerHTML = html; pdfButtons.forEach((b) => (b.disabled = false)); }
  }
  const make = () => Wijk.buildPdf({ title: data.title, houses: data.houses.filter((h) => h.status === 'none' || !hidden.has(streetName(h))), view: data.view, intro: data.intro, logo: data.logo, showNumbers: $('num-switch').checked });

  $('pdf-dl').onclick = (e) => run(e.currentTarget, async () => (await make()).save(pdfName));
  $('pdf-view').onclick = (e) => {
    const win = window.open('', '_blank'); // synchroon openen i.v.m. pop-up blokkers
    run(e.currentTarget, async () => {
      const url = (await make()).output('bloburl');
      if (win) win.location.href = url; else location.href = url;
    });
  };
})();
