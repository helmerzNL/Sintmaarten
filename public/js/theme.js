// Licht/donker: de keuze van de bezoeker (localStorage) gaat voor de instelling van het apparaat.
// Dit script staat in <head> en draait vóór het eerste tekenen, zodat er niets knippert.
(function () {
  const KEY = 'sm-theme';
  const root = document.documentElement;
  const stored = () => { try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : null; } catch { return null; } };
  const system = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const current = () => stored() || system();
  const apply = () => {
    const s = stored();
    if (s) root.setAttribute('data-theme', s); else root.removeAttribute('data-theme');
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) { m.dataset.light = m.dataset.light || m.content; m.content = current() === 'dark' ? '#151a17' : m.dataset.light; }
  };
  apply();
  window.SMTheme = {
    current,
    toggle() {
      const next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch { /* geen opslag: alleen deze pagina */ }
      root.setAttribute('data-theme', next);
      apply();
      window.dispatchEvent(new CustomEvent('sm-theme', { detail: next }));
      return next;
    },
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!stored()) apply(); });
})();
