// PWA: service worker registreren en "Installeer app"-knop tonen.
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }

  let deferred = null;
  const btn = () => document.getElementById('install');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (btn()) btn().hidden = false;
  });
  window.addEventListener('appinstalled', () => { deferred = null; if (btn()) btn().hidden = true; });
  document.addEventListener('DOMContentLoaded', () => {
    if (!btn()) return;
    btn().onclick = async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      btn().hidden = true;
    };
    // iOS Safari kent geen installatieprompt: toon een korte uitleg
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone;
    if (ios) {
      btn().hidden = false;
      btn().onclick = () => alert('Installeren op iPhone/iPad: tik op het deel-icoon in Safari en kies "Zet in beginscherm".');
    }
  });

  // offline-indicator
  function sync() {
    const el = document.getElementById('offline');
    if (el) el.hidden = navigator.onLine;
  }
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  document.addEventListener('DOMContentLoaded', sync);
})();
