// PWA: service worker registreren en "Installeer app"-knop tonen.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  // Eenmalig (per apparaat) een melding om de app te installeren: Android, iOS en Windows.
  const KEY = 'sm-install-asked';
  const ua = navigator.userAgent;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const platform = isIos ? 'ios' : /android/i.test(ua) ? 'android' : /windows/i.test(ua) ? 'windows' : null;
  const asked = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const markAsked = () => { try { localStorage.setItem(KEY, '1'); } catch {} };

  let deferred = null, shown = false;
  const $ = (id) => document.getElementById(id);

  function show() {
    const dlg = $('install-dialog');
    if (shown || !dlg || !platform || standalone() || asked()) return;
    // wacht tot er geen ander venster (bijv. de uitleg) open staat
    if (document.querySelector('dialog[open]')) return setTimeout(show, 1500);
    if (platform !== 'ios' && !deferred) return; // zonder installatieprompt van de browser valt er niets te tonen
    shown = true;
    markAsked();
    $('install-text').textContent = platform === 'ios'
      ? 'Zet de kaart op je beginscherm: tik op het deel-icoon (vierkantje met pijl) in Safari en kies "Zet in beginscherm". Dan werkt hij als een app, ook zonder internet.'
      : 'Installeer de kaart als app: sneller openen, een eigen icoon en gebruik zonder internet.';
    $('install-go').hidden = platform === 'ios';
    const close = () => dlg.close();
    $('install-x').onclick = $('install-later').onclick = close;
    $('install-go').onclick = async () => {
      close();
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => {});
      deferred = null;
    };
    dlg.showModal();
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    setTimeout(show, 3000);
  });
  window.addEventListener('appinstalled', () => { deferred = null; markAsked(); if ($('install-dialog')?.open) $('install-dialog').close(); });
  document.addEventListener('DOMContentLoaded', () => { if (platform === 'ios') setTimeout(show, 3000); });

  // offline-indicator
  function sync() {
    const el = document.getElementById('offline');
    if (el) el.hidden = navigator.onLine;
  }
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  document.addEventListener('DOMContentLoaded', sync);
})();
