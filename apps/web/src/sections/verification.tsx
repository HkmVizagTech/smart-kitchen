// Verification screens: close-outs awaiting approval, and the verified history.
// Lifted out of the old standalone verification app's App.tsx.

import { useEffect, useState } from "react";
import { api, Done, Pending } from "../api";

const SES: Record<string, string> = { BREAKFAST: "Tiffin", LUNCH: "Lunch", DINNER: "Dinner" };

function Stars({ n }: { n: number | null }) {
  if (!n) return <span className="muted">—</span>;
  return (
    <span aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i
          key={i}
          className={i <= n ? "ti ti-star-filled" : "ti ti-star"}
          style={{ color: i <= n ? "var(--saffron)" : "var(--muted)" }}
          aria-hidden="true"
        ></i>
      ))}
    </span>
  );
}

export function Verify() {
  const [list, setList] = useState<Pending[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      setList(await api.pending());
      setError("");
    } catch (e: any) {
      setError(e.message);
    }
  }
  useEffect(() => {
    load();
  }, []);

  // Who verified is taken from the signed-in session on the server — it is no
  // longer passed from the client.
  async function act(orderId: number, approve: boolean) {
    setBusy(true);
    try {
      await api.verify(orderId, approve);
      await load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="err">{error}</p>;
  if (!list) return <p className="muted">Loading…</p>;
  if (list.length === 0)
    return (
      <div className="card soft empty">
        <p className="muted">Nothing awaiting verification. All caught up.</p>
      </div>
    );

  return (
    <>
      <div className="section-title">To verify</div>
      <p className="muted">{list.length} awaiting verification</p>
      {list.map((p) => (
        <div className="card" key={p.orderId}>
          <div className="between">
            <div className="section-title">
              {p.unit} · {SES[p.session]} <span className="pill">{new Date(p.date).toDateString()}</span>
            </div>
            <div className="row">
              <button className="btn accent" disabled={busy} onClick={() => act(p.orderId, true)}>
                Approve
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => act(p.orderId, false)}>
                Reject
              </button>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {p.items.map((it) => (
              <div className="vline" key={it.name}>
                <span className="vn">{it.name}</span>
                <span className="vv">
                  ordered {it.ordered} · consumed {it.consumed}
                  {it.extra > 0 ? <span className="pill" style={{ marginLeft: 6 }}>+{it.extra}</span> : null} · left{" "}
                  {it.leftover}
                </span>
              </div>
            ))}
            <div className="vtotal">
              <span>Total</span>
              <span className="vv">
                ordered {p.received} · consumed {p.consumed} · left {p.leftover}
              </span>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10, gap: 18 }}>
            <span>Taste: <Stars n={p.taste} /></span>
            <span>Quality: <Stars n={p.quality} /></span>
          </div>
          {p.remarks ? <p className="muted" style={{ marginTop: 6 }}>Remarks: {p.remarks}</p> : null}
          {p.notes ? <p className="muted" style={{ marginTop: 4 }}>Notes: {p.notes}</p> : null}
        </div>
      ))}
    </>
  );
}

export function Payments() {
  const [list, setList] = useState<Done[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    api.done().then(setList).catch((e) => setError(e.message));
  }, []);
  if (error) return <p className="err">{error}</p>;
  if (!list) return <p className="muted">Loading…</p>;

  const byUnit: Record<string, number> = {};
  list.forEach((d) => (byUnit[d.unit] = (byUnit[d.unit] || 0) + d.consumed));

  return (
    <>
      <div className="card">
        <div className="section-title">Verified plates per section</div>
        <div className="tablewrap">
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Section</th>
                <th>Consumed plates (verified)</th>
              </tr>
            </thead>
            <tbody>
              {Object.keys(byUnit).map((u) => (
                <tr key={u}>
                  <td style={{ fontWeight: 500 }}>{u}</td>
                  <td>{byUnit[u]}</td>
                </tr>
              ))}
              {Object.keys(byUnit).length === 0 && (
                <tr>
                  <td colSpan={2} className="muted">No verified orders yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <div className="section-title">Recent verified orders</div>
        <div className="tablewrap">
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Section</th>
                <th>Meal</th>
                <th>Date</th>
                <th>Consumed</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.orderId}>
                  <td>{d.unit}</td>
                  <td>{SES[d.session]}</td>
                  <td>{new Date(d.date).toDateString()}</td>
                  <td>{d.consumed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
