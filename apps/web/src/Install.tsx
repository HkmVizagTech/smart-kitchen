// "Install this app" — as a banner inside the app, not a floating pill.
//
// The old prompt was a fixed button glued to the bottom of the viewport. It
// covered whatever was underneath it, and once the booking screen grew its own
// pinned confirm bar the two sat on top of each other. It also never
// explained what installing does, and on iOS it opened a bare alert().
//
// Installing matters here: the people using this are on phones, in a kitchen,
// and an installed PWA opens full-screen from the home screen like any other
// app instead of being hunted for in a browser tab.

import { useEffect, useState } from "react";

/** The Chromium-only event that lets a page trigger the install sheet. */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "sk.install.dismissed";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (window.navigator as unknown as { standalone?: boolean }).standalone === true;

const isIosSafari = () => {
  const ua = navigator.userAgent;
  return /iphone|ipad|ipod/i.test(ua) && /^((?!chrome|crios|fxios|android).)*safari/i.test(ua);
};

// Browser storage is per-device and can throw (private mode, blocked cookies),
// so a failure here must never stop the banner rendering.
const stored = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const store = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

export default function InstallBanner() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [dismissed, setDismissed] = useState(() => stored(DISMISS_KEY) === "1");

  useEffect(() => {
    if (isStandalone()) return; // already installed — nothing to offer
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    // iOS gives no event at all; the only route is the Share sheet, so the
    // banner has to appear on its own and explain the manual steps.
    if (isIosSafari()) setIos(true);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (dismissed || isStandalone()) return null;
  if (!evt && !ios) return null;

  function close() {
    setDismissed(true);
    store(DISMISS_KEY, "1");
  }

  async function install() {
    if (!evt) { setShowIosSteps(true); return; }
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    if (outcome === "accepted") close();
    setEvt(null);
  }

  return (
    <>
      <div className="install-bar">
        <span className="install-ic" aria-hidden="true"><i className="ti ti-device-mobile-down"></i></span>
        <div className="install-text">
          <b>Add Akshaya Patra Kitchen to your phone</b>
          <span>Opens full screen from your home screen, like any other app.</span>
        </div>
        <div className="install-actions">
          <button className="btn ghost sm" onClick={close}>Not now</button>
          <button className="btn sm" onClick={install}>{ios ? "How" : "Install"}</button>
        </div>
      </div>

      {showIosSteps && (
        <div className="modal-overlay" onClick={() => setShowIosSteps(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Install on iPhone">
            <div className="modal-head">
              <b>Add to your home screen</b>
              <button className="x" onClick={() => setShowIosSteps(false)} aria-label="Close">
                <i className="ti ti-x" aria-hidden="true"></i>
              </button>
            </div>
            <div className="modal-body">
              <ol className="steps">
                <li>Tap the <b>Share</b> button at the bottom of Safari <i className="ti ti-share" aria-hidden="true"></i></li>
                <li>Scroll down and choose <b>Add to Home Screen</b></li>
                <li>Tap <b>Add</b> — the icon appears with your other apps</li>
              </ol>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => { setShowIosSteps(false); close(); }}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
