import { useEffect, useState } from "react";
import { api, PackingSheet } from "../api";
import { ymd, today } from "../util";

export default function Packing({ date, setDate }: { date: string; setDate?: (d: string) => void }) {
  const [session, setSession] = useState<"BREAKFAST" | "LUNCH" | "DINNER">("BREAKFAST");
  const [sheet, setSheet] = useState<PackingSheet | null>(null);
  const [gate, setGate] = useState<{ ready: boolean; booked: number; total: number } | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setSheet(null);
    try {
      const res = await api.packing(date, session);
      setGate({ ready: res.ready, booked: res.booked, total: res.total });
      setMissing(res.missing ?? []);
      setSheet(res.sheet);
      setError("");
    } catch (e: any) {
      setError(e.message);
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, [date, session]);

  return (
    <div className="card">
      <div className="between">
        <div className="row">
          <button
            className={`btn sm ${session === "BREAKFAST" ? "" : "ghost"}`}
            onClick={() => setSession("BREAKFAST")}
          >
            Morning
          </button>
          {/* Lunch is derived rather than booked dish by dish — see the note
              under the table — but it packs and prints like the other two. */}
          <button
            className={`btn sm ${session === "LUNCH" ? "" : "ghost"}`}
            onClick={() => setSession("LUNCH")}
          >
            Lunch
          </button>
          <button
            className={`btn sm ${session === "DINNER" ? "" : "ghost"}`}
            onClick={() => setSession("DINNER")}
          >
            Evening
          </button>
        </div>
        <a
          className="btn ghost sm"
          href={api.deliveryNotesUrl(date, session)}
          target="_blank"
          rel="noreferrer"
          style={{ textDecoration: "none", marginRight: 8 }}
        >
          <i className="ti ti-printer" aria-hidden="true"></i> Delivery notes
        </a>
        <a
          className={`btn sm ${gate?.ready ? "" : "ghost"}`}
          href={api.packingExcelUrl(date, !gate?.ready)}
          style={{ textDecoration: "none" }}
        >
          <i className="ti ti-download" aria-hidden="true"></i>{" "}
          {gate?.ready ? "Download sheet" : "Download so far"}
        </a>
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="err">{error}</p>}

      {gate && !gate.ready && !loading && (
        <div className="card soft" style={{ marginTop: 12 }}>
          <div className="section-title">
            {gate.booked} of {gate.total} routes booked
          </div>
          <p className="muted" style={{ marginTop: 6 }}>
            {missing.length > 0 ? <>Still to book: <b>{missing.join(", ")}</b>. </> : null}
            The sheet below counts only what is in so far — it updates as the rest arrive.
          </p>
        </div>
      )}

      {/* Tiffin and dinner are booked today for tomorrow, so the cooking date
          starts on tomorrow. Lunch is same-day, which meant clicking Lunch
          usually landed on an empty sheet with no hint that the date was the
          reason. */}
      {session === "LUNCH" && date !== ymd(today()) && (
        <div className="card soft" style={{ marginTop: 12 }}>
          <div className="em-row">
            <p className="muted" style={{ margin: 0 }}>
              Lunch is ordered and served on the same day, and this sheet is set to{" "}
              <b>{new Date(date).toDateString()}</b>.
            </p>
            {setDate && (
              <button className="btn sm" onClick={() => setDate(ymd(today()))}>
                Show today's lunch
              </button>
            )}
          </div>
        </div>
      )}

      {/* Lunch is booked as a headcount, so its dish quantities are worked out
          from the lunch menu rather than typed by the booker. Saying so stops
          the kitchen hunting for who entered these numbers. */}
      {session === "LUNCH" && sheet && sheet.rows.length > 0 && (
        <p className="muted" style={{ marginTop: 10 }}>
          <i className="ti ti-info-circle" aria-hidden="true"></i>{" "}
          Lunch is booked by headcount. Quantities below come from the lunch menu for this
          date — change the menu and this sheet follows. Totals are people, not plates.
        </p>
      )}

      {sheet && sheet.rows.length === 0 && <p className="muted">No orders for this session.</p>}
      {sheet && sheet.rows.length > 0 && (
        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>S.No</th>
                <th rowSpan={2}>Route</th>
                {sheet.indentDishes.length > 0 && (
                  <th colSpan={sheet.indentDishes.length} className="grp">Indent (plates)</th>
                )}
                <th rowSpan={2}>Total</th>
                {sheet.dishOrder.map((d) => (
                  <th key={d.id} colSpan={d.packingVesselKg == null ? sheet.vessels.length + 1 : 2} className="grp">
                    {d.name}
                  </th>
                ))}
              </tr>
              <tr>
                {sheet.indentDishes.map((d) => (
                  <th key={d.id}>{d.name}</th>
                ))}
                {sheet.dishOrder.map((d) => (
                  <SubHead key={d.id} d={d} vessels={sheet.vessels} />
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows.map((r, i) => (
                <tr key={r.unit}>
                  <td>{i + 1}</td>
                  <td style={{ fontWeight: 700 }}>{r.unit}</td>
                  {sheet.indentDishes.map((d) => (
                    <td key={d.id}>{r.plates[d.id] || ""}</td>
                  ))}
                  <td style={{ fontWeight: 700 }}>{r.totalPlates}</td>
                  {sheet.dishOrder.map((d) => {
                    const c = r.cells[d.name];
                    const extra = d.packingVesselKg == null
                      ? sheet.vessels.map((v) => c?.vessels?.[v] || "")
                      : [c?.vesselCount ?? ""];
                    return <Cells key={d.id} qty={c?.qty} extra={extra} />;
                  })}
                </tr>
              ))}
              <Totals sheet={sheet} />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Totals({ sheet }: { sheet: PackingSheet }) {
  const r1 = (n: number) => Number(n.toFixed(2));
  const indentTot = sheet.indentDishes.map((d) => sheet.rows.reduce((a, r) => a + (r.plates[d.id] || 0), 0));
  const grand = sheet.rows.reduce((a, r) => a + r.totalPlates, 0);
  return (
    <tr className="totalrow">
      <td></td>
      <td>Total</td>
      {indentTot.map((v, i) => <td key={i}>{v || ""}</td>)}
      <td>{grand}</td>
      {sheet.dishOrder.map((d) => {
        const qty = r1(sheet.rows.reduce((a, r) => a + (r.cells[d.name]?.qty || 0), 0));
        if (d.packingVesselKg == null) {
          const vt = sheet.vessels.map((v) => sheet.rows.reduce((a, r) => a + (r.cells[d.name]?.vessels?.[v] || 0), 0));
          return <Cells key={d.id} qty={qty} extra={vt.map((x) => x || "")} />;
        }
        const vc = r1(sheet.rows.reduce((a, r) => a + (r.cells[d.name]?.vesselCount || 0), 0));
        return <Cells key={d.id} qty={qty} extra={[vc || ""]} />;
      })}
    </tr>
  );
}

function SubHead({
  d,
  vessels,
}: {
  d: { packingVesselKg: number | null };
  vessels: number[];
}) {
  if (d.packingVesselKg == null) {
    return (
      <>
        <th>Qty</th>
        {vessels.map((v) => (
          <th key={v} className="vsz">
            {v}
          </th>
        ))}
      </>
    );
  }
  return (
    <>
      <th>kg</th>
      <th className="vsz">/{d.packingVesselKg}</th>
    </>
  );
}

function Cells({ qty, extra }: { qty?: number; extra: (number | string)[] }) {
  return (
    <>
      <td style={{ fontWeight: 700 }}>{qty ? Number(qty.toFixed(2)) : ""}</td>
      {extra.map((x, i) => (
        <td key={i}>{x}</td>
      ))}
    </>
  );
}
