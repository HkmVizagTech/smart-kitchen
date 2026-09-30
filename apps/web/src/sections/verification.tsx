// Verification screens: close-outs awaiting approval, and the verified history.
//
// Approving freezes what the meal is worth (consumed plates x the dish's rate).
// Returning one now requires a reason — the booker used to get "please review
// and resubmit" and nothing else, which told them to change something without
// saying what.

import { useEffect, useState } from "react";
import { api, Done, Pending } from "../api";

const SES: Record<string, string> = { BREAKFAST: "Tiffin", LUNCH: "Lunch", DINNER: "Dinner" };

/** Rupees, or a dash when no rate has been set for the dishes involved. */
export const money = (n: number | null | undefined) =>
  n == null ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

function Stars({ n }: { n: number | null }) {
  if (!n) return <span className="muted">—</span>;
  return (
    <span aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i
          key={i}
          className={i <= n ? "ti ti-star-filled" : "ti ti-star"}
          style={{ color: i <= n ? "var(--warn)" : "var(--border-2)" }}
          aria-hidden="true"
        ></i>
      ))}
    </span>
  );
}

// A few reasons cover almost every return, so offer them as one tap and keep
// the free-text box for the rest.
const COMMON_REASONS = [
  "Consumed count looks too high",
  "Consumed count looks too low",
  "Leftover not explained",
  "Wrong meal or date",
];

function ReturnBox({ busy, onCancel, onSend }: {
  busy: boolean; onCancel: () => void; onSend: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const ok = reason.trim().length >= 3;
  return (
    <div className="return-box">
      <label className="lab" htmlFor="return-reason">Why are you sending it back?</label>
      <div className="reason-chips">
        {COMMON_REASONS.map((r) => (
          <button type="button" key={r} className={`dp-chip ${reason === r ? "on" : ""}`} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
      <input
        id="return-reason"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="or type the reason…"
        style={{ marginTop: 10 }}
      />
      <div className="row" style={{ marginTop: 12, gap: 8 }}>
        <button className="btn ghost sm" disabled={busy} onClick={onCancel}>Cancel</button>
        <button className="btn danger sm" disabled={busy || !ok} onClick={() => onSend(reason.trim())}>
          {busy ? "Sending…" : "Send back"}
        </button>
      </div>
      {!ok && reason.length > 0 && <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>A few more words, please.</p>}
    </div>
  );
}

export function Verify() {
  const [list, setList] = useState<Pending[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // Which close-out is being returned, if any.
  const [returning, setReturning] = useState<number | null>(null);

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
  async function act(orderId: number, approve: boolean, reason?: string) {
    setBusy(true);
    try {
      await api.verify(orderId, approve, reason);
      setReturning(null);
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
      <>
        <h1>To verify</h1>
        <div className="empty">
          <i className="ti ti-checks" aria-hidden="true"></i>
          Nothing awaiting verification — all caught up.
        </div>
      </>
    );

  return (
    <>
      <h1>To verify</h1>
      <p className="muted">{list.length} close-out{list.length === 1 ? "" : "s"} awaiting your review</p>
      {list.map((p) => (
        <div className="card" key={p.orderId}>
          <div className="between">
            <div className="section-title">
              {p.unit} · {SES[p.session]} <span className="pill">{new Date(p.date).toDateString()}</span>
            </div>
            {returning !== p.orderId && (
              <div className="row">
                <button className="btn ghost sm" disabled={busy} onClick={() => setReturning(p.orderId)}>
                  Send back
                </button>
                <button className="btn sm" disabled={busy} onClick={() => act(p.orderId, true)}>
                  Approve
                </button>
              </div>
            )}
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
          {p.notes ? <p className="muted" style={{ marginTop: 10 }}>Notes: {p.notes}</p> : null}
          <p className="muted" style={{ marginTop: 6 }}>
            You are checking the plate counts. The booker gives their feedback on the food after
            you approve these figures.
          </p>

          {returning === p.orderId && (
            <ReturnBox
              busy={busy}
              onCancel={() => setReturning(null)}
              onSend={(reason) => act(p.orderId, false, reason)}
            />
          )}
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

  // Plates and rupees per route. Amount is null on anything verified before
  // rates existed, so it is summed separately from the plate count rather than
  // being treated as zero.
  const byUnit: Record<string, { plates: number; amount: number; priced: number }> = {};
  for (const d of list) {
    const row = (byUnit[d.unit] ??= { plates: 0, amount: 0, priced: 0 });
    row.plates += d.consumed;
    if (d.amount != null) { row.amount += d.amount; row.priced += 1; }
  }
  const grand = list.reduce((a, d) => a + (d.amount ?? 0), 0);
  const unpriced = list.filter((d) => d.amount == null).length;

  return (
    <>
      <h1>Payments</h1>
      <p className="muted">Based on plates actually consumed, at each dish's rate.</p>

      {unpriced > 0 && (
        <div className="note">
          <i className="ti ti-info-circle" aria-hidden="true"></i>
          <span>
            {unpriced} verified meal{unpriced === 1 ? " has" : "s have"} no amount — {unpriced === 1 ? "it was" : "they were"}{" "}
            approved before any rate was set. Set a rate under <b>Dishes</b> or <b>Settings</b>; it applies to meals verified from then on.
          </span>
        </div>
      )}

      <div className="stats-grid">
        <div className="stat">
          <div className="l">Total owed</div>
          <div className="n">{money(grand)}</div>
          <div className="s">{list.length} verified meals</div>
        </div>
        <div className="stat">
          <div className="l">Plates consumed</div>
          <div className="n">{list.reduce((a, d) => a + d.consumed, 0)}</div>
          <div className="s">verified only</div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Per route</div>
        <div className="tablewrap">
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Route</th>
                <th>Meals</th>
                <th>Consumed plates</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(byUnit).map(([u, v]) => (
                <tr key={u}>
                  <td style={{ fontWeight: 600 }}>{u}</td>
                  <td>{v.priced}</td>
                  <td>{v.plates}</td>
                  <td style={{ fontWeight: 700 }}>{money(v.amount)}</td>
                </tr>
              ))}
              {Object.keys(byUnit).length === 0 && (
                <tr>
                  <td colSpan={4} className="muted">No verified meals yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Recent verified meals</div>
        <div className="tablewrap">
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Route</th>
                <th>Meal</th>
                <th>Date</th>
                <th>Consumed</th>
                <th>Amount</th>
              </tr>
            </thead>
            <tbody>
              {list.map((d) => (
                <tr key={d.orderId}>
                  <td>{d.unit}</td>
                  <td>{SES[d.session]}</td>
                  <td>{new Date(d.date).toDateString()}</td>
                  <td>{d.consumed}</td>
                  <td style={{ fontWeight: 700 }}>{money(d.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
