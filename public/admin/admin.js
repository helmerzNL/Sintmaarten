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
  // Het inlogformulier met wachtwoordveld bestaat alleen op het inlogscherm (niet in de editor).
  function mountPwLogin(enabled) {
    const slot = $('pw-form-slot');
    slot.replaceChildren();
    if (!enabled) return;
    slot.append($('pw-form-tpl').content.cloneNode(true));
    $('pw-form').onsubmit = async (e) => {
      e.preventDefault();
      $('l-pw-err').textContent = '';
      try { await post('/api/auth/password-login', { password: $('l-pw').value }); boot(); }
      catch (err) { $('l-pw-err').textContent = err.message; }
    };
  }
  $('logout').onclick = async () => {
    if (dirty && !confirm('Er zijn niet-opgeslagen wijzigingen. Toch uitloggen?')) return;
    dirty = false;
    await post('/api/auth/logout');
    location.reload();
  };

  // ---------- passkeys dialoog ----------
  let session = { method: null, passwordEnabled: false };
  const locked = () => session.method === 'pw';

  async function renderPasskeys() {
    session = await api('/api/auth/status');
    $('pw-status').textContent = session.passwordEnabled ? 'Er is een wachtwoord ingesteld.' : 'Er is nog geen wachtwoord ingesteld; inloggen kan alleen met een passkey.';
    $('pw-start').textContent = session.passwordEnabled ? 'Wachtwoord wijzigen…' : 'Wachtwoord instellen…';
    $('pw-remove').classList.toggle('hidden', !session.passwordEnabled);
    $('pw-edit').classList.toggle('hidden', locked());
    if (locked()) closePwForm();
    $('pw-locked').classList.toggle('hidden', !locked());
    $('pk-add').disabled = locked();
    $('pk-name').disabled = locked();
    const list = await api('/api/admin/passkeys');
    $('pk-list').innerHTML = '';
    for (const p of list) {
      const row = document.createElement('div');
      row.className = 'pk';
      const s = document.createElement('span');
      s.textContent = `${p.name} · ${new Date(p.createdAt).toLocaleDateString('nl-NL')}`;
      const del = document.createElement('button');
      del.className = 'danger'; del.textContent = 'Verwijder'; del.disabled = list.length < 2 || locked();
      del.onclick = async () => {
        if (!confirm(`Passkey "${p.name}" verwijderen?`)) return;
        try { await api(`/api/admin/passkeys/${encodeURIComponent(p.id)}`, { method: 'DELETE' }); renderPasskeys(); }
        catch (e) { $('pk-err').textContent = e.message; }
      };
      row.append(s, del);
      $('pk-list').append(row);
    }
  }
  // Wachtwoord instellen/verwijderen: altijd bevestigen met een passkey (vingerafdruk/pincode).
  async function confirmWithPasskey() {
    const { challengeId, options } = await post('/api/admin/password/options');
    const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
    return { challengeId, response };
  }
  // De wachtwoordvelden worden pas aangemaakt als je op "Wachtwoord instellen" klikt en daarna weer verwijderd.
  function closePwForm() { $('pw-form-set').replaceChildren(); $('pw-form-set').classList.add('hidden'); $('pw-start').classList.remove('hidden'); }
  $('pw-start').onclick = () => {
    $('pw-err').textContent = '';
    const f = $('pw-form-set');
    const field = (id, label) => {
      const l = document.createElement('label'); l.htmlFor = id; l.textContent = label;
      const i = document.createElement('input');
      i.type = 'password'; i.id = id; i.maxLength = 200; i.autocomplete = 'new-password';
      return [l, i];
    };
    const user = document.createElement('input');
    user.type = 'text'; user.name = 'username'; user.value = 'beheerder'; user.autocomplete = 'username'; user.hidden = true;
    const err = document.createElement('p'); err.className = 'error'; err.id = 'pw-set-err';
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.type = 'submit'; ok.className = 'primary'; ok.textContent = 'Opslaan (bevestig met passkey)';
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Annuleren'; cancel.onclick = closePwForm;
    row.append(ok, cancel);
    f.replaceChildren(user, ...field('pw-new', session.passwordEnabled ? 'Nieuw wachtwoord (minimaal 10 tekens)' : 'Wachtwoord (minimaal 10 tekens)'), ...field('pw-new2', 'Herhaal wachtwoord'), err, row);
    f.classList.remove('hidden');
    $('pw-start').classList.add('hidden');
    $('pw-new').focus();
  };
  $('pw-form-set').onsubmit = async (e) => {
    e.preventDefault();
    const err = $('pw-set-err');
    err.textContent = '';
    const pw = $('pw-new').value;
    if (pw.length < 10) { err.textContent = 'Kies een wachtwoord van minimaal 10 tekens.'; return; }
    if (pw !== $('pw-new2').value) { err.textContent = 'De twee wachtwoorden zijn niet gelijk.'; return; }
    try {
      const proof = await confirmWithPasskey();
      await api('/api/admin/password', { method: 'PUT', body: JSON.stringify({ ...proof, password: pw }) });
      closePwForm();
      toast('Wachtwoord opgeslagen ✔');
      renderPasskeys();
    } catch (ex) { err.textContent = friendly(ex); }
  };
  $('pw-remove').onclick = async () => {
    $('pw-err').textContent = '';
    if (!confirm('Het wachtwoord verwijderen? Inloggen kan dan alleen nog met een passkey.')) return;
    try {
      const proof = await confirmWithPasskey();
      await post('/api/admin/password/remove', proof);
      toast('Wachtwoord verwijderd');
      renderPasskeys();
    } catch (e) { $('pw-err').textContent = friendly(e); }
  };

  $('pk-add').onclick = async () => {
    $('pk-err').textContent = '';
    try { await registerPasskey({ name: $('pk-name').value }); renderPasskeys(); toast('Passkey toegevoegd'); }
    catch (e) { $('pk-err').textContent = friendly(e); }
  };

  // ---------- logo & uitleg ----------
  let org = { intro: '', logo: null, appName: '', appShortName: '' };
  function renderOrg() {
    $('org-logo').hidden = !org.logo;
    if (org.logo) $('org-logo').src = org.logo.url;
    $('org-remove').disabled = !org.logo;
    $('org-count').textContent = $('org-intro').value.length;
  }
  function fillOrg() {
    $('org-err').textContent = '';
    $('org-intro').value = org.intro;
    $('org-appname').value = org.appName;
    $('org-short').value = org.appShortName;
    renderOrg();
  }
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
      const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ intro: $('org-intro').value, appName: $('org-appname').value, appShortName: $('org-short').value }), expectAuth: true });
      org.intro = res.intro; org.appName = res.appName; org.appShortName = res.appShortName;
      toast('Opgeslagen ✔');
    } catch (e) { $('org-err').textContent = e.message; }
  };

  // ---------- instellingen (uitschuifbaar menu) ----------
  const drawer = () => $('settings');
  const drawerOpen = () => drawer().classList.contains('open');
  const fmtDate = (iso) => new Date(iso).toLocaleString('nl-NL', { dateStyle: 'medium', timeStyle: 'medium' });

  function openTab(name) {
    document.querySelectorAll('#settings [data-tab]').forEach((b) => {
      const on = b.dataset.tab === name;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on);
    });
    document.querySelectorAll('#settings [data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
    if (name === 'security') { $('pk-err').textContent = ''; renderPasskeys().catch((e) => ($('pk-err').textContent = e.message)); }
    if (name === 'backups') renderBackups();
    if (name === 'org') fillOrg();
  }
  let versionShown = false;
  async function showVersion() {
    if (versionShown) return;
    try {
      const info = await api('/api/admin/info');
      $('app-version').textContent = info.label;
      $('app-version').title = `Build (commit): ${info.buildFull}`;
      versionShown = true;
    } catch { $('app-version').textContent = 'onbekend'; }
  }

  function openSettings(tab) {
    showVersion();
    drawer().classList.add('open');
    drawer().setAttribute('aria-hidden', 'false');
    $('scrim').classList.add('show');
    openTab(tab || document.querySelector('#settings [data-tab].active')?.dataset.tab || 'security');
    $('settings-close').focus();
  }
  function closeSettings() {
    drawer().classList.remove('open');
    drawer().setAttribute('aria-hidden', 'true');
    $('scrim').classList.remove('show');
    $('settings-open').focus();
  }
  $('settings-open').onclick = () => (drawerOpen() ? closeSettings() : openSettings());
  $('settings-close').onclick = closeSettings;
  $('scrim').onclick = closeSettings;
  document.querySelectorAll('#settings [data-tab]').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && drawerOpen() && !document.querySelector('dialog[open]')) closeSettings();
  });

  // ---------- backups ----------
  const selectedBackups = () => [...document.querySelectorAll('#bk-list input[type=checkbox]:checked')].map((c) => c.value);
  const syncBackupButtons = () => { $('bk-delete').disabled = selectedBackups().length === 0; };

  async function renderBackups() {
    $('bk-err').textContent = '';
    let list;
    try { list = await api('/api/admin/backups'); } catch (e) { $('bk-err').textContent = e.message; return; }
    const box = $('bk-list');
    box.replaceChildren();
    if (!list.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Er zijn nog geen backups. Na de eerstvolgende keer opslaan verschijnt hier de eerste.';
      box.append(p);
    }
    for (const b of list) {
      const row = document.createElement('div');
      row.className = 'bk-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = b.id; cb.setAttribute('aria-label', `Selecteer backup van ${fmtDate(b.createdAt)}`);
      cb.onchange = syncBackupButtons;
      const info = document.createElement('div');
      info.className = 'bk-info';
      const t = document.createElement('strong'); t.textContent = fmtDate(b.createdAt);
      const d = document.createElement('span');
      d.textContent = `${b.reason}${b.ok ? '' : ' (mislukt)'} · ${b.houses} huizen${b.textLength ? ` · uitleg ${b.textLength} tekens` : ''}`;
      info.append(t, d);
      const restore = document.createElement('button');
      restore.textContent = 'Terugzetten';
      restore.onclick = () => restoreBackup(b);
      const dl = document.createElement('a');
      dl.className = 'btn'; dl.textContent = '⬇'; dl.title = 'Downloaden'; dl.href = `/api/admin/backups/${b.id}`; dl.download = `backup-${b.id}.json`;
      row.append(cb, info, restore, dl);
      box.append(row);
    }
    syncBackupButtons();
  }

  async function restoreBackup(b) {
    if (!confirm(`Backup van ${fmtDate(b.createdAt)} terugzetten?\nDe huidige staat wordt eerst zelf als backup bewaard.${dirty ? '\n\nLet op: niet-opgeslagen wijzigingen gaan verloren.' : ''}`)) return;
    try {
      await post(`/api/admin/backups/${b.id}/restore`, {}, { expectAuth: true });
      await reloadFromServer();
      toast('Backup teruggezet ✔');
      renderBackups();
    } catch (e) { $('bk-err').textContent = e.message; }
  }

  $('bk-delete').onclick = async () => {
    const ids = selectedBackups();
    if (!ids.length) return;
    if (!confirm(`${ids.length} backup(s) definitief verwijderen? Je moet dit bevestigen met je passkey.`)) return;
    $('bk-err').textContent = '';
    try {
      const { challengeId, options } = await post('/api/admin/confirm/options');
      const response = await SimpleWebAuthnBrowser.startAuthentication({ optionsJSON: options });
      const res = await post('/api/admin/backups/delete', { ids, challengeId, response });
      toast(`${res.deleted} backup(s) verwijderd`);
      renderBackups();
    } catch (e) { $('bk-err').textContent = friendly(e); }
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
        if (document.querySelector('dialog[open]') || drawerOpen()) return;
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

  async function reloadFromServer() {
    const data = await api('/api/map');
    houses = data.houses;
    savedView = data.view;
    org = { intro: data.intro || '', logo: data.logo, appName: data.appName || '', appShortName: data.appShortName || '' };
    selectedId = null; draft = [];
    setDirty(false);
    render();
    if (data.view) map.setView(data.view.center, data.view.zoom);
  }

  async function openEditor() {
    show('v-edit');
    const data = await api('/api/map');
    houses = data.houses;
    org = { intro: data.intro || '', logo: data.logo, appName: data.appName || '', appShortName: data.appShortName || '' };
    initEditor(data);
    setDirty(false);
    setMode('select');
    setTimeout(() => map.invalidateSize(), 0);
  }

  // Gewone invoervelden niet door wachtwoordmanagers laten aanvullen of aanbieden.
  document.querySelectorAll('input:not([type=password]):not([type=file]):not([type=checkbox]), textarea, #s-token').forEach((el) => {
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('data-lpignore', 'true');
    el.setAttribute('data-1p-ignore', '');
    el.setAttribute('data-bwignore', 'true');
    el.setAttribute('data-form-type', 'other');
  });

  async function boot() {
    const st = await api('/api/auth/status');
    session = st;
    if (st.loggedIn) { mountPwLogin(false); return openEditor(); }
    mountPwLogin(st.passwordEnabled);
    show(st.configured ? 'v-login' : 'v-setup');
  }
  boot().catch((e) => { document.body.textContent = e.message; });
})();
