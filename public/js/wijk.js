// Gedeelde code voor publieke pagina en beheer: Leaflet-kaart (OpenStreetMap) en PDF-export.
(function () {
  const STATUS = {
    green: { color: '#1f9d55', stroke: '#0f6b36', name: 'Groen' },
    red: { color: '#d93a3a', stroke: '#8f1f1f', name: 'Rood' },
    none: { color: '#888888', stroke: '#555555', name: 'Geen' },
  };
  const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>-bijdragers';
  const DEFAULT_VIEW = { center: [52.1, 5.3], zoom: 8 };

  function createMap(el, view, houses) {
    const map = L.map(el, { maxZoom: 19, zoomSnap: 0.25 });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map);
    if (view) map.setView(view.center, view.zoom);
    else if (houses && houses.length) map.fitBounds(L.latLngBounds(houses.flatMap((h) => h.points)).pad(0.2));
    else map.setView(DEFAULT_VIEW.center, DEFAULT_VIEW.zoom);
    return map;
  }

  function houseStyle(status, selected) {
    const s = STATUS[status] || STATUS.none;
    return {
      color: selected ? '#ffffff' : s.stroke,
      weight: selected ? 4 : 2,
      fillColor: s.color,
      fillOpacity: status === 'none' ? 0.15 : 0.55,
      dashArray: status === 'none' ? '5 4' : null,
    };
  }

  // ---------- PDF ----------
  const TILE = 256;
  const worldPx = (z) => TILE * 2 ** z;
  function project([lat, lng], z) {
    const n = worldPx(z);
    const s = Math.sin((lat * Math.PI) / 180);
    return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }

  function loadTile(z, x, y) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    });
  }

  // Tekent de kaart (tegels + huizen) op een canvas dat het gebied van alle huizen toont.
  async function renderMapCanvas(houses, view, W, H) {
    const pts = houses.flatMap((h) => h.points);
    let center, z;
    if (pts.length) {
      const lats = pts.map((p) => p[0]), lngs = pts.map((p) => p[1]);
      const sw = [Math.min(...lats), Math.min(...lngs)], ne = [Math.max(...lats), Math.max(...lngs)];
      const pad = 0.12;
      for (z = 19; z > 1; z--) {
        const a = project(sw, z), b = project(ne, z);
        if (Math.abs(b[0] - a[0]) <= W * (1 - 2 * pad) && Math.abs(a[1] - b[1]) <= H * (1 - 2 * pad)) break;
      }
      center = [(sw[0] + ne[0]) / 2, (sw[1] + ne[1]) / 2];
    } else {
      const v = view || DEFAULT_VIEW;
      center = v.center; z = Math.min(19, Math.max(1, Math.round(v.zoom)));
    }
    const [cx, cy] = project(center, z);
    const left = cx - W / 2, top = cy - H / 2;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#e5e5e5'; g.fillRect(0, 0, W, H);

    const n = 2 ** z, jobs = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        jobs.push(loadTile(z, ((tx % n) + n) % n, ty).then((img) => img && g.drawImage(img, tx * TILE - left, ty * TILE - top)));
      }
    }
    await Promise.all(jobs);

    const px = (p) => { const [x, y] = project(p, z); return [x - left, y - top]; };
    const scale = W / 1600;
    for (const h of houses) {
      const st = STATUS[h.status] || STATUS.none;
      if (h.status === 'none') continue;
      g.beginPath();
      h.points.map(px).forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
      g.closePath();
      g.globalAlpha = 0.55; g.fillStyle = st.color; g.fill();
      g.globalAlpha = 1; g.lineWidth = 2 * scale; g.strokeStyle = st.stroke; g.stroke();
    }
    g.font = `bold ${Math.round(13 * scale)}px sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 4 * scale;
    for (const h of houses) {
      if (!h.label || h.status === 'none') continue;
      const ps = h.points.map(px);
      const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
      const w = Math.max(...xs) - Math.min(...xs);
      if (w < g.measureText(h.label).width * 0.8) continue; // past niet in het huis
      const x = (Math.max(...xs) + Math.min(...xs)) / 2, y = (Math.max(...ys) + Math.min(...ys)) / 2;
      g.strokeStyle = '#fff'; g.strokeText(h.label, x, y);
      g.fillStyle = '#111'; g.fillText(h.label, x, y);
    }
    // verplichte bronvermelding
    g.font = `${Math.round(12 * scale)}px sans-serif`;
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    const txt = '© OpenStreetMap-bijdragers';
    const tw = g.measureText(txt).width;
    g.fillStyle = 'rgba(255,255,255,.8)'; g.fillRect(W - tw - 16 * scale, H - 22 * scale, tw + 16 * scale, 22 * scale);
    g.fillStyle = '#333'; g.fillText(txt, W - 8 * scale, H - 5 * scale);
    return canvas;
  }

  async function buildPdf({ title, houses, view }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = 297, margin = 10;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text(title, margin, 14);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Stand van ${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`, pw - margin, 14, { align: 'right' });
    doc.setTextColor(0);

    const mapW = pw - 2 * margin, mapH = 168;
    const canvas = await renderMapCanvas(houses, view, 2000, Math.round(2000 * mapH / mapW));
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, 18, mapW, mapH);
    doc.setDrawColor(150); doc.rect(margin, 18, mapW, mapH);

    // legenda
    const counts = { green: 0, red: 0 };
    houses.forEach((h) => { if (counts[h.status] !== undefined) counts[h.status]++; });
    let x = margin;
    for (const k of ['green', 'red']) {
      const c = STATUS[k].color;
      doc.setFillColor(c); doc.circle(x + 2, 193.5, 2, 'F');
      doc.setFontSize(10);
      doc.text(`${STATUS[k].name} (${counts[k]})`, x + 6, 195);
      x += 40;
    }

    // lijst met huizen op volgende pagina('s)
    const named = houses.filter((h) => h.label && h.status !== 'none')
      .sort((a, b) => a.label.localeCompare(b.label, 'nl', { numeric: true }));
    if (named.length) {
      doc.addPage();
      doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
      doc.text(`${title} – overzicht`, margin, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      let y = 24;
      const colW = 90;
      let col = 0;
      for (const h of named) {
        if (y > 195) { col++; y = 24; if (col > 2) { doc.addPage(); col = 0; } }
        const cx = margin + col * colW;
        doc.setFillColor(STATUS[h.status].color); doc.circle(cx + 2, y - 1, 1.8, 'F');
        const line = doc.splitTextToSize(h.note ? `${h.label} – ${h.note}` : h.label, colW - 10)[0];
        doc.text(line, cx + 6, y);
        y += 6;
      }
    }
    return doc;
  }

  window.Wijk = { STATUS, createMap, houseStyle, buildPdf, DEFAULT_VIEW };
})();
