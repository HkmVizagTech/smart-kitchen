import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";

/**
 * Re-run something when the person comes back to the app, and on a timer.
 *
 * These screens are watched while somebody else acts: a booker waiting on
 * verification sits on a page whose state is changed on another person's
 * device. Loading once and never looking again left them staring at "with the
 * verification team" long after it had been approved — on a phone, where the
 * app had simply been in the background, that reads as broken.
 *
 * Both triggers matter: the focus/visibility one catches the common case of
 * switching back to the app, and the interval covers somebody leaving it open
 * on screen. `enabled` keeps it off entirely when there is nothing to wait for.
 */
export function useLiveRefresh(fn: () => void, enabled: boolean, everyMs = 15000) {
  // Held in a ref so changing the callback does not restart the timer.
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    if (!enabled) return;
    const run = () => latest.current();
    const onVisible = () => { if (!document.hidden) run(); };

    const timer = window.setInterval(run, everyMs);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, everyMs]);
}

/* ---------------- Modal ---------------- */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
  width,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        style={width ? { width } : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------------- Toasts ---------------- */
type Toast = { id: number; msg: string; kind: "ok" | "err" };
const ToastCtx = createContext<(msg: string, kind?: "ok" | "err") => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setList((l) => [...l, { id, msg, kind }]);
    setTimeout(() => setList((l) => l.filter((t) => t.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts">
        {list.map((t) => (
          <div key={t.id} className={`toast ${t.kind === "err" ? "err" : ""}`}>
            <i className={`ti ${t.kind === "err" ? "ti-alert-circle" : "ti-circle-check"}`} aria-hidden="true"></i>
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------------- Field ---------------- */
export function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
}) {
  return (
    <div className={full ? "full" : ""}>
      <label className="lab">{label}</label>
      {children}
    </div>
  );
}
