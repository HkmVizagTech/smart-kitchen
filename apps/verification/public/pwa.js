(function () {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  if (standalone) return;
  function btn(label) {
    var b = document.createElement('button');
    b.innerHTML = '<span style="font-size:17px">↓</span> ' + label;
    b.setAttribute('aria-label', 'Install app');
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:18px;z-index:9999;background:linear-gradient(135deg,#ef8a33,#b8560f);color:#fff;border:none;border-radius:999px;padding:12px 22px;font:700 14px -apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;box-shadow:0 8px 24px rgba(124,45,18,.4);cursor:pointer;display:inline-flex;align-items:center;gap:7px;';
    return b;
  }
  var deferred = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault(); deferred = e;
    var b = btn('Install app');
    b.onclick = function () { b.remove(); deferred.prompt(); if (deferred.userChoice) deferred.userChoice.finally(function () { deferred = null; }); };
    document.body.appendChild(b);
    setTimeout(function () { if (document.body.contains(b)) b.style.opacity = '0.96'; }, 50);
  });
  var ua = navigator.userAgent;
  var isIOS = /iphone|ipad|ipod/i.test(ua);
  var isSafari = /^((?!chrome|crios|fxios|android).)*safari/i.test(ua);
  if (isIOS && isSafari) {
    window.addEventListener('load', function () {
      var b = btn('Add to Home Screen');
      b.onclick = function () { alert('To install: tap the Share button below, then choose “Add to Home Screen”.'); };
      document.body.appendChild(b);
    });
  }
})();
