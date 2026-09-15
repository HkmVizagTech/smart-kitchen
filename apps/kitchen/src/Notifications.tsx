import { useEffect, useRef, useState } from "react";
import { api, Notif, NotifSummary } from "./api";

const ICON: Record<string, string> = {
  ORDER_PLACED: "ti-clipboard-plus",
  STATUS: "ti-truck-delivery",
  DELIVERED: "ti-checkup-list",
  CLOSEOUT_SUBMITTED: "ti-receipt",
  VERIFIED: "ti-circle-check",
  REJECTED: "ti-alert-triangle",
};

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function NotificationBell({
  onOpenSection,
  onSummary,
}: {
  onOpenSection?: (section: string) => void;
  onSummary?: (s: NotifSummary) => void;
}) {
  const [summary, setSummary] = useState<NotifSummary>({ unread: 0, sections: {} });
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<Notif[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  const load = () =>
    api.notifSummary().then((s) => { setSummary(s); onSummary?.(s); }).catch(() => {});

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (next) { try { setList(await api.notifications()); } catch {} }
  }
  async function click(n: Notif) {
    try { await api.markNotifRead(n.id); } catch {}
    setOpen(false);
    load();
    if (n.section) onOpenSection?.(n.section);
  }
  async function clearAll() {
    try { await api.markAllNotifsRead(); } catch {}
    setList((l) => l.map((n) => ({ ...n, read: true })));
    load();
  }

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="bell" onClick={toggle} aria-label="Notifications">
        <i className="ti ti-bell" aria-hidden="true"></i>
        {summary.unread > 0 && <span className="count">{summary.unread > 9 ? "9+" : summary.unread}</span>}
      </button>
      {open && (
        <div className="notif-panel">
          <div className="notif-head">
            <span className="t">Notifications</span>
            {summary.unread > 0 && <button className="btn ghost sm" onClick={clearAll}>Mark all read</button>}
          </div>
          <div className="notif-list">
            {list.length === 0 ? (
              <div className="notif-empty">You're all caught up.</div>
            ) : (
              list.map((n) => (
                <div key={n.id} className={`notif-item ${n.read ? "" : "unread"}`} onClick={() => click(n)}>
                  <span className="notif-ic"><i className={`ti ${ICON[n.type] || "ti-bell"}`} aria-hidden="true"></i></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="nt">{n.title}</div>
                    <div className="nb">{n.body}</div>
                    <div className="nd">{ago(n.createdAt)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
