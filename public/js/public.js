(async () => {
  const vp = document.getElementById('vp');
  const view = new MapView(vp);
  const popup = document.getElementById('popup');
  const NS = 'http://www.w3.org/2000/svg';
  const names = { green: 'Groen', red: 'Rood' };

  const data = await (await fetch('/api/map')).json();
  document.getElementById('title').textContent = data.title;
  document.title = data.title;
  if (!data.map) { document.getElementById('empty').hidden = false; return; }
  await view.setMap(data.map);

  for (const h of data.houses) {
    if (h.status === 'none') continue;
    const p = view.polygon(h, `house ${h.status}`);
    p.dataset.id = h.id;
    view.svg.append(p);
  }
  popup.querySelector('.close').onclick = () => (popup.hidden = true);
  view.on('tap', (e) => {
    const el = view.houseAt(e);
    const h = el && data.houses.find((x) => x.id === el.dataset.id);
    if (!h) { popup.hidden = true; return; }
    popup.querySelector('h3').textContent = h.label || 'Huis';
    popup.querySelector('p').textContent = [names[h.status], h.note].filter(Boolean).join(' · ');
    popup.hidden = false;
  });
  document.getElementById('zin').onclick = () => view.zoomCenter(1.5);
  document.getElementById('zout').onclick = () => view.zoomCenter(1 / 1.5);
  document.getElementById('zfit').onclick = () => { view.userMoved = false; view.fit(); };
})();
