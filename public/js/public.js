(async () => {
  const $ = (id) => document.getElementById(id);
  const getData = async () => (await fetch('/api/map', { cache: 'no-cache' })).json();
  let data = await getData();

  // ---------- kop, logo en uitleg ----------
  function applyMeta(first) {
    Wijk.setLabels(data.labels);
    $('title').textContent = data.title;
    document.title = data.title;
    const iosTitle = data.appShortName || data.appName || data.title;
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', iosTitle);

    if (data.logo) {
      $('logo').src = data.logo.url;
      $('logo').alt = `Logo ${data.title}`;
      $('logo').hidden = false;
    } else {
      $('logo').hidden = true;
    }

    $('intro-btn').hidden = !data.intro;
    if (data.intro) {
      $('intro-title').textContent = data.title;
      $('intro-text').textContent = data.intro; // platte tekst; alinea's via CSS
      $('intro-btn').onclick = () => $('intro-dialog').showModal();
      $('intro-close').onclick = () => $('intro-dialog').close();
      // de eerste keer (of na een wijziging van de tekst) automatisch tonen
      if (first) {
        let seen = '';
        const key = 'sm-intro-seen';
        const hash = String(data.intro.length) + ':' + data.intro.slice(0, 40);
        try { seen = localStorage.getItem(key); } catch {}
        if (seen !== hash) {
          $('intro-dialog').showModal();
          try { localStorage.setItem(key, hash); } catch {}
        }
      }
    }
  }
  applyMeta(true);

  const map = Wijk.createMap($('vp'), data.view, data.houses);
  Wijk.map = map;
  const nums = Wijk.createNumberLayer(map);

  // ---------- huizen, straten en aantallen (opnieuw op te bouwen bij een verversing) ----------
  const OTHER = '';
  const streetName = (h) => h.street || OTHER;
  const hidden = new Set(); // verborgen straten (keuze wordt onthouden)
  try { JSON.parse(localStorage.getItem('sm-hidden-streets') || '[]').forEach((x) => hidden.add(x)); } catch {}
  let shownHouses = [];
  let streets = [];
  const polys = new Map(); // huis-id -> polygoon
  const rows = new Map(); // straat -> schakelaar in de popup

  const visibleHouses = () => shownHouses.filter((h) => !hidden.has(streetName(h)));
  const tally = (list) => ({ green: list.filter((h) => h.status === 'green').length, red: list.filter((h) => h.status === 'red').length });
  // "● 5 ● 2" met schermlezer-tekst
  const tallyEl = (t, cls) => {
    const el = document.createElement('span');
    el.className = cls;
    el.setAttribute('aria-label', `${t.green} ${Wijk.STATUS.green.name.toLowerCase()}, ${t.red} ${Wijk.STATUS.red.name.toLowerCase()}`);
    for (const k of ['green', 'red']) {
      const part = document.createElement('span');
      part.setAttribute('aria-hidden', 'true');
      const dot = document.createElement('i'); dot.className = `dot ${k}`;
      part.append(dot, String(t[k]));
      el.append(part);
    }
    return el;
  };
  const renderTotal = () => {
    const box = $('streets-total');
    if (box) box.replaceChildren('Totaal op de kaart: ', tallyEl(tally(visibleHouses()), 'street-tally'));
  };

  function applyStreets() {
    for (const h of shownHouses) {
      const poly = polys.get(h.id);
      const show = !hidden.has(streetName(h));
      if (show && !map.hasLayer(poly)) poly.addTo(map);
      if (!show && map.hasLayer(poly)) { poly.closePopup(); map.removeLayer(poly); }
    }
    nums.rebuild(visibleHouses());
    renderTotal();
    try { localStorage.setItem('sm-hidden-streets', JSON.stringify([...hidden])); } catch {}
  }

  function buildHouses() {
    polys.forEach((p) => map.removeLayer(p));
    polys.clear();
    shownHouses = data.houses.filter((h) => h.status !== 'none');
    for (const h of shownHouses) {
      const poly = L.polygon(h.points, Wijk.houseStyle(h.status));
      const box = document.createElement('div');
      const t = document.createElement('strong');
      t.textContent = Wijk.houseTitle(h);
      box.append(t, document.createElement('br'), `${Wijk.STATUS[h.status].name}${h.note ? ' · ' + h.note : ''}`);
      poly.bindPopup(box);
      polys.set(h.id, poly);
    }
    streets = [...new Set(shownHouses.map(streetName))].sort((a, b) => (a === OTHER) - (b === OTHER) || Wijk.natCompare(a, b));

    // straten-popup
    const list = $('streets-list');
    list.replaceChildren();
    rows.clear();
    for (const name of streets) {
      const t = tally(shownHouses.filter((h) => streetName(h) === name));
      const row = document.createElement('label');
      row.className = 'street-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.setAttribute('role', 'switch'); cb.checked = !hidden.has(name);
      cb.onchange = () => { cb.checked ? hidden.delete(name) : hidden.add(name); applyStreets(); };
      const track = document.createElement('span'); track.className = 'track'; track.setAttribute('aria-hidden', 'true');
      const thumb = document.createElement('span'); thumb.className = 'thumb'; track.append(thumb);
      const text = document.createElement('span'); text.className = 'street-name'; text.textContent = name || 'Overige huizen';
      row.append(cb, track, text, tallyEl(t, 'street-tally'));
      list.append(row);
      rows.set(name, cb);
    }
    $('streets-btn').hidden = !(streets.length > 1 || (streets.length === 1 && streets[0] !== OTHER));
    applyStreets();
  }

  const setAll = (on) => { streets.forEach((x) => { on ? hidden.delete(x) : hidden.add(x); rows.get(x).checked = on; }); applyStreets(); };
  $('streets-all').onclick = () => setAll(true);
  $('streets-none').onclick = () => setAll(false);
  $('streets-btn').onclick = () => $('streets-dialog').showModal();
  $('streets-close').onclick = () => $('streets-dialog').close();

  // huisnummers (schakelaar in de menubalk; keuze wordt onthouden, de beheerder bepaalt de standaard)
  let pref = null;
  try { pref = localStorage.getItem('sm-numbers'); } catch {}
  $('num-switch').checked = pref === null ? !!data.view?.showNumbers : pref === '1';
  $('num-switch').onchange = () => {
    nums.setVisible($('num-switch').checked);
    try { localStorage.setItem('sm-numbers', $('num-switch').checked ? '1' : '0'); } catch {}
  };

  buildHouses();
  nums.setVisible($('num-switch').checked);

  // bewoners: huis wijzigen (alleen in de geïnstalleerde app)
  Wijk.initResident?.({ map, houses: data.houses, enabled: data.residentsEnabled !== false });

  // ---------- automatisch verversen (o.a. nadat de beheerder een wijziging goedkeurt) ----------
  const signature = (d) => JSON.stringify([d.houses, d.labels, d.title, d.intro, d.logo, d.appName, d.appShortName]);
  let lastSig = signature(data);
  let busy = false;
  async function refresh() {
    if (busy || document.hidden || !navigator.onLine) return;
    busy = true;
    try {
      const next = await getData();
      if (signature(next) !== lastSig) {
        lastSig = signature(next);
        data = next;
        applyMeta(false);
        buildHouses();
      }
      // ook de eigen status (en een uitslag van de beheerder) opnieuw ophalen
      await Wijk.refreshResident?.(data.houses);
    } catch { /* offline of server even weg: volgende poging */ }
    busy = false;
  }
  setInterval(refresh, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  window.addEventListener('online', refresh);
  window.addEventListener('pageshow', (e) => { if (e.persisted) refresh(); });
  Wijk.refresh = refresh;

  // kaart alvast klaarzetten voor offline gebruik
  if (navigator.serviceWorker) navigator.serviceWorker.ready.then(() => Wijk.prefetchTiles(data.houses, data.view));

  // ---------- PDF ----------
  const pdfName = () => `${data.title.replace(/[^\w-]+/g, '-')}.pdf`;
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

  $('pdf-dl').onclick = (e) => run(e.currentTarget, async () => (await make()).save(pdfName()));
  $('pdf-view').onclick = (e) => {
    const win = window.open('', '_blank'); // synchroon openen i.v.m. pop-up blokkers
    run(e.currentTarget, async () => {
      const url = (await make()).output('bloburl');
      if (win) win.location.href = url; else location.href = url;
    });
  };
})();
