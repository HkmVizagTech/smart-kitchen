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

// The order the kitchen moves through. Mirrors ORDER_FLOW on the API, which
// only ever moves an order FORWARD: a bulk move to a status touches just the
// orders currently behind it.
const FLOW = ["PLACED", "PREPARING", "DISPATCHED", "DELIVERED"];
const BULK: { status: string; label: string }[] = [
  { status: "PREPARING", label: "Preparing" },
  { status: "DISPATCHED", label: "Dispatched" },
  { status: "DELIVERED", label: "Delivered" },
];

type PendingBulk = { session: string; status: string; label: string; count: number };

/** Moves every order in one session at once — so it says so, in the button, and
 *  asks before doing it. Bulk actions and filters must not look alike.
 *
 *  Each target carries its own count, because the API only moves orders that
 *  are behind that status: with one order already dispatched, "Preparing" moves
 *  fewer than "Delivered" does, and a single shared number would lie about one
 *  of them. */
function BulkBar({ session, sessionLabel, orders, busy, pending, onPick, onConfirm }: {
  session: string; sessionLabel: string; orders: Order[]; busy: boolean;
  pending: PendingBulk | null;
  onPick: (p: PendingBulk | null) => void;
  onConfirm: (session: string, status: string) => void;
}) {
  const affected = (target: string) =>
    orders.filter((o) => FLOW.indexOf(o.status) > -1 && FLOW.indexOf(o.status) < FLOW.indexOf(target)).length;

  const mine = pending && pending.session === session ? pending : null;

  if (mine) {
    const n = mine.count;
    return (
      <div className="bulkbar confirming">
        <span className="bulk-ask">
          Move <b>{n === 1 ? "1" : `all ${n}`}</b> {sessionLabel.toLowerCase()} {n === 1 ? "order" : "orders"} to{" "}
          <b>{mine.label}</b>?
        </span>
        <div className="bulk-actions">
          <button className="btn ghost sm" disabled={busy} onClick={() => onPick(null)}>Cancel</button>
          <button className="btn sm" disabled={busy} onClick={() => onConfirm(session, mine.status)}>
            {busy ? "Moving…" : `Yes, move ${n === 1 ? "it" : `all ${n}`}`}
          </button>
        </div>
      </div>
    );
  }

  const targets = BULK.map((b) => ({ ...b, n: affected(b.status) })).filter((b) => b.n > 0);
  // Every order in this session is already delivered — nothing to move.
  if (targets.length === 0) return null;

  return (
    <div className="bulkbar">
      <span className="bulk-lead">Move all to</span>
      <div className="bulk-actions">
        {targets.map((b) => (
          <button
            key={b.status} className="btn ghost sm" disabled={busy}
            onClick={() => onPick({ session, status: b.status, label: b.label, count: b.n })}
          >
            {b.label} <span className="bulk-n">{b.n}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function KitchenOrders({ date }: { date: string }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // A bulk move waiting on confirmation. These buttons used to sit in a row
  // styled like tabs — with "Delivered" filled solid, as though it were the
  // selected one — while actually moving EVERY order in the session. One stray
  // tap while trying to filter marked a whole meal delivered.
  const [pendingBulk, setPendingBulk] =
    useState<{ session: string; status: string; label: string; count: number } | null>(null);

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
      setPendingBulk(null);
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
            <BulkBar
              session={key}
              sessionLabel={label}
              orders={list}
              busy={busy}
              pending={pendingBulk}
              onPick={setPendingBulk}
              onConfirm={bulk}
            />
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
                        // The old copy said "Tap to advance →", but the card
                        // itself was never tappable — only the button was.
                        <span className="muted" style={{ fontSize: 13 }}>Next step</span>
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
