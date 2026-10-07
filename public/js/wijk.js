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
    const map = L.map(el, {
      minZoom: view?.minZoom ?? 1,
      maxZoom: view?.maxZoom ?? 19,
      zoomSnap: 0.25,
      bounceAtZoomLimits: false,
    });
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

  // Bepaalt welk kaartvlak (midden, zoom) de PDF toont: het gebied van alle huizen.
  function pdfFrame(houses, view, W, H) {
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
    return { center, z, left: cx - W / 2, top: cy - H / 2 };
  }

  function frameTiles({ z, left, top }, W, H) {
    const n = 2 ** z, out = [];
    for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + W) / TILE); tx++) {
      for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + H) / TILE); ty++) {
        if (ty >= 0 && ty < n) out.push({ z, x: ((tx % n) + n) % n, y: ty, tx, ty });
      }
    }
    return out;
  }

  const PDF_W = 2000;
  const MAP_MM = { w: 277, h: 168 };
  const pdfH = () => Math.round((PDF_W * MAP_MM.h) / MAP_MM.w);

  // Haalt de tegels voor de PDF en de omgeving alvast op, zodat de kaart ook offline werkt
  // (de service worker bewaart ze). Bewust beperkt om OpenStreetMap niet te belasten.
  async function prefetchTiles(houses, view) {
    if (!navigator.onLine || !navigator.serviceWorker?.controller) return;
    const H = pdfH();
    const frame = pdfFrame(houses, view, PDF_W, H);
    const list = frameTiles(frame, PDF_W, H);
    // uitzoomen: dezelfde omgeving op lagere zoomniveaus (max. 3 niveaus)
    for (let dz = 1; dz <= 3 && frame.z - dz >= 12; dz++) {
      const f = 2 ** dz;
      list.push(...frameTiles({ z: frame.z - dz, left: frame.left / f, top: frame.top / f }, PDF_W / f, H / f));
    }
    const seen = new Set();
    const urls = list.map((t) => TILE_URL.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y))
      .filter((u) => !seen.has(u) && seen.add(u)).slice(0, 250);
    const key = `sm-prefetch:${urls.length}:${urls[0]}`;
    try { if (localStorage.getItem(key)) return; } catch {}
    let i = 0;
    const worker = async () => {
      while (i < urls.length) {
        const u = urls[i++];
        try { await fetch(u, { mode: 'cors', credentials: 'omit' }); } catch {}
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    try { localStorage.setItem(key, '1'); } catch {}
  }

  // Tekent de kaart (tegels + huizen) op een canvas dat het gebied van alle huizen toont.
  async function renderMapCanvas(houses, view, W, H) {
    const frame = pdfFrame(houses, view, W, H);
    const { z, left, top } = frame;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const g = canvas.getContext('2d');
    g.fillStyle = '#e5e5e5'; g.fillRect(0, 0, W, H);

    const jobs = frameTiles(frame, W, H).map((t) =>
      loadTile(t.z, t.x, t.y).then((img) => img && g.drawImage(img, t.tx * TILE - left, t.ty * TILE - top)));
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

  // Logo laden als data-URL (voor jsPDF) met afmetingen.
  function loadLogo(url) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        const jpeg = /\.jpe?g$/i.test(url);
        if (jpeg) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(img, 0, 0);
        resolve({ data: c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.92), format: jpeg ? 'JPEG' : 'PNG', w: c.width, h: c.height });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // ---------- tekst met emoji in de PDF ----------
  // De standaardlettertypen van jsPDF kennen geen emoji (en geen tekens buiten WinAnsi). Zulke tekens
  // tekenen we als plaatje via een canvas, met het emoji-lettertype van het apparaat zelf.
  const WINANSI_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
  const isWinAnsi = (ch) => {
    const c = ch.codePointAt(0);
    return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WINANSI_EXTRA.includes(ch);
  };
  const EMOJI_RE = /(\p{Regional_Indicator}{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|[\u{1F3FB}-\u{1F3FF}]|‍\p{Extended_Pictographic})*️?)/u;
  const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Twemoji Mozilla",sans-serif';
  const PT_MM = 25.4 / 72;

  function tokenize(para) {
    const out = [];
    const pushText = (str) => {
      let run = '';
      const flush = () => { if (run) { run.split(/(\s+)/).filter(Boolean).forEach((w) => out.push({ t: 'text', s: w })); run = ''; } };
      for (const ch of str) {
        if (isWinAnsi(ch) || /\s/.test(ch)) run += ch;
        else if (/[‍️̀-ͯ]/.test(ch)) continue; // losse combinatietekens overslaan
        else { flush(); out.push({ t: 'glyph', s: ch, emoji: false }); }
      }
      flush();
    };
    para.split(EMOJI_RE).forEach((part, i) => {
      if (!part) return;
      if (i % 2 === 1 && !(part.length <= 2 && isWinAnsi(part[0]) && [...part].length === 1)) out.push({ t: 'glyph', s: part, emoji: true });
      else pushText(part); // ©, ® e.d. blijven gewone tekst
    });
    return out;
  }

  const glyphCache = new Map();
  function glyphImage(str, emoji) {
    if (glyphCache.has(str)) return glyphCache.get(str);
    const SIZE = 192;
    const c = document.createElement('canvas');
    c.width = SIZE; c.height = SIZE;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.font = `128px ${emoji ? EMOJI_FONT : 'sans-serif'}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#000';
    g.fillText(str, SIZE / 2, SIZE / 2 + 6);
    const px = g.getImageData(0, 0, SIZE, SIZE).data;
    let ink = false;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 8) { ink = true; break; }
    const img = ink ? { data: c.toDataURL('image/png'), alias: `g-${[...str].map((ch) => ch.codePointAt(0).toString(16)).join('-')}` } : null;
    glyphCache.set(str, img);
    return img;
  }

  // Breekt tekst (met \n en emoji) af op maxW mm; geeft regels met tokens terug.
  function layoutRich(doc, text, maxW, sizePt) {
    const em = sizePt * PT_MM, gw = em * 1.3;
    const lines = [];
    for (const para of String(text).split('\n')) {
      let line = [], w = 0;
      const push = () => {
        while (line.length && line[line.length - 1].t === 'text' && /^\s+$/.test(line[line.length - 1].s)) w -= line.pop().w;
        lines.push({ tokens: line, w });
        line = []; w = 0;
      };
      for (const tok of tokenize(para)) {
        tok.w = tok.t === 'glyph' ? gw : doc.getTextWidth(tok.s);
        const space = tok.t === 'text' && /^\s+$/.test(tok.s);
        if (space && !line.length) continue;
        if (!space && w + tok.w > maxW && line.length) push();
        if (tok.t === 'text' && tok.w > maxW) { // een woord dat nooit past: teken voor teken afbreken
          let piece = '';
          for (const ch of tok.s) {
            if (doc.getTextWidth(piece + ch) > maxW - w && piece) { line.push({ t: 'text', s: piece, w: doc.getTextWidth(piece) }); w += doc.getTextWidth(piece); push(); piece = ''; }
            piece += ch;
          }
          if (piece) { const pw = doc.getTextWidth(piece); line.push({ t: 'text', s: piece, w: pw }); w += pw; }
          continue;
        }
        line.push(tok); w += tok.w;
      }
      push();
    }
    return lines;
  }

  function drawRichLine(doc, line, x, y, sizePt) {
    const em = sizePt * PT_MM;
    let cx = x;
    for (const tok of line.tokens) {
      if (tok.t === 'glyph') {
        const img = glyphImage(tok.s, tok.emoji);
        if (img) {
          const size = em * 1.5; // het plaatje is 1,5x de letterhoogte (ruimte rond het teken)
          doc.addImage(img.data, 'PNG', cx + tok.w / 2 - size / 2, y - em * 0.35 - size / 2, size, size, img.alias);
        }
      } else {
        doc.text(tok.s, cx, y);
      }
      cx += tok.w;
    }
  }

  // Eén regel tekst (zonder afbreken), bv. koppen en de overzichtsregels.
  function richText(doc, text, x, y, sizePt, maxW = Infinity) {
    const [first] = layoutRich(doc, text, maxW, sizePt);
    if (first) drawRichLine(doc, first, x, y, sizePt);
  }

  async function buildPdf({ title, houses, view, intro, logo }) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const pw = 297, ph = 210, margin = 10;
    const logoImg = logo ? await loadLogo(logo.url) : null;

    const header = (text, size) => {
      let x = margin;
      if (logoImg) {
        const maxH = 14, maxW = 45;
        const k = Math.min(maxH / logoImg.h, maxW / logoImg.w);
        const w = logoImg.w * k, h = logoImg.h * k;
        doc.addImage(logoImg.data, logoImg.format, margin, 16 - h, w, h);
        x += w + 4;
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(size); doc.setTextColor(0);
      richText(doc, text, x, 14, size);
    };

    header(title, 18);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Stand van ${new Date().toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })}`, pw - margin, 14, { align: 'right' });
    doc.setTextColor(0);

    const mapW = pw - 2 * margin, mapH = (mapW * MAP_MM.h) / MAP_MM.w;
    const canvas = await renderMapCanvas(houses, view, PDF_W, pdfH());
    doc.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', margin, 20, mapW, mapH);
    doc.setDrawColor(150); doc.rect(margin, 20, mapW, mapH);

    // legenda
    const counts = { green: 0, red: 0 };
    houses.forEach((h) => { if (counts[h.status] !== undefined) counts[h.status]++; });
    let x = margin;
    const ly = 20 + mapH + 7;
    for (const k of ['green', 'red']) {
      doc.setFillColor(STATUS[k].color); doc.circle(x + 2, ly - 1.5, 2, 'F');
      doc.setFontSize(10);
      doc.text(`${STATUS[k].name} (${counts[k]})`, x + 6, ly);
      x += 40;
    }

    // tweede pagina: toelichting en overzicht van de huizen
    const named = houses.filter((h) => h.label && h.status !== 'none')
      .sort((a, b) => a.label.localeCompare(b.label, 'nl', { numeric: true }));
    let y = 0;
    const newPage = (text) => { doc.addPage(); header(text, 14); y = 26; };
    const room = (need) => { if (y + need > ph - margin) { newPage(`${title} – vervolg`); } };

    if (intro) {
      newPage(`${title} – toelichting`);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(0);
      for (const line of layoutRich(doc, intro, pw - 2 * margin, 11)) {
        room(6);
        drawRichLine(doc, line, margin, y, 11);
        y += 5.6;
      }
      y += 6;
    }
    if (named.length) {
      if (!intro) newPage(`${title} – overzicht`);
      else { room(20); doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.text('Overzicht', margin, y); y += 8; }
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      const colW = 90, top = y;
      let col = 0;
      for (const h of named) {
        if (y > ph - margin) { col++; y = top; if (col > 2) { newPage(`${title} – overzicht`); col = 0; } }
        const cx = margin + col * colW;
        doc.setFillColor(STATUS[h.status].color); doc.circle(cx + 2, y - 1, 1.8, 'F');
        richText(doc, h.note ? `${h.label} – ${h.note}` : h.label, cx + 6, y, 10, colW - 10);
        y += 6;
      }
    }
    return doc;
  }

  // Alleen de kaart mag zoomen met pinch; de pagina/app zelf niet (iOS Safari negeert user-scalable=no).
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((ev) =>
    document.addEventListener(ev, (e) => e.preventDefault(), { passive: false }));

  window.Wijk = { STATUS, createMap, houseStyle, buildPdf, prefetchTiles, DEFAULT_VIEW };
})();
