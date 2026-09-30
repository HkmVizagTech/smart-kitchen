// Service worker registration only.
//
// The install prompt used to live here too, as a floating button appended to
// <body>. It covered page content, it could not be styled with the rest of the
// app, and once the booking screen grew a pinned confirm bar the two overlapped.
// It now lives in the app itself — see src/Install.tsx — which can also explain
// what installing actually does.
(function () {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }
})();
