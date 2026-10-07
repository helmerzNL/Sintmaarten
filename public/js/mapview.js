// Kaartweergave met pan/zoom (muis, touch, pinch) en een SVG-laag voor de huizen.
// Coördinaten van huizen zijn fracties (0..1) van de afbeelding.
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  class MapView {
    constructor(viewport) {
      this.vp = viewport;
      this.stage = document.createElement('div');
      this.stage.className = 'stage';
      this.img = document.createElement('img');
      this.img.alt = 'Kaart van de wijk';
      this.svg = document.createElementNS(NS, 'svg');
      this.stage.append(this.img, this.svg);
      this.vp.append(this.stage);
      this.W = 0; this.H = 0;
      this.s = 1; this.tx = 0; this.ty = 0;
      this.listeners = {};
      this.pointers = new Map();
      this.moved = false;
      this._bind();
      new ResizeObserver(() => this.W && this.fit(true)).observe(this.vp);
    }

    on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return this; }
    emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }

    setMap(map) {
      return new Promise((resolve) => {
        if (!map) { this.W = 0; this.stage.style.display = 'none'; return resolve(); }
        this.stage.style.display = '';
        this.W = map.width; this.H = map.height;
        this.stage.style.width = `${this.W}px`;
        this.stage.style.height = `${this.H}px`;
        this.svg.setAttribute('viewBox', `0 0 ${this.W} ${this.H}`);
        this.img.onload = () => { this.fit(); resolve(); };
        this.img.src = map.url;
      });
    }

    fit(keepIfUserMoved) {
      const r = this.vp.getBoundingClientRect();
      if (!this.W || !r.width) return;
      const s = Math.min(r.width / this.W, r.height / this.H);
      this.minS = s * 0.9;
      this.maxS = Math.max(s * 12, 2);
      if (keepIfUserMoved && this.userMoved) return;
      this.s = s;
      this.tx = (r.width - this.W * s) / 2;
      this.ty = (r.height - this.H * s) / 2;
      this._apply();
    }

    _apply() {
      this.stage.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.s})`;
      this.emit('view', this.s);
    }

    zoomAt(factor, cx, cy) {
      const ns = Math.min(this.maxS, Math.max(this.minS, this.s * factor));
      const k = ns / this.s;
      this.tx = cx - (cx - this.tx) * k;
      this.ty = cy - (cy - this.ty) * k;
      this.s = ns;
      this.userMoved = true;
      this._apply();
    }

    zoomCenter(factor) {
      const r = this.vp.getBoundingClientRect();
      this.zoomAt(factor, r.width / 2, r.height / 2);
    }

    // schermcoördinaten -> fractie van de afbeelding
    toFraction(clientX, clientY) {
      const r = this.vp.getBoundingClientRect();
      const x = (clientX - r.left - this.tx) / this.s / this.W;
      const y = (clientY - r.top - this.ty) / this.s / this.H;
      return [x, y];
    }

    _bind() {
      const vp = this.vp;
      vp.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = vp.getBoundingClientRect();
        this.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
      }, { passive: false });

      vp.addEventListener('pointerdown', (e) => {
        if (e.target.closest('.zoombtns, .popup, button')) return;
        if (e.target.dataset && e.target.dataset.noPan) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        this.downAt = { x: e.clientX, y: e.clientY };
        this.moved = false;
        vp.setPointerCapture(e.pointerId);
        this._pinch = null;
      });

      vp.addEventListener('pointermove', (e) => {
        const p = this.pointers.get(e.pointerId);
        if (!p) return;
        const dx = e.clientX - p.x, dy = e.clientY - p.y;
        p.x = e.clientX; p.y = e.clientY;
        if (this.pointers.size === 1) {
          if (!this.moved && Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y) < 5) return;
          this.moved = true;
          vp.classList.add('dragging');
          this.tx += dx; this.ty += dy;
          this.userMoved = true;
          this._apply();
        } else if (this.pointers.size === 2) {
          this.moved = true;
          const [a, b] = [...this.pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const r = vp.getBoundingClientRect();
          if (this._pinch) this.zoomAt(dist / this._pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
          this._pinch = dist;
        }
      });

      const end = (e) => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.delete(e.pointerId);
        this._pinch = null;
        if (!this.pointers.size) {
          vp.classList.remove('dragging');
          if (!this.moved && e.type === 'pointerup') this.emit('tap', e);
        }
      };
      vp.addEventListener('pointerup', end);
      vp.addEventListener('pointercancel', end);
    }

    // Huis onder een (tap-)positie; pointer capture maakt e.target onbetrouwbaar.
    houseAt(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      return el && el.closest ? el.closest('.house') : null;
    }

    // helpers voor het tekenen
    polygon(house, cls) {
      const el = document.createElementNS(NS, 'polygon');
      el.setAttribute('points', house.points.map(([x, y]) => `${x * this.W},${y * this.H}`).join(' '));
      el.setAttribute('class', cls);
      return el;
    }
  }

  window.MapView = MapView;
})();
