// The kitchen's order list for a given cooking date.
// Lifted verbatim out of the old standalone kitchen app's App.tsx so it can
// live alongside the other roles' sections in one shell. The packing sheet is
// its own file (./packing).

import { useEffect, useState } from "react";
import { api, Order } from "../api";

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

export function KitchenOrders({ date }: { date: string }) {
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
        const totalPlates = list.reduce((a, o) => a + (o.totalPlates ?? o.peopleCount ?? 0), 0);
        return (
          <div className="card" key={key}>
            <div className="section-title">
              {label}{" "}
              <span className="pill">
                {list.length} {list.length === 1 ? "section" : "sections"} · {totalPlates} plates
              </span>
            </div>
            <div className="bulkbar">
              <button className="btn ghost sm" disabled={busy} onClick={() => bulk(key, "PREPARING")}>Preparing</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => bulk(key, "DISPATCHED")}>Dispatched</button>
              <button className="btn accent sm" disabled={busy} onClick={() => bulk(key, "DELIVERED")}>Delivered</button>
            </div>
            <div className="olist">
              {list.map((o) => {
                const n = NEXT[o.status];
                const itemsText =
                  o.items.length > 0
                    ? o.items.map((it) => `${it.plates}× ${it.dish.name}`).join("  ·  ")
                    : `count: ${o.peopleCount ?? 0}`;
                const done = o.status === "DELIVERED" || o.status === "CLOSED";
                return (
                  <div className="ocard" key={o.id}>
                    <div className="top">
                      <div>
                        <div className="ounit">
                          {o.unit.name}
                          {o.isEmergency ? <span className="pill red" style={{ marginLeft: 8 }}>emergency</span> : null}
                        </div>
                        <div className="oplates">{o.totalPlates ?? o.peopleCount ?? 0} plates</div>
                      </div>
                      <span className={`badge b-${o.status}`}>{o.status}</span>
                    </div>
                    <div className="oitems">{itemsText}</div>
                    <div className="ofoot">
                      {done ? (
                        <span className="odone"><i className="ti ti-check" aria-hidden="true"></i> Delivered</span>
                      ) : (
                        <span className="muted" style={{ fontSize: 13 }}>Tap to advance →</span>
                      )}
                      {!done && n ? (
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
