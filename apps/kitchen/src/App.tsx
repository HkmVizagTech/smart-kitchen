import { useEffect, useState } from "react";
import { api, AuthedUser, NotifSummary, clearToken, getToken, Order } from "./api";
import { tomorrow, ymd } from "./util";
import { LogoMark } from "./Logo";
import { NotificationBell } from "./Notifications";
import { OtaUpdate } from "./OtaUpdate";
import Packing from "./Packing";
import Auth from "./Auth";

type View = "orders" | "packing";

const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

export default function App() {
  const [me, setMe] = useState<AuthedUser | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("orders");
  const [date, setDate] = useState(ymd(tomorrow()));
  const [notif, setNotif] = useState<NotifSummary>({ unread: 0, sections: {} });

  // restore session
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.me().then((r) => setMe(r.user)).catch(() => clearToken()).finally(() => setReady(true));
  }, []);

  function signOut() { clearToken(); setMe(null); setView("orders"); }

  if (!ready) return <div className="auth"><div className="auth-hero"><div className="auth-brand">Loading…</div></div></div>;
  if (!me) return <Auth role="KITCHEN_ADMIN" subtitle="Cook · Pack · Dispatch" onAuthed={(u) => { setMe(u); setView("orders"); }} />;

  const nav = (v: View) => { setView(v); };

  return (
    <div className="app">
      <div className="navbar">
        <div className="left">
          <div className="logo"><LogoMark size={40} /></div>
          <div className="brand">
            <div className="title">Akshaya Patra Kitchen</div>
            <div className="sub">Cook · Pack · Dispatch</div>
          </div>
        </div>
        <div className="user">
          <NotificationBell onSummary={setNotif} onOpenSection={(s) => { if (s === "orders") setView("orders"); }} />
          <div className="uchip">
            <span className="uavatar">{me.photo ? <img src={me.photo} alt="" /> : initials(me.name)}</span>
            <span className="umeta">
              <span className="uname">{me.name}</span>
              <span className="urole">Kitchen</span>
            </span>
          </div>
          <button className="signout" onClick={signOut} aria-label="Sign out">
            <i className="ti ti-logout" aria-hidden="true"></i><span className="lbl">Sign out</span>
          </button>
        </div>
      </div>

      <OtaUpdate app="kitchen" />

      <div className="shell">
        <aside className="sidebar">
          <div className="secthead">Kitchen</div>
          <div className="nav">
            <div className={`item ${view === "orders" ? "active" : ""}`} onClick={() => nav("orders")}>
              <i className="ti ti-clipboard-list" aria-hidden="true"></i> Orders
              {notif.sections["orders"] ? <span className="navdot" /> : null}
            </div>
            <div className={`item ${view === "packing" ? "active" : ""}`} onClick={() => nav("packing")}>
              <i className="ti ti-file-spreadsheet" aria-hidden="true"></i> Packing Sheet
            </div>
          </div>
        </aside>

        <main className="main">
          <div className="toolbar">
            <span className="muted">Cooking date</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ width: "auto" }}
            />
          </div>

          {view === "orders" ? <OrdersView date={date} /> : <Packing date={date} />}
        </main>
      </div>
    </div>
  );
}

const SESSIONS: { key: "BREAKFAST" | "LUNCH" | "DINNER"; label: string }[] = [
  { key: "BREAKFAST", label: "Morning Tiffin" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
];

const NEXT: Record<string, { status: string; label: string } | null> = {
  PLACED: { status: "PREPARING", label: "Start preparing" },
  PREPARING: { status: "DISPATCHED", label: "Mark dispatched" },
  DISPATCHED: { status: "DELIVERED", label: "Mark delivered" },
  DELIVERED: null,
  CLOSED: null,
};

function OrdersView({ date }: { date: string }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setOrders(await api.orders(date));
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    setOrders(null);
    load();
  }, [date]);

  async function advance(o: Order) {
    const n = NEXT[o.status];
    if (!n) return;
    setBusy(true);
    try {
      await api.setStatus(o.id, n.status);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function bulk(session: string, status: string) {
    setBusy(true);
    try {
      await api.bulkStatus(date, session, status);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="err">{error}</p>;
  if (!orders) return <p className="muted">Loading…</p>;
  if (orders.length === 0)
    return (
      <div className="empty">
        <i className="ti ti-clipboard-off" aria-hidden="true"></i>
        No orders for {date}.
      </div>
    );

  return (
    <>
      {SESSIONS.map(({ key, label }) => {
        const list = orders.filter((o) => o.session === key);
        if (list.length === 0) return null;
        const totalPlates = list.reduce(
          (a, o) => a + (o.totalPlates ?? o.peopleCount ?? 0),
          0
        );
        return (
          <div className="card" key={key}>
            <div className="section-title">
              {label} <span className="pill">{list.length} {list.length === 1 ? "section" : "sections"} · {totalPlates} plates</span>
            </div>
            <div className="bulkbar">
              <button className="btn ghost sm" disabled={busy} onClick={() => bulk(key, "PREPARING")}>Preparing</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => bulk(key, "DISPATCHED")}>Dispatched</button>
              <button className="btn accent sm" disabled={busy} onClick={() => bulk(key, "DELIVERED")}>Delivered</button>
            </div>
            <div className="olist">
              {list.map((o) => {
                const n = NEXT[o.status];
                const itemsText = o.items.length > 0
                  ? o.items.map((it) => `${it.plates}× ${it.dish.name}`).join("  ·  ")
                  : `count: ${o.peopleCount ?? 0}`;
                return (
                  <div className="ocard" key={o.id}>
                    <div className="top">
                      <div>
                        <div className="ounit">{o.unit.name}{o.isEmergency ? <span className="pill red" style={{ marginLeft: 8 }}>emergency</span> : null}</div>
                        <div className="oplates">{o.totalPlates ?? o.peopleCount ?? 0} plates</div>
                      </div>
                      <span className={`badge b-${o.status}`}>{o.status}</span>
                    </div>
                    <div className="oitems">{itemsText}</div>
                    <div className="ofoot">
                      {o.status === "DELIVERED" || o.status === "CLOSED" ? (
                        <span className="odone"><i className="ti ti-check" aria-hidden="true"></i> Delivered</span>
                      ) : <span className="muted" style={{ fontSize: 13 }}>Tap to advance →</span>}
                      {o.status === "DELIVERED" || o.status === "CLOSED" ? null : n ? (
                        <button className="btn sm" disabled={busy} onClick={() => advance(o)}>{n.label}</button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

