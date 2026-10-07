(() => {
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const show = (id) => {
    for (const v of ['v-setup', 'v-login', 'v-edit']) $(v).classList.toggle('hidden', v !== id);
  };

  async function api(url, opts = {}) {
    const res = await fetch(url, {
      credentials: 'same-origin',
      ...opts,
      headers: opts.body && typeof opts.body === 'string' ? { 'Content-Type': 'application/json', ...opts.headers } : opts.headers,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && opts.expectAuth) { boot(); }
      throw new Error(data.error || `Fout ${res.status}`);
    }
    return data;
  }
  const post = (url, body, extra) => api(url, { method: 'POST', body: JSON.stringify(body || {}), ...extra });

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.append(t);
    setTimeout(() => t.remove(), 2500);
  }

  const friendly = (err) =>
    err && err.name === 'NotAllowedError' ? 'Geannuleerd of niet toegestaan door het apparaat.' : err.message;

  // ---------- passkey flows ----------
  async function registerPasskey({ setupToken, name }) {
    const { challengeId, options } = await post('/api/auth/register/options', { setupToken, name });
    const response = await SimpleWebAuthnBrowser.startRegistration({ optionsJSON: options });
    await post('/api/auth/register/verify', { challengeId, response });
  }

  async function login() {
    const { challengeId, options } = await post('/api/auth/login/options');
    const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    await post('/api/auth/login/verify', { challengeId, response });
  }

  $('s-go').onclick = async () => {
    $('s-err').textContent = '';
    try {
      if (!window.PublicKeyCredential) throw new Error('Deze browser ondersteunt geen passkeys (HTTPS is vereist).');
      await registerPasskey({ setupToken: $('s-token').value, name: $('s-name').value });
      boot();
    } catch (e) { $('s-err').textContent = friendly(e); }
  };
  $('l-go').onclick = async () => {
    $('l-err').textContent = '';
    try { await login(); boot(); } catch (e) { $('l-err').textContent = friendly(e); }
  };
  $('logout').onclick = async () => {
    if (dirty && !confirm('Er zijn niet-opgeslagen wijzigingen. Toch uitloggen?')) return;
    dirty = false;
    await post('/api/auth/logout');
    location.reload();
  };

  // ---------- passkeys dialoog ----------
  async function renderPasskeys() {
    const list = await api('/api/admin/passkeys');
    $('pk-list').innerHTML = '';
    for (const p of list) {
      const row = document.createElement('div');
      row.className = 'pk';
      const s = document.createElement('span');
      s.textContent = `${p.name} · ${new Date(p.createdAt).toLocaleDateString('nl-NL')}`;
      const del = document.createElement('button');
      del.className = 'danger'; del.textContent = 'Verwijder'; del.disabled = list.length < 2;
      del.onclick = async () => {
        if (!confirm(`Passkey "${p.name}" verwijderen?`)) return;
        try { await api(`/api/admin/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); renderPasskeys(); }
        catch (e) { $('pk-err').textContent = e.message; }
      };
      row.append(s, del);
      $('pk-list').append(row);
    }
  }
  $('pk-open').onclick = () => { $('pk-err').textContent = ''; renderPasskeys(); $('pk-dialog').showModal(); };
  $('pk-close').onclick = () => $('pk-dialog').close();
  $('pk-add').onclick = async () => {
    $('pk-err').textContent = '';
    try { await registerPasskey({ name: $('pk-name').value }); renderPasskeys(); toast('Passkey toegevoegd'); }
    catch (e) { $('pk-err').textContent = friendly(e); }
  };

  // ---------- editor ----------
  let view, houses = [], map = null;
  let selectedId = null, mode = 'select', newStatus = 'green', draft = [], dirty = false;
  const uid = () => Math.random().toString(36).slice(2, 10);

  function setDirty(v = true) {
    dirty = v;
    $('dirty').textContent = v ? '● Niet opgeslagen' : '';
  }
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  const selected = () => houses.find((h) => h.id === selectedId);
  const nameOf = (h, i) => h.label || `Huis ${i + 1}`;

  function hint() {
    $('hint').textContent = mode === 'draw'
      ? (draft.length
        ? `${draft.length} punt(en). Klik de hoekpunten van het huis; sluit af door op het gele beginpunt te klikken, dubbel te klikken of Enter te drukken. Backspace = laatste punt weg, Esc = annuleren.`
        : 'Klik op de hoeken van een huis om er een vlak overheen te leggen. Slepen verplaatst de kaart, scrollen zoomt.')
      : 'Klik op een huis om het te selecteren. Sleep de witte punten om de vorm aan te passen. Sneltoetsen: G = groen, R = rood, Delete = verwijderen.';
  }

  function handle(h, idx) {
    const r = 7 / view.s;
    const [x, y] = h.points[idx];
    const c = document.createElementNS(NS, 'circle');
    c.setAttribute('class', 'handle');
    c.setAttribute('r', r);
    c.setAttribute('cx', x * view.W);
    c.setAttribute('cy', y * view.H);
    c.dataset.noPan = '1';
    return c;
  }

  function render() {
    if (!view || !map) return;
    view.svg.replaceChildren();
    for (const h of houses) {
      const p = view.polygon(h, `house ${h.status}${h.id === selectedId ? ' selected' : ''}`);
      p.dataset.id = h.id;
      view.svg.append(p);
    }
    const sel = selected();
    if (sel && mode === 'select') {
      sel.points.forEach((_, i) => {
        const c = handle(sel, i);
        c.addEventListener('pointerdown', (e) => startDrag(e, sel, i, c));
        view.svg.append(c);
      });
    }
    if (draft.length) {
      const pl = document.createElementNS(NS, draft.length > 2 ? 'polygon' : 'polyline');
      pl.setAttribute('class', 'draft');
      pl.setAttribute('fill', draft.length > 2 ? '' : 'none');
      pl.setAttribute('points', draft.map(([x, y]) => `${x * view.W},${y * view.H}`).join(' '));
      view.svg.append(pl);
      draft.forEach(([x, y], i) => {
        const c = document.createElementNS(NS, 'circle');
        c.setAttribute('class', `handle${i === 0 ? ' first' : ''}`);
        c.setAttribute('r', (i === 0 ? 9 : 5) / view.s);
        c.setAttribute('cx', x * view.W);
        c.setAttribute('cy', y * view.H);
        c.style.pointerEvents = 'none';
        view.svg.append(c);
      });
    }
    renderPanel();
  }

  function startDrag(e, house, idx, circle) {
    e.stopPropagation();
    circle.setPointerCapture(e.pointerId);
    const poly = view.svg.querySelector(`polygon[data-id="${house.id}"]`);
    const move = (ev) => {
      const [fx, fy] = view.toFraction(ev.clientX, ev.clientY);
      const x = Math.min(1, Math.max(0, fx)), y = Math.min(1, Math.max(0, fy));
      house.points[idx] = [x, y];
      circle.setAttribute('cx', x * view.W);
      circle.setAttribute('cy', y * view.H);
      poly.setAttribute('points', house.points.map(([a, b]) => `${a * view.W},${b * view.H}`).join(' '));
      setDirty();
    };
    circle.addEventListener('pointermove', move);
    const up = () => { circle.removeEventListener('pointermove', move); circle.removeEventListener('pointerup', up); };
    circle.addEventListener('pointerup', up);
  }

  function renderPanel() {
    const sel = selected();
    $('props').classList.toggle('hidden', !sel);
    if (sel) {
      if (document.activeElement !== $('p-label')) $('p-label').value = sel.label;
      if (document.activeElement !== $('p-note')) $('p-note').value = sel.note;
      document.querySelectorAll('#p-status button').forEach((b) => b.classList.toggle('active', b.dataset.status === sel.status));
    }
    $('count').textContent = houses.length;
    $('list').replaceChildren(...houses.map((h, i) => {
      const d = document.createElement('div');
      d.className = h.id === selectedId ? 'sel' : '';
      d.innerHTML = `<i class="dot ${h.status}"></i>`;
      d.append(nameOf(h, i));
      d.onclick = () => { setMode('select'); select(h.id); };
      return d;
    }));
    hint();
  }

  function select(id) { selectedId = id; render(); }

  function setMode(m) {
    mode = m;
    draft = [];
    $('t-select').classList.toggle('active', m === 'select');
    $('t-draw').classList.toggle('active', m === 'draw');
    $('vp').classList.toggle('drawing', m === 'draw');
    if (m === 'draw') selectedId = null;
    render();
  }

  function finishDraft() {
    if (draft.length < 3) { toast('Een huis heeft minstens 3 punten nodig'); return; }
    const h = { id: uid(), label: '', note: '', status: newStatus, points: draft };
    houses.push(h);
    draft = [];
    selectedId = h.id;
    setDirty();
    render();
    if (matchMedia('(pointer: fine)').matches) $('p-label').focus();
  }

  function onTap(e) {
    if (!map) return;
    if (mode === 'draw') {
      const [x, y] = view.toFraction(e.clientX, e.clientY);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      const px = (a, b) => Math.hypot((a[0] - b[0]) * view.W * view.s, (a[1] - b[1]) * view.H * view.s);
      if (draft.length >= 3 && px(draft[0], [x, y]) < 14) return finishDraft();
      if (draft.length && px(draft[draft.length - 1], [x, y]) < 3) return; // dubbele klik
      draft.push([x, y]);
      render();
    } else {
      const el = view.houseAt(e);
      select(el ? el.dataset.id : null);
    }
  }

  async function save() {
    try {
      const res = await api('/api/admin/houses', { method: 'PUT', body: JSON.stringify({ houses }), expectAuth: true });
      houses = res.houses;
      setDirty(false);
      render();
      toast('Opgeslagen ✔');
    } catch (e) { toast(e.message); }
  }

  async function upload(file) {
    const url = URL.createObjectURL(file);
    try {
      const dim = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
        i.onerror = () => reject(new Error('Dit bestand is geen geldige afbeelding'));
        i.src = url;
      });
      if (houses.length && !confirm('Een nieuwe kaart vervangen? De getekende huizen blijven op dezelfde relatieve plek staan, dus gebruik een kaart met dezelfde uitsnede.')) return;
      const res = await api(`/api/admin/map?width=${dim.w}&height=${dim.h}`, {
        method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' }, expectAuth: true,
      });
      map = res.map;
      $('empty').hidden = true;
      await view.setMap(map);
      render();
      toast('Kaart geüpload');
    } catch (e) { toast(e.message); }
    finally { URL.revokeObjectURL(url); }
  }

  function initEditor() {
    if (view) return;
    view = new MapView($('vp'));
    view.on('tap', onTap);
    let lastS = 0;
    view.on('view', (sc) => { if (sc !== lastS) { lastS = sc; render(); } });
    $('vp').addEventListener('dblclick', () => { if (mode === 'draw' && draft.length >= 3) finishDraft(); });

    $('t-select').onclick = () => setMode('select');
    $('t-draw').onclick = () => setMode('draw');
    document.querySelectorAll('[data-newstatus]').forEach((b) => b.onclick = () => {
      newStatus = b.dataset.newstatus;
      document.querySelectorAll('[data-newstatus]').forEach((x) => x.classList.toggle('active', x === b));
    });
    document.querySelectorAll('#p-status button').forEach((b) => b.onclick = () => setStatus(b.dataset.status));
    $('p-label').oninput = () => { const s = selected(); if (s) { s.label = $('p-label').value; setDirty(); renderListOnly(); } };
    $('p-note').oninput = () => { const s = selected(); if (s) { s.note = $('p-note').value; setDirty(); } };
    $('p-del').onclick = deleteSelected;
    $('save').onclick = save;
    $('upload').onclick = () => $('file').click();
    $('file').onchange = () => { if ($('file').files[0]) upload($('file').files[0]); $('file').value = ''; };
    $('zin').onclick = () => view.zoomCenter(1.5);
    $('zout').onclick = () => view.zoomCenter(1 / 1.5);
    $('zfit').onclick = () => { view.userMoved = false; view.fit(); };

    document.addEventListener('keydown', (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && e.key !== 'Escape') return;
      if ($('pk-dialog').open) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); }
      else if (k === 'g' && selected()) setStatus('green');
      else if (k === 'r' && selected()) setStatus('red');
      else if (k === 'd') setMode(mode === 'draw' ? 'select' : 'draw');
      else if ((k === 'delete') && selected()) deleteSelected();
      else if (k === 'enter' && mode === 'draw') finishDraft();
      else if (k === 'backspace' && mode === 'draw') { e.preventDefault(); draft.pop(); render(); }
      else if (k === 'escape') { document.activeElement.blur(); if (draft.length) { draft = []; render(); } else select(null); }
    });
  }

  function renderListOnly() {
    const sel = selected();
    $('list').children[houses.indexOf(sel)].lastChild.textContent = nameOf(sel, houses.indexOf(sel));
  }
  function setStatus(s) { const h = selected(); if (!h) return; h.status = s; setDirty(); render(); }
  function deleteSelected() {
    const h = selected();
    if (!h || !confirm(`"${nameOf(h, houses.indexOf(h))}" verwijderen?`)) return;
    houses = houses.filter((x) => x !== h);
    selectedId = null; setDirty(); render();
  }

  async function openEditor() {
    show('v-edit');
    initEditor();
    const data = await api('/api/map');
    houses = data.houses; map = data.map;
    $('empty').hidden = !!map;
    await view.setMap(map);
    setDirty(false);
    setMode('select');
  }

  async function boot() {
    const st = await api('/api/auth/status');
    if (st.loggedIn) return openEditor();
    show(st.configured ? 'v-login' : 'v-setup');
  }
  boot().catch((e) => { document.body.textContent = e.message; });
})();
