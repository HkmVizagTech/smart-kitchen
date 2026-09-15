import { createContext, useContext, useState, useCallback, ReactNode } from "react";

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
