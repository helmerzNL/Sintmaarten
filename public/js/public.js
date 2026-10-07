(async () => {
  const data = await (await fetch('/api/map')).json();
  document.getElementById('title').textContent = data.title;
  document.title = data.title;

  const map = Wijk.createMap(document.getElementById('vp'), data.view, data.houses);
  for (const h of data.houses) {
    if (h.status === 'none') continue;
    const poly = L.polygon(h.points, Wijk.houseStyle(h.status)).addTo(map);
    const box = document.createElement('div');
    const t = document.createElement('strong');
    t.textContent = h.label || 'Huis';
    box.append(t, document.createElement('br'), `${Wijk.STATUS[h.status].name}${h.note ? ' · ' + h.note : ''}`);
    poly.bindPopup(box);
  }

  const pdfName = `${data.title.replace(/[^\w-]+/g, '-')}.pdf`;
  async function run(btn, fn) {
    const label = btn.textContent;
    document.querySelectorAll('header button').forEach((b) => (b.disabled = true));
    btn.textContent = 'Bezig…';
    try { await fn(); }
    catch (e) { alert('PDF maken mislukt: ' + e.message); }
    finally {
      btn.textContent = label;
      document.querySelectorAll('header button').forEach((b) => (b.disabled = false));
    }
  }
  const make = () => Wijk.buildPdf({ title: data.title, houses: data.houses, view: data.view });

  document.getElementById('pdf-dl').onclick = (e) => run(e.currentTarget, async () => (await make()).save(pdfName));
  document.getElementById('pdf-view').onclick = (e) => {
    const win = window.open('', '_blank'); // synchroon openen i.v.m. pop-up blokkers
    run(e.currentTarget, async () => {
      const url = (await make()).output('bloburl');
      if (win) win.location.href = url; else location.href = url;
    });
  };
})();
