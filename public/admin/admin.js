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
  let org = { intro: '', logo: null, siteTitle: '', appName: '', appShortName: '', labels: null };
  function renderOrg() {
    $('org-logo').hidden = !org.logo;
    if (org.logo) $('org-logo').src = org.logo.url;
    $('org-remove').disabled = !org.logo;
    $('org-count').textContent = $('org-intro').value.length;
  }
  const DEFAULT_LABELS = { green: 'Groen', red: 'Rood', none: 'Niet gemarkeerd' };
  function fillOrg() {
    $('org-err').textContent = '';
    $('org-intro').value = org.intro;
    api('/api/admin/settings').then((st) => { $('org-info').value = st.residentInfo; }).catch((e) => { $('org-err').textContent = e.message; });
    $('org-title').value = org.siteTitle;
    $('org-appname').value = org.appName;
    $('org-short').value = org.appShortName;
    for (const k of ['green', 'red', 'none']) $(`lbl-${k}`).value = org.labels && org.labels[k] !== DEFAULT_LABELS[k] ? org.labels[k] : '';
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
      const res = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ intro: $('org-intro').value, residentInfo: $('org-info').value, siteTitle: $('org-title').value, appName: $('org-appname').value, appShortName: $('org-short').value, labels: { green: $('lbl-green').value, red: $('lbl-red').value, none: $('lbl-none').value } }), expectAuth: true });
      Wijk.setLabels(res.labels); org.labels = res.labels;
      if (typeof render === 'function' && map) { render(); renderChangesIfOpen(); }
      org.intro = res.intro; org.siteTitle = res.siteTitle; org.appName = res.appName; org.appShortName = res.appShortName;
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
    if (name === 'changes') { renderChanges(); renderPush(); }
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
  $('settings-open').onclick = () => (drawerOpen() ? closeSettings() : openSettings(pendingCount > 0 ? 'changes' : undefined));
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

  // ---------- wijzigingen van bewoners en meldingen ----------
  let pendingCount = 0;
  const STATUS_NL = new Proxy({}, { get: (_, k) => (Wijk.STATUS[k] ? Wijk.STATUS[k].name.toLowerCase() : k) }); // volgt de instelbare namen
  const renderChangesIfOpen = () => { if (drawerOpen() && activeTab() === 'changes') renderChanges(); };
  const ago = (iso) => {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    return m < 1 ? 'zojuist' : m < 60 ? `${m} min geleden` : m < 1440 ? `${Math.round(m / 60)} uur geleden` : `${Math.round(m / 1440)} dagen geleden`;
  };
  const activeTab = () => document.querySelector('#settings [data-tab].active')?.dataset.tab;

  function setBadge(n) {
    for (const id of ['tab-badge', 'cog-badge']) { $(id).hidden = n === 0; $(id).textContent = n; }
    document.title = n ? `(${n}) Beheer` : 'Beheer';
  }

  async function pollChanges(first) {
    try {
      const { pending } = await api('/api/admin/changes/count');
      if (!first && pending > pendingCount) toast(`${pending} wijziging${pending === 1 ? '' : 'en'} wacht${pending === 1 ? '' : 'en'} op goedkeuring`);
      const changed = pending !== pendingCount;
      pendingCount = pending;
      setBadge(pending);
      if (changed && drawerOpen() && activeTab() === 'changes') renderChanges();
    } catch { /* offline of uitgelogd: volgende poging */ }
  }

  // Een goedgekeurde wijziging ook in de lokale lijst verwerken, zodat een volgende "Opslaan" hem niet overschrijft.
  function applyChange(c) {
    const h = c && houses.find((x) => x.id === c.houseId);
    if (h) { h.status = c.status; render(); }
  }

  async function renderChanges() {
    $('chg-err').textContent = '';
    let data;
    try { data = await api('/api/admin/changes'); } catch (e) { $('chg-err').textContent = e.message; return; }
    $('res-enabled').checked = data.enabled;
    $('res-apponly').checked = !!data.appOnly;
    const sched = data.schedule || {};
    $('res-sched').checked = !!sched.on;
    if (sched.until && document.activeElement !== $('res-until')) $('res-until').value = toLocalInput(sched.until);
    $('res-until').disabled = false;
    $('res-swap').checked = !!sched.swap;
    $('res-swap').disabled = !sched.on;
    $('res-enabled').disabled = !!sched.on;
    $('res-apponly').disabled = !!sched.on || !data.enabled;
    pendingCount = data.pending.length; setBadge(pendingCount);
    const box = $('pend-list');
    box.replaceChildren();
    if (!data.pending.length) {
      const p = document.createElement('p'); p.className = 'muted'; p.style.padding = '8px 10px'; p.textContent = 'Geen wijzigingen die op goedkeuring wachten.'; box.append(p);
    }
    for (const c of data.pending) {
      const row = document.createElement('div'); row.className = 'chg-row';
      const info = document.createElement('div'); info.className = 'chg-info';
      const t = document.createElement('strong'); t.textContent = c.title;
      const d = document.createElement('span'); d.textContent = `${STATUS_NL[c.from]} → ${STATUS_NL[c.to]} · ${ago(c.updatedAt)}`;
      info.append(t, d);
      const ok = document.createElement('button'); ok.className = 'primary'; ok.textContent = 'Goedkeuren';
      const no = document.createElement('button'); no.textContent = 'Afwijzen';
      ok.onclick = () => decideChange(c.id, 'approve');
      no.onclick = () => decideChange(c.id, 'reject');
      const bl = document.createElement('button'); bl.className = 'danger'; bl.textContent = 'Blokkeren';
      bl.onclick = () => blockDevice(c.rid, c.title);
      row.append(info, ok, no, bl);
      box.append(row);
    }
    $('pend-all').disabled = !data.pending.length;

    const rl = $('res-list');
    rl.replaceChildren();
    if (!data.residents.length) { const p = document.createElement('p'); p.className = 'muted'; p.style.padding = '8px 10px'; p.textContent = 'Nog geen apparaten aangemeld.'; rl.append(p); }
    for (const r of data.residents) {
      const row = document.createElement('div'); row.className = 'chg-row';
      const info = document.createElement('div'); info.className = 'chg-info';
      const t = document.createElement('strong'); t.textContent = r.title;
      const d = document.createElement('span'); d.textContent = `aangemeld ${ago(r.createdAt)} · laatst actief ${ago(r.lastActivity)}${r.ip ? ` · ${r.ip}` : ''}`;
      info.append(t, d);
      const del = document.createElement('button'); del.className = 'danger'; del.textContent = 'Verwijderen';
      del.onclick = async () => {
        if (!confirm(`De koppeling met ${r.title} verwijderen? Dat apparaat kan dan opnieuw een huis kiezen.`)) return;
        try { await api(`/api/admin/residents/${r.rid}`, { method: 'DELETE', expectAuth: true }); renderChanges(); }
        catch (e) { $('chg-err').textContent = e.message; }
      };
      const bl = document.createElement('button'); bl.className = 'danger'; bl.textContent = 'Blokkeren';
      bl.onclick = () => blockDevice(r.rid, r.title, r.ip);
      row.append(info, bl, del);
      rl.append(row);
    }

    const bk = $('blk-list');
    bk.replaceChildren();
    if (!data.blocked.length) { const p = document.createElement('p'); p.className = 'muted'; p.style.padding = '8px 10px'; p.textContent = 'Geen geblokkeerde apparaten.'; bk.append(p); }
    for (const b of data.blocked) {
      const row = document.createElement('div'); row.className = 'chg-row';
      const info = document.createElement('div'); info.className = 'chg-info';
      const t = document.createElement('strong'); t.textContent = b.title;
      const d = document.createElement('span'); d.textContent = `geblokkeerd ${ago(b.at)}${b.ip ? ` · ook IP ${b.ip}` : ' · alleen dit apparaat'}`;
      info.append(t, d);
      const un = document.createElement('button'); un.textContent = 'Deblokkeren';
      un.onclick = async () => {
        try { await api(`/api/admin/blocks/${b.id}`, { method: 'DELETE', expectAuth: true }); toast('Gedeblokkeerd'); renderChanges(); }
        catch (e) { $('chg-err').textContent = e.message; }
      };
      row.append(info, un);
      bk.append(row);
    }
  }

  // datum/tijd: <input type="datetime-local"> werkt in lokale tijd; de server bewaart UTC
  const pad = (n) => String(n).padStart(2, '0');
  function toLocalInput(iso) {
    const d = new Date(iso);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  async function saveSchedule(on) {
    $('chg-err').textContent = '';
    const v = $('res-until').value;
    try {
      if (on && !v) throw new Error('Kies eerst een datum en tijd');
      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ residentsOff: on, residentsUntil: v ? new Date(v).toISOString() : null }), expectAuth: true });
      toast(on ? 'Wijzigen wordt automatisch uitgeschakeld' : 'Planning uitgezet');
    } catch (e) { $('chg-err').textContent = e.message; $('res-sched').checked = !on; }
    await renderChanges();
  }
  $('res-swap').onchange = async () => {
    try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ residentsSwapAfter: $('res-swap').checked }), expectAuth: true }); toast($('res-swap').checked ? 'Na de einddatum kan nog groen ↔ rood worden gewisseld' : 'Na de einddatum is wijzigen helemaal dicht'); }
    catch (e) { $('chg-err').textContent = e.message; $('res-swap').checked = !$('res-swap').checked; }
  };
  $('res-sched').onchange = () => saveSchedule($('res-sched').checked);
  $('res-until').onchange = () => { if ($('res-sched').checked) saveSchedule(true); };

  async function blockDevice(rid, title, ip) {
    if (!confirm(`Het apparaat van ${title} blokkeren? De koppeling en openstaande wijzigingen worden verwijderd en dit apparaat kan niet meer wijzigen.`)) return;
    let withIp = false;
    if (ip) withIp = confirm(`Ook het IP-adres ${ip} blokkeren?\n\nLet op: bewoners achter hetzelfde netwerk (bijv. dezelfde router) delen vaak een IP-adres en worden dan ook geblokkeerd.\n\nOK = ook IP blokkeren, Annuleren = alleen dit apparaat.`);
    try { await post(`/api/admin/residents/${rid}/block`, { withIp }, { expectAuth: true }); toast('Geblokkeerd'); await renderChanges(); }
    catch (e) { $('chg-err').textContent = e.message; }
  }

  async function decideChange(id, action) {
    try {
      const res = await post(`/api/admin/changes/${id}/${action}`, {}, { expectAuth: true });
      if (action === 'approve') applyChange(res.change);
      toast(action === 'approve' ? 'Goedgekeurd ✔' : 'Afgewezen');
      await renderChanges();
    } catch (e) { $('chg-err').textContent = e.message; }
  }

  $('pend-all').onclick = async () => {
    try {
      const res = await post('/api/admin/changes/approve-all', {}, { expectAuth: true });
      res.changes.forEach(applyChange);
      toast(`${res.changes.length} wijziging(en) goedgekeurd ✔`);
      await renderChanges();
    } catch (e) { $('chg-err').textContent = e.message; }
  };

  $('res-apponly').onchange = async () => {
    try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ residentsAppOnly: $('res-apponly').checked }), expectAuth: true }); toast($('res-apponly').checked ? 'Wijzigen kan nu alleen in de geïnstalleerde app' : 'Wijzigen kan ook in de browser'); }
    catch (e) { $('chg-err').textContent = e.message; $('res-apponly').checked = !$('res-apponly').checked; }
  };

  $('res-enabled').onchange = async () => {
    $('res-apponly').disabled = !$('res-enabled').checked;
    try { await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ residentsEnabled: $('res-enabled').checked }), expectAuth: true }); toast($('res-enabled').checked ? 'Wijzigen door bewoners staat aan' : 'Wijzigen door bewoners staat uit'); }
    catch (e) { $('chg-err').textContent = e.message; $('res-enabled').checked = !$('res-enabled').checked; }
  };

  // ---- pushmeldingen op dit apparaat ----
  const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64 = (str) => { const pad = '='.repeat((4 - (str.length % 4)) % 4); const raw = atob((str + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  const deviceLabel = () => { const ua = navigator.userAgent; return /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac/.test(ua) ? 'Mac' : 'Apparaat'; };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});

  async function currentSub() {
    if (!pushSupported) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function renderPush() {
    $('push-err').textContent = '';
    const on = $('push-on'), off = $('push-off'), test = $('push-test');
    [on, off, test].forEach((b) => b.classList.add('hidden'));
    if (!pushSupported) {
      $('push-status').textContent = 'Dit apparaat of deze browser ondersteunt geen pushmeldingen. Op een iPhone/iPad: zet het beheer eerst op het beginscherm (iOS 16.4 of nieuwer) en open het vandaar.';
    } else if (Notification.permission === 'denied') {
      $('push-status').textContent = 'Meldingen zijn in de browser geblokkeerd voor deze site. Sta ze toe in de site-instellingen en probeer opnieuw.';
    } else {
      const sub = await currentSub();
      $('push-status').textContent = sub ? 'Meldingen staan aan op dit apparaat: je krijgt een melding bij een nieuwe wijziging.' : 'Meldingen staan uit op dit apparaat.';
      (sub ? off : on).classList.remove('hidden');
      if (sub) test.classList.remove('hidden');
    }
    const box = $('push-devices');
    try {
      const devices = await api('/api/admin/push/devices');
      box.classList.toggle('hidden', !devices.length);
      box.replaceChildren(...devices.map((d) => {
        const row = document.createElement('div'); row.className = 'chg-row';
        const info = document.createElement('div'); info.className = 'chg-info';
        const t = document.createElement('strong'); t.textContent = d.label;
        const s = document.createElement('span'); s.textContent = `ingesteld ${ago(d.createdAt)}`;
        info.append(t, s);
        const del = document.createElement('button'); del.className = 'danger'; del.textContent = 'Verwijderen';
        del.onclick = async () => { try { await api(`/api/admin/push/devices/${d.id}`, { method: 'DELETE', expectAuth: true }); renderPush(); } catch (e) { $('push-err').textContent = e.message; } };
        row.append(info, del);
        return row;
      }));
    } catch { box.classList.add('hidden'); }
  }

  $('push-on').onclick = async () => {
    $('push-err').textContent = '';
    try {
      if (await Notification.requestPermission() !== 'granted') throw new Error('Toestemming voor meldingen is niet gegeven.');
      const { publicKey } = await api('/api/admin/push/key');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(publicKey) });
      const { id } = await post('/api/admin/push/subscribe', { subscription: sub.toJSON(), label: deviceLabel() });
      try { localStorage.setItem('sm-push-id', id); } catch {}
      toast('Meldingen aangezet ✔');
    } catch (e) { $('push-err').textContent = friendly(e); }
    renderPush();
  };
  $('push-off').onclick = async () => {
    try {
      const sub = await currentSub();
      let id = null; try { id = localStorage.getItem('sm-push-id'); } catch {}
      if (id) await api(`/api/admin/push/devices/${id}`, { method: 'DELETE', expectAuth: true });
      if (sub) await sub.unsubscribe();
      toast('Meldingen uitgezet');
    } catch (e) { $('push-err').textContent = e.message; }
    renderPush();
  };
  $('push-test').onclick = async () => {
    try { const r = await post('/api/admin/push/test', {}); toast(r.sent ? 'Testmelding verstuurd' : 'Geen apparaat bereikt'); }
    catch (e) { $('push-err').textContent = e.message; }
  };

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (e.data && e.data.type === 'open-tab') { openSettings('changes'); pollChanges(true); }
    });
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollChanges(); });

  // ---------- editor ----------
  let map, houses = [], layers = new Map(); // id -> L.polygon
  let selectedId = null, mode = 'select', newStatus = 'none', draft = [], dirty = false;
  let handles = [], draftLayer = null;
  const uid = () => Math.random().toString(36).slice(2, 10);

  function setDirty(v = true) {
    dirty = v;
    touchHouses();
    $('dirty').textContent = v ? '● Niet opgeslagen' : '';
  }
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  const selected = () => houses.find((h) => h.id === selectedId);
  const nameOf = (h, i) => (h.street || h.number ? Wijk.houseTitle(h) : `Huis ${i + 1}`);
  let filterStreet = ''; // '' = alle straten, '\u0000none' = huizen zonder straat
  const NO_STREET = '\u0000none';
  const inFilter = (h) => !filterStreet || (filterStreet === NO_STREET ? !h.street : h.street === filterStreet);
  let nums = null, numsRev = 0, numsBuilt = -1;
  const touchHouses = () => { numsRev++; };

  function hint() {
    $('hint').textContent = mode === 'draw'
      ? (draft.length
        ? `${draft.length} punt(en). Klik de hoekpunten van het huis; sluit af door op het gele beginpunt te klikken, dubbel te klikken of Enter te drukken. Backspace = laatste punt weg, Esc = annuleren.`
        : 'Zoom ver in en klik op de hoeken van een huis om er een vlak overheen te leggen. Slepen verplaatst de kaart.')
      : 'Klik op een huis om het te selecteren. Sleep de witte punten om de vorm aan te passen. Sneltoetsen: G = ' + Wijk.STATUS.green.name.toLowerCase() + ', R = ' + Wijk.STATUS.red.name.toLowerCase() + ', Delete = verwijderen.';
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
        // dubbelklik (muis): selecteermodus aan en dit huis selecteren (tijdens het tekenen alleen als er nog geen vlak loopt)
        l.on('dblclick', (e) => {
          if (mode === 'draw' && draft.length >= 3) return;
          L.DomEvent.stopPropagation(e);
          editHouse(h.id);
        });
        layers.set(h.id, l);
      }
      l.setStyle(Wijk.houseStyle(h.status, h.id === selectedId));
      if (!inFilter(h)) l.setStyle({ opacity: 0.3, fillOpacity: 0.06 });
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
    if (nums && numsBuilt !== numsRev) { nums.rebuild(houses); numsBuilt = numsRev; }
  }

  function renderPanel() {
    const sel = selected();
    $('props').classList.toggle('hidden', !sel);
    if (sel) {
      if (document.activeElement !== $('p-street')) $('p-street').value = sel.street || '';
      if (document.activeElement !== $('p-number')) $('p-number').value = sel.number || '';
      if (document.activeElement !== $('p-note')) $('p-note').value = sel.note;
      document.querySelectorAll('#p-status button').forEach((b) => b.classList.toggle('active', b.dataset.status === sel.status));
    }
    renderStreets();
    const shown = houses.filter(inFilter).sort(Wijk.compareHouses);
    $('count').textContent = filterStreet ? `${shown.length} van ${houses.length}` : houses.length;
    $('list').replaceChildren(...shown.map((h) => {
      const d = document.createElement('div');
      d.className = h.id === selectedId ? 'sel' : '';
      d.innerHTML = `<i class="dot ${h.status}"></i>`;
      d.append(nameOf(h, houses.indexOf(h)));
      d.onclick = () => { setMode('select'); select(h.id); map.fitBounds(L.latLngBounds(h.points).pad(1.5), { maxZoom: 19 }); };
      return d;
    }));
    hint();
  }

  // Straten-filter en suggesties voor het straatveld
  function renderStreets() {
    const streets = [...new Set(houses.map((h) => h.street).filter(Boolean))].sort(Wijk.natCompare);
    const sel = $('street-filter');
    const want = [['', 'Alle straten'], ...streets.map((x) => [x, x])];
    if (houses.some((h) => !h.street)) want.push([NO_STREET, '(zonder straat)']);
    if (filterStreet && !want.some(([v]) => v === filterStreet)) filterStreet = '';
    if (sel.options.length !== want.length || [...sel.options].some((o, i) => o.value !== want[i][0])) {
      sel.replaceChildren(...want.map(([v, t]) => Object.assign(document.createElement('option'), { value: v, textContent: t })));
    }
    sel.value = filterStreet;
    $('street-list').replaceChildren(...streets.map((x) => Object.assign(document.createElement('option'), { value: x })));
  }

  // Actieve (of laatst gebruikte) straat: nieuwe huizen krijgen die straat vooraf ingevuld.
  let activeStreet = '';
  function setActiveStreet(v) {
    activeStreet = String(v || '').trim();
    if (document.activeElement !== $('active-street')) $('active-street').value = activeStreet;
  }

  function select(id) {
    selectedId = id;
    const h = selected();
    if (h) {
      if (h.street) setActiveStreet(h.street);
      else if (!h.number && activeStreet) { h.street = activeStreet; setDirty(); } // nieuw, nog leeg huis: straat alvast invullen
    }
    render();
  }

  function editHouse(id) {
    setMode('select');
    select(id);
    if (matchMedia('(pointer: fine)').matches) $('p-number').focus();
  }

  const insidePoly = (pt, poly) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [yi, xi] = poly[i], [yj, xj] = poly[j];
      if ((yi > pt.lat) !== (yj > pt.lat) && pt.lng < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };

  // Touchscreen: lang indrukken op een huis doet hetzelfde als dubbelklikken.
  function initLongPress() {
    const el = map.getContainer();
    let timer = null, start = null, swallow = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    el.addEventListener('pointerdown', (e) => {
      cancel();
      if (e.pointerType !== 'touch' || !e.isPrimary || (mode === 'draw' && draft.length)) return;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => {
        timer = null;
        const r = el.getBoundingClientRect();
        const ll = map.containerPointToLatLng([start.x - r.left, start.y - r.top]);
        const h = houses.find((x) => insidePoly(ll, x.points));
        if (h) { swallow = true; setTimeout(() => { swallow = false; }, 800); navigator.vibrate?.(30); editHouse(h.id); }
      }, 600);
    });
    el.addEventListener('pointermove', (e) => { if (timer && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
    for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, cancel);
    for (const t of ['click', 'contextmenu']) el.addEventListener(t, (e) => { if (swallow) { e.preventDefault(); e.stopPropagation(); } }, true);
  }

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
    const lastStreet = activeStreet || (filterStreet && filterStreet !== NO_STREET ? filterStreet : (houses[houses.length - 1]?.street || ''));
    const h = { id: uid(), street: lastStreet, number: '', note: '', status: newStatus, points: draft };
    houses.push(h);
    draft = [];
    selectedId = h.id;
    setDirty();
    render();
    if (matchMedia('(pointer: fine)').matches) $('p-number').focus();
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
    $('v-numbers').checked = !!v.showNumbers;
  }
  const grabView = () => {
    const c = map.getCenter();
    $('v-lat').value = Math.round(c.lat * 1e6) / 1e6;
    $('v-lng').value = Math.round(c.lng * 1e6) / 1e6;
    $('v-zoom').value = Math.round(map.getZoom() * 4) / 4;
  };
  const readView = () => ({ center: [num('v-lat'), num('v-lng')], zoom: num('v-zoom'), minZoom: num('v-min'), maxZoom: num('v-max'), showNumbers: $('v-numbers').checked });
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
    Wijk.map = map;
    map.on('click', onMapClick);
    initLongPress();
    map.on('dblclick', () => { if (mode === 'draw' && draft.length >= 3) finishDraft(); });

    $('t-select').onclick = () => setMode('select');
    $('t-draw').onclick = () => setMode('draw');
    document.querySelectorAll('[data-newstatus]').forEach((b) => b.onclick = () => {
      newStatus = b.dataset.newstatus;
      document.querySelectorAll('[data-newstatus]').forEach((x) => x.classList.toggle('active', x === b));
    });
    document.querySelectorAll('#p-status button').forEach((b) => b.onclick = () => setStatus(b.dataset.status));
    $('p-street').oninput = () => { const s = selected(); if (s) { s.street = $('p-street').value; setActiveStreet(s.street); setDirty(); render(); } };
    $('active-street').oninput = () => setActiveStreet($('active-street').value);
    $('p-number').oninput = () => { const s = selected(); if (s) { s.number = $('p-number').value; setDirty(); render(); } };
    $('street-filter').onchange = () => {
      filterStreet = $('street-filter').value;
      if (filterStreet && filterStreet !== NO_STREET) setActiveStreet(filterStreet);
      render();
      const sub = houses.filter(inFilter);
      if (filterStreet && sub.length) map.fitBounds(L.latLngBounds(sub.flatMap((h) => h.points)).pad(0.3), { maxZoom: 19 });
    };
    // huisnummers midden op de huizen (alleen een weergavekeuze in het beheer)
    nums = Wijk.createNumberLayer(map);
    let showNums = true;
    try { showNums = localStorage.getItem('sm-admin-numbers') !== '0'; } catch {}
    $('a-num-switch').checked = showNums;
    nums.setVisible(showNums);
    $('a-num-switch').onchange = () => {
      nums.setVisible($('a-num-switch').checked);
      try { localStorage.setItem('sm-admin-numbers', $('a-num-switch').checked ? '1' : '0'); } catch {}
    };
    $('p-note').oninput = () => { const s = selected(); if (s) { s.note = $('p-note').value; setDirty(); } };
    $('p-del').onclick = deleteSelected;
    $('save').onclick = save;
    wireView();
    setActiveStreet(houses.length ? houses[houses.length - 1].street : '');
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
    org = { intro: data.intro || '', logo: data.logo, siteTitle: data.siteTitle || '', appName: data.appName || '', appShortName: data.appShortName || '', labels: data.labels };
    Wijk.setLabels(data.labels);
    selectedId = null; draft = [];
    setDirty(false);
    render();
    if (data.view) map.setView(data.view.center, data.view.zoom);
  }

  async function openEditor() {
    show('v-edit');
    const data = await api('/api/map');
    houses = data.houses;
    org = { intro: data.intro || '', logo: data.logo, siteTitle: data.siteTitle || '', appName: data.appName || '', appShortName: data.appShortName || '', labels: data.labels };
    Wijk.setLabels(data.labels);
    initEditor(data);
    setDirty(false);
    setMode('select');
    setTimeout(() => map.invalidateSize(), 0);
    pollChanges(true);
    if (!window.__pollTimer) window.__pollTimer = setInterval(() => pollChanges(), 30000);
    if (location.hash === '#changes') openSettings('changes');
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
