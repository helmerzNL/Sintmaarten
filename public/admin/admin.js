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

  // ---------- logo & uitleg ----------
  let org = { intro: '', logo: null };
  function renderOrg() {
    $('org-logo').hidden = !org.logo;
    if (org.logo) $('org-logo').src = org.logo.url;
    $('org-remove').disabled = !org.logo;
    $('org-count').textContent = $('org-intro').value.length;
  }
  $('org-open').onclick = () => {
    $('org-err').textContent = '';
    $('org-intro').value = org.intro;
    renderOrg();
    $('org-dialog').showModal();
  };
  $('org-close').onclick = () => $('org-dialog').close();
  $('org-intro').oninput = renderOrg;
  $('org-upload').onclick = () => $('org-file').click();
  $('org-file').onchange = async () => {
    const f = $('org-file').files[0];
    $('org-file').value = '';
    if (!f) return;
    $('org-err').textContent = '';
    try {
      const res = await api('/api/admin/logo', { method: 'POST', body: f, headers: { 'Content-Type': 'application/octet-stream' }, expectAuth: true });
      org.logo = res.logo;
      renderOrg();
      toast('Logo geüpload ✔');
    } catch (e) { $('org-err').textContent = e.message; }
  };
  $('org-remove').onclick = async () => {
    if (!confirm('Logo verwijderen?')) return;
    try { await api('/api/admin/logo', { method: 'DELETE', expectAuth: true }); org.logo = null; renderOrg(); }
    catch (e) { $('org-err').textContent = e.message; }
  };
  $('org-save').onclick = async () => {
    $('org-err').textContent = '';
    try {
      const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ intro: $('org-intro').value }), expectAuth: true });
      org.intro = res.intro;
      $('org-dialog').close();
      toast('Uitleg opgeslagen ✔');
    } catch (e) { $('org-err').textContent = e.message; }
  };

  // ---------- editor ----------
  let map, houses = [], layers = new Map(); // id -> L.polygon
  let selectedId = null, mode = 'select', newStatus = 'green', draft = [], dirty = false;
  let handles = [], draftLayer = null;
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
        : 'Zoom ver in en klik op de hoeken van een huis om er een vlak overheen te leggen. Slepen verplaatst de kaart.')
      : 'Klik op een huis om het te selecteren. Sleep de witte punten om de vorm aan te passen. Sneltoetsen: G = groen, R = rood, Delete = verwijderen.';
  }

  function syncPolygons() {
    for (const [id, l] of layers) if (!houses.find((h) => h.id === id)) { l.remove(); layers.delete(id); }
    for (const h of houses) {
      let l = layers.get(h.id);
      if (!l) {
        l = L.polygon(h.points, {}).addTo(map);
        l.on('click', (e) => {
          if (mode !== 'select') return;
          L.DomEvent.stopPropagation(e);
          select(h.id);
        });
        layers.set(h.id, l);
      }
      l.setStyle(Wijk.houseStyle(h.status, h.id === selectedId));
      if (h.id === selectedId) l.bringToFront();
    }
  }

  function syncHandles() {
    handles.forEach((m) => m.remove());
    handles = [];
    const sel = selected();
    if (!sel || mode !== 'select') return;
    sel.points.forEach((pt, i) => {
      const m = L.marker(pt, {
        draggable: true,
        icon: L.divIcon({ className: 'vhandle', iconSize: [16, 16] }),
      }).addTo(map);
      m.on('drag', () => {
        const ll = m.getLatLng();
        sel.points[i] = [ll.lat, ll.lng];
        layers.get(sel.id).setLatLngs(sel.points);
        setDirty();
      });
      handles.push(m);
    });
  }

  function syncDraft() {
    if (draftLayer) { draftLayer.remove(); draftLayer = null; }
    if (!draft.length) return;
    draftLayer = L.layerGroup().addTo(map);
    const shape = draft.length > 2 ? L.polygon : L.polyline;
    shape(draft, { color: '#e0a800', fillColor: '#ffd34d', fillOpacity: 0.3, weight: 2, interactive: false }).addTo(draftLayer);
    draft.forEach((pt, i) => {
      const c = L.circleMarker(pt, { radius: i === 0 ? 8 : 4, color: '#222', weight: 1.5, fillColor: i === 0 ? '#ffd34d' : '#fff', fillOpacity: 1, interactive: i === 0 && draft.length >= 3 });
      if (i === 0) c.on('click', (e) => { L.DomEvent.stopPropagation(e); finishDraft(); });
      c.addTo(draftLayer);
    });
  }

  function render() {
    syncPolygons(); syncHandles(); syncDraft(); renderPanel();
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
      d.onclick = () => { setMode('select'); select(h.id); map.fitBounds(L.latLngBounds(h.points).pad(1.5), { maxZoom: 19 }); };
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
    if (m === 'draw') { selectedId = null; map.doubleClickZoom.disable(); } else map.doubleClickZoom.enable();
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

  function onMapClick(e) {
    if (mode === 'draw') {
      const last = draft[draft.length - 1];
      if (last && map.latLngToContainerPoint(e.latlng).distanceTo(map.latLngToContainerPoint(last)) < 3) return; // dubbelklik
      draft.push([e.latlng.lat, e.latlng.lng]);
      render();
    } else {
      select(null);
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

  // ---------- kaartweergave ----------
  let savedView = null;
  const num = (id) => Number(String($(id).value).replace(',', '.'));
  function fillView(v) {
    $('v-lat').value = v.center[0];
    $('v-lng').value = v.center[1];
    $('v-zoom').value = v.zoom;
    $('v-min').value = v.minZoom ?? 1;
    $('v-max').value = v.maxZoom ?? 19;
  }
  const grabView = () => {
    const c = map.getCenter();
    $('v-lat').value = Math.round(c.lat * 1e6) / 1e6;
    $('v-lng').value = Math.round(c.lng * 1e6) / 1e6;
    $('v-zoom').value = Math.round(map.getZoom() * 4) / 4;
  };
  const readView = () => ({ center: [num('v-lat'), num('v-lng')], zoom: num('v-zoom'), minZoom: num('v-min'), maxZoom: num('v-max') });
  function updateNow() {
    $('v-now').textContent = `Kaart nu: zoom ${map.getZoom()} · ${savedView ? 'startweergave is ingesteld' : 'geen startweergave: de site toont automatisch alle huizen'}`;
  }

  function wireView() {
    $('view-open').onclick = () => {
      $('v-err').textContent = '';
      if (savedView) fillView(savedView); else { fillView({ center: [0, 0], zoom: 17 }); grabView(); }
      updateNow();
      $('view-dialog').showModal();
    };
    $('view-grab').onclick = () => { grabView(); updateNow(); };
    $('v-close').onclick = () => $('view-dialog').close();
    $('v-apply').onclick = () => {
      const v = readView();
      if (v.center.every(Number.isFinite) && Number.isFinite(v.zoom)) map.setView(v.center, Math.min(19, Math.max(1, v.zoom)));
      updateNow();
    };
    $('v-save').onclick = async () => {
      $('v-err').textContent = '';
      try {
        const res = await api('/api/admin/view', { method: 'PUT', body: JSON.stringify(readView()), expectAuth: true });
        savedView = res.view;
        $('view-dialog').close();
        toast('Kaartweergave opgeslagen ✔');
      } catch (e) { $('v-err').textContent = e.message; }
    };
    $('v-auto').onclick = async () => {
      if (!confirm('De startweergave wissen? De site toont dan automatisch alle huizen.')) return;
      try {
        await api('/api/admin/view', { method: 'DELETE', expectAuth: true });
        savedView = null;
        $('view-dialog').close();
        toast('Startweergave gewist');
      } catch (e) { $('v-err').textContent = e.message; }
    };
  }

  async function search(q) {
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=nl&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'nl' } });
      const [hit] = await r.json();
      if (!hit) return toast('Niets gevonden');
      const bb = hit.boundingbox.map(Number);
      map.fitBounds([[bb[0], bb[2]], [bb[1], bb[3]]], { maxZoom: 18 });
    } catch { toast('Zoeken mislukt'); }
  }

  function initEditor(data) {
    if (map) { map.remove(); layers.clear(); handles = []; draftLayer = null; }
    $('vp').replaceChildren();
    savedView = data.view;
    // in het beheer altijd het volledige zoombereik, ook als bezoekers beperkt zijn
    map = Wijk.createMap($('vp'), data.view && { ...data.view, minZoom: 1, maxZoom: 19 }, data.houses);
    map.on('click', onMapClick);
    map.on('dblclick', () => { if (mode === 'draw' && draft.length >= 3) finishDraft(); });

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
    wireView();
    $('search-form').onsubmit = (e) => { e.preventDefault(); if ($('search').value.trim()) search($('search').value.trim()); };

    if (!window.__keys) {
      window.__keys = true;
      document.addEventListener('keydown', (e) => {
        if (!map) return;
        if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName) && e.key !== 'Escape') return;
        if (document.querySelector('dialog[open]')) return;
        const k = e.key.toLowerCase();
        if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); save(); }
        else if (e.ctrlKey || e.metaKey || e.altKey) return;
        else if (k === 'g' && selected()) setStatus('green');
        else if (k === 'r' && selected()) setStatus('red');
        else if (k === 'd') setMode(mode === 'draw' ? 'select' : 'draw');
        else if (k === 'delete' && selected()) deleteSelected();
        else if (k === 'enter' && mode === 'draw') finishDraft();
        else if (k === 'backspace' && mode === 'draw') { e.preventDefault(); draft.pop(); render(); }
        else if (k === 'escape') { document.activeElement.blur(); if (draft.length) { draft = []; render(); } else select(null); }
      });
    }
  }

  function renderListOnly() {
    const sel = selected();
    const i = houses.indexOf(sel);
    $('list').children[i].lastChild.textContent = nameOf(sel, i);
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
    const data = await api('/api/map');
    houses = data.houses;
    org = { intro: data.intro || '', logo: data.logo };
    initEditor(data);
    setDirty(false);
    setMode('select');
    setTimeout(() => map.invalidateSize(), 0);
  }

  async function boot() {
    const st = await api('/api/auth/status');
    if (st.loggedIn) return openEditor();
    show(st.configured ? 'v-login' : 'v-setup');
  }
  boot().catch((e) => { document.body.textContent = e.message; });
})();
