// "Huis wijzigen": in de geïnstalleerde app kiest een bewoner één huis (per apparaat) en stelt een
// nieuwe status voor (niet gemarkeerd → groen → rood; de namen zijn instelbaar). De beheerder moet dat goedkeuren.
(function () {
  const ORDER = ['none', 'green', 'red'];
  const cycle = (s) => ORDER[(ORDER.indexOf(s) + 1) % ORDER.length];
  const NAME = new Proxy({}, { get: (_, k) => Wijk.STATUS[k]?.name }); // volgt de instelbare namen
  const $ = (id) => document.getElementById(id);

  const isInstalledApp = () => window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches || window.navigator.standalone === true;

  async function api(path, body) {
    const res = await fetch(`/api/resident${path}`, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `Fout ${res.status}`), { status: res.status });
    return data;
  }

  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg; t.setAttribute('role', 'status');
    document.body.append(t);
    setTimeout(() => t.remove(), 3500);
  }

  Wijk.initResident = async function ({ map, houses, enabled }) {
    if (!enabled || !isInstalledApp()) return;
    const btn = $('house-edit');
    if (!btn) return;
    btn.hidden = false;

    let sorted = [...houses].sort(Wijk.compareHouses);
    let byId = new Map(houses.map((h) => [h.id, h]));
    const store = {
      get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
      set: (k, v) => { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
    };
    const CACHE = 'sm-resident-me', TOKEN = 'sm-resident-token';

    // De koppeling blijft bewaard: op de server (cookie), met een lokale kopie van het token als reserve
    // en een lokale kopie van de laatste status voor als er even geen verbinding is.
    let me = { claim: null };
    try {
      me = await api('/me');
      if (!me.claim && store.get(TOKEN)) { // cookie weg? herstel met het lokaal bewaarde token
        try { me = await api('/restore', { token: store.get(TOKEN) }); } catch (e) { if (e.status === 404) store.set(TOKEN, null); }
      }
      store.set(CACHE, me.claim ? JSON.stringify(me) : null);
    } catch (e) {
      if (e.status === 403) { btn.hidden = true; return; }
      try { me = JSON.parse(store.get(CACHE) || 'null') || { claim: null }; } catch { me = { claim: null }; } // offline
    }

    let on = false, group = null;
    const layers = new Map();
    const sheet = $('house-sheet');

    const statusOf = (h) => (me.claim && h.id === me.claim.houseId ? me.effective : h.status);

    function styleFor(h) {
      const st = statusOf(h);
      const style = Wijk.houseStyle(st);
      if (st === 'none') style.fillOpacity = 0.22; // lege huizen blijven goed aantikbaar
      const mine = me.claim && h.id === me.claim.houseId;
      if (mine) { style.weight = 5; style.color = '#1d4ed8'; }
      if (mine && me.pending) style.dashArray = '10 6';
      return style;
    }

    function restyle() {
      for (const [id, layer] of layers) {
        const h = byId.get(id);
        layer.setStyle(styleFor(h));
        const el = layer.getElement && layer.getElement();
        if (el) el.classList.toggle('pending', !!(me.claim && id === me.claim.houseId && me.pending));
        if (me.claim && id === me.claim.houseId) layer.bringToFront();
      }
    }

    // Het eigen huis blijft ook buiten de wijzigmodus zichtbaar (met de nog niet goedgekeurde status).
    let mine = null;
    function clearMine() { if (mine) { mine.remove(); mine = null; } }
    function drawMine() {
      clearMine();
      if (on || !me.claim) return;
      const h = byId.get(me.claim.houseId);
      if (!h) return;
      mine = L.layerGroup().addTo(map);
      const poly = L.polygon(h.points, styleFor(h)).addTo(mine);
      poly.on('click', (e) => { L.DomEvent.stopPropagation(e); enter(); });
      const el = poly.getElement && poly.getElement();
      if (el) el.classList.toggle('pending', !!me.pending);
      const badge = L.marker(Wijk.labelPoint(h.points), {
        icon: L.divIcon({ className: 'mine-badge', html: me.pending ? '⏳' : '🏠', iconSize: [26, 26] }),
        interactive: false, keyboard: false,
      }).addTo(mine);
      badge.getElement()?.setAttribute('title', me.pending ? 'Jouw huis: wacht op goedkeuring' : 'Jouw huis');
    }

    function enter() {
      on = true;
      clearMine();
      document.body.classList.add('editing');
      group = L.layerGroup().addTo(map);
      for (const h of houses) {
        const layer = L.polygon(h.points, styleFor(h)).addTo(group);
        layer.on('click', (e) => { L.DomEvent.stopPropagation(e); tap(h); });
        layers.set(h.id, layer);
      }
      restyle();
      if (me.claim) { const h = byId.get(me.claim.houseId); if (h) map.fitBounds(L.latLngBounds(h.points).pad(2), { maxZoom: 19 }); }
      render();
    }

    function leave() {
      on = false;
      document.body.classList.remove('editing');
      if (group) { group.remove(); group = null; }
      layers.clear();
      sheet.hidden = true;
      sheet.replaceChildren();
      drawMine();
    }

    async function setStatus(next) {
      try {
        me = { ...me, ...(await api('/set', { status: next })) };
        store.set(CACHE, JSON.stringify(me));
        restyle();
        drawMine();
        render();
      } catch (e) { toast(e.message); }
    }

    function confirmClaim(h) {
      const dlg = $('claim-dialog');
      $('claim-title').textContent = Wijk.houseTitle(h);
      dlg.returnValue = '';
      dlg.onclose = async () => {
        if (dlg.returnValue !== 'ja') return;
        try {
          me = await api('/claim', { houseId: h.id });
          if (me.deviceToken) store.set(TOKEN, me.deviceToken);
          store.set(CACHE, JSON.stringify(me));
          restyle();
          await setStatus(cycle(h.status)); // de eerste tik wisselt meteen de kleur
        } catch (e) { toast(e.message); }
      };
      dlg.showModal();
    }

    function tap(h) {
      if (!me.claim) return confirmClaim(h);
      if (h.id === me.claim.houseId) return setStatus(cycle(me.effective));
      toast(`Je kunt alleen jouw eigen huis wijzigen (${me.claim.title}).`);
    }

    function el(tag, props = {}, ...kids) {
      const e = Object.assign(document.createElement(tag), props);
      e.append(...kids);
      return e;
    }

    function render() {
      if (!on) return;
      sheet.hidden = false;
      const parts = [];
      const head = el('div', { className: 'sheet-head' }, el('strong', { textContent: 'Huis wijzigen' }),
        el('button', { type: 'button', className: 'icon-btn', ariaLabel: 'Sluiten', textContent: '✕', onclick: leave }));
      parts.push(head);

      if (me.notice) {
        const ok = me.notice.decision === 'approved';
        parts.push(el('p', { className: `notice ${ok ? 'ok' : 'no'}` },
          ok ? `✔ Je wijziging (${NAME[me.notice.status]}) is goedgekeurd.` : '✖ Je laatste wijziging is niet doorgevoerd.',
          el('button', { type: 'button', textContent: 'OK', onclick: async () => { try { await api('/ack', {}); } catch {} me.notice = null; render(); } })));
      }

      if (!me.claim) {
        parts.push(el('p', { textContent: 'Tik op jouw huis op de kaart of kies je adres. Je kunt per apparaat één huis kiezen.' }));
        const sel = el('select', { ariaLabel: 'Kies je adres' }, el('option', { value: '', textContent: 'Kies je adres…' }),
          ...sorted.map((h) => el('option', { value: h.id, textContent: Wijk.houseTitle(h) })));
        sel.onchange = () => {
          const h = byId.get(sel.value);
          sel.value = '';
          if (!h) return;
          map.fitBounds(L.latLngBounds(h.points).pad(2), { maxZoom: 19 });
          confirmClaim(h);
        };
        parts.push(sel);
      } else {
        parts.push(el('p', {}, 'Jouw huis: ', el('strong', { textContent: me.claim.title })));
        parts.push(el('p', { className: 'muted', textContent: 'Kies de kleur, of tik op je huis op de kaart om te wisselen.' }));
        parts.push(el('div', { className: 'status-choice' }, ...ORDER.map((s) => {
          const b = el('button', { type: 'button', className: me.effective === s ? 'active' : '', onclick: () => setStatus(s) },
            el('i', { className: `dot ${s === 'none' ? '' : s}` }), NAME[s]);
          b.setAttribute('aria-pressed', me.effective === s);
          return b;
        })));
        parts.push(el('p', { className: me.pending ? 'pending-msg' : 'muted', textContent: me.pending
          ? '⏳ Wacht op goedkeuring door de beheerder. Pas daarna zien anderen deze kleur.'
          : (me.effective === 'none' ? 'Je huis is niet gemarkeerd.' : '✔ Dit is de huidige (goedgekeurde) kleur.') }));
      }
      sheet.replaceChildren(...parts);
    }

    // Opnieuw ophalen (periodiek en bij terugkeer naar de app): nieuwe huisgegevens + eigen status/uitslag.
    let lastNotice = me.notice ? me.notice.at : null;
    Wijk.refreshResident = async (newHouses) => {
      if (newHouses) {
        houses = newHouses;
        sorted = [...houses].sort(Wijk.compareHouses);
        byId = new Map(houses.map((h) => [h.id, h]));
      }
      try {
        const next = await api('/me');
        me = next.claim ? next : { claim: null };
        store.set(CACHE, me.claim ? JSON.stringify(me) : null);
      } catch (e) { if (e.status === 403) { btn.hidden = true; leave(); } return; }
      if (me.notice && me.notice.at !== lastNotice) {
        toast(me.notice.decision === 'approved' ? 'Je wijziging is goedgekeurd ✔' : 'Je wijziging is niet doorgevoerd');
      }
      lastNotice = me.notice ? me.notice.at : null;
      if (on) { // wijzigmodus open: kaartlaag en venster bijwerken
        group && group.clearLayers();
        layers.clear();
        for (const h of houses) {
          const layer = L.polygon(h.points, styleFor(h)).addTo(group);
          layer.on('click', (e) => { L.DomEvent.stopPropagation(e); tap(h); });
          layers.set(h.id, layer);
        }
        restyle();
        render();
      } else {
        drawMine();
      }
    };
    drawMine();

    btn.onclick = () => (on ? leave() : enter());
    $('claim-no').onclick = () => $('claim-dialog').close('nee');
    $('claim-yes').onclick = () => $('claim-dialog').close('ja');

    // een uitslag van de beheerder die nog niet getoond is
    if (me.notice) { toast(me.notice.decision === 'approved' ? 'Je wijziging is goedgekeurd ✔' : 'Je wijziging is niet doorgevoerd'); }
  };
})();
