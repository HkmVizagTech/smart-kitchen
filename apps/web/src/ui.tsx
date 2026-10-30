import { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from "react";
import type { Paged } from "./api";

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

// ---------------------------------------------------------------- pagination
export const PAGE_SIZES = [15, 30, 50];

/**
 * A list fetched one page at a time.
 *
 * `fetcher` must be stable per set of filters: whatever it closes over goes in
 * `deps`, and changing any of it sends the list back to page 1. The previous
 * page stays on screen while the next one loads, so searching or turning a page
 * does not blank the screen (and an open search box keeps its focus).
 */
export function usePaged<T>(fetcher: (page: number, pageSize: number) => Promise<Paged<T>>, deps: unknown[]) {
  const key = JSON.stringify(deps);
  const [size, setSizeState] = useState(PAGE_SIZES[0]);
  const [pg, setPg] = useState({ key: `${key}|${size}`, page: 1 });
  const cur = `${key}|${size}`;
  const page = pg.key === cur ? pg.page : 1;
  const [res, setRes] = useState<Paged<T> | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback((quiet = false) => {
    const id = ++seq.current;
    if (!quiet) setLoading(true);
    fetchRef.current(page, size)
      .then((r) => {
        if (id !== seq.current) return;
        setRes(r);
        setError("");
        // the server pulls a page past the end back to the last one
        if (r.page !== page) setPg({ key: cur, page: r.page });
      })
      .catch((e) => { if (id === seq.current && !quiet) setError(e.message); })
      .finally(() => { if (id === seq.current && !quiet) setLoading(false); });
  }, [page, size, cur]);

  useEffect(() => { load(); }, [load]);

  return {
    items: res?.items ?? [],
    total: res?.total ?? 0,
    pages: res?.pages ?? 1,
    page,
    pageSize: size,
    /** true until the first page has arrived */
    initial: res === null && loading,
    loading,
    error,
    setPage: (n: number) => setPg({ key: cur, page: n }),
    setPageSize: (n: number) => setSizeState(n),
    reload: load,
  };
}

/** 1 … 4 5 [6] 7 8 … 20 — the numbers to show, with null for a gap. */
function pageWindow(page: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const out: (number | null)[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pages - 1, page + 1);
  if (from > 2) out.push(null);
  for (let i = from; i <= to; i++) out.push(i);
  if (to < pages - 1) out.push(null);
  out.push(pages);
  return out;
}

export function Pagination({ page, pages, total, pageSize, onPage, onPageSize, busy }: {
  page: number; pages: number; total: number; pageSize: number;
  onPage: (n: number) => void; onPageSize?: (n: number) => void; busy?: boolean;
}) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  // nothing to turn: say how many there are and stop
  if (pages <= 1 && pageSize === PAGE_SIZES[0]) {
    return <div className="pager"><div className="pager-info">Showing {total === 1 ? "1 result" : `all ${total}`}</div></div>;
  }
  return (
    <nav className={`pager ${busy ? "busy" : ""}`} aria-label="Pagination">
      <div className="pager-info">Showing <b>{from}–{to}</b> of <b>{total}</b></div>
      <div className="pager-ctl">
        {onPageSize && (
          <label className="pager-size">
            <span>Per page</span>
            <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
              {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}
        <div className="pager-nav">
          <button className="pg" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 6l-6 6l6 6" /></svg>
          </button>
          <span className="pager-now">Page {page} of {pages}</span>
          <span className="pager-nums">
            {pageWindow(page, pages).map((n, i) =>
              n === null
                ? <span className="pg gap" key={`g${i}`}>…</span>
                : <button key={n} className={`pg ${n === page ? "on" : ""}`} onClick={() => onPage(n)}
                    aria-current={n === page ? "page" : undefined}>{n}</button>
            )}
          </span>
          <button className="pg" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6l-6 6" /></svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
