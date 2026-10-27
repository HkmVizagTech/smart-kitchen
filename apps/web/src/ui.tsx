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
/**
 * "1 order", not "1 orders".
 *
 * Counts are shown all over the app and several of them read as a mistake at
 * exactly one, which is the number a quiet day produces most often.
 */
export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

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
  // Escape closes it, and the page behind stops scrolling while it is open —
  // on a phone the sheet otherwise drags the whole page with it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={width ? ({ "--mw": `${width}px` } as React.CSSProperties) : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-grab" aria-hidden="true" />
        <div className="modal-head">
          <div>
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><i className="ti ti-x" aria-hidden="true"></i></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/**
 * Turns every data table into a stack of labelled cards on a phone.
 *
 * A six-column table on a 390px screen can only scroll sideways, and the
 * column that matters is usually the one off-screen. CSS (see "stacked tables"
 * in styles.css) does the layout at phone width; this only copies each header
 * onto its cells so the cards can say what each value is. Tables that really
 * are wide — the packing sheet — opt out with `.nostack` on their wrapper.
 */
export function useStackedTables() {
  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>(".tablewrap:not(.nostack) table").forEach((t) => {
        const heads = Array.from(t.querySelectorAll("thead th")).map((h) => (h.textContent ?? "").trim());
        t.classList.add("stack");
        t.querySelectorAll("tbody tr").forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            if (heads[i] && td.getAttribute("data-label") !== heads[i]) td.setAttribute("data-label", heads[i]);
          });
        });
      });
    };
    label();
    const mo = new MutationObserver(label);
    mo.observe(document.getElementById("root")!, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, []);
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
