import { useEffect, useState } from "react";
import { api, PackingSheet } from "./api";

export default function Packing({ date }: { date: string }) {
  const [session, setSession] = useState<"BREAKFAST" | "DINNER">("BREAKFAST");
  const [sheet, setSheet] = useState<PackingSheet | null>(null);
  const [gate, setGate] = useState<{ ready: boolean; booked: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setSheet(null);
    try {
      const res = await api.packing(date, session);
      setGate({ ready: res.ready, booked: res.booked, total: res.total });
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
          <button
            className={`btn sm ${session === "DINNER" ? "" : "ghost"}`}
            onClick={() => setSession("DINNER")}
          >
            Evening
          </button>
        </div>
        {gate?.ready ? (
          <a className="btn ghost sm" href={api.packingExcelUrl(date)} style={{ textDecoration: "none" }}>
            <i className="ti ti-download" aria-hidden="true"></i> Download Excel
          </a>
        ) : (
          <span className="muted">Download enabled when all kitchens are booked</span>
        )}
      </div>

      {loading && <p className="muted">Loading…</p>}
      {error && <p className="err">{error}</p>}

      {gate && !gate.ready && !loading && (
        <div className="card soft" style={{ marginTop: 12 }}>
          <div className="section-title">Waiting for all kitchens</div>
          <p className="muted" style={{ marginTop: 6 }}>
            {gate.booked} of {gate.total} kitchens booked for this session. The packing sheet
            generates automatically once all {gate.total} are in.
          </p>
        </div>
      )}

      {sheet && sheet.rows.length === 0 && <p className="muted">No orders for this session.</p>}
      {sheet && sheet.rows.length > 0 && (
        <div className="tablewrap" style={{ marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th rowSpan={2}>S.No</th>
                <th rowSpan={2}>Section</th>
                {sheet.indentDishes.length > 0 && (
                  <th colSpan={sheet.indentDishes.length} style={{ background: "#fdeede" }}>Indent (plates)</th>
                )}
                <th rowSpan={2}>Total</th>
                {sheet.dishOrder.map((d) => (
                  <th key={d.id} colSpan={d.packingVesselKg == null ? sheet.vessels.length + 1 : 2} style={{ background: "#f3e2d0" }}>
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
  const r1 = (n: number) => Number(n.toFixed(1));
  const indentTot = sheet.indentDishes.map((d) => sheet.rows.reduce((a, r) => a + (r.plates[d.id] || 0), 0));
  const grand = sheet.rows.reduce((a, r) => a + r.totalPlates, 0);
  return (
    <tr style={{ background: "#efe3d3", fontWeight: 700 }}>
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
          <th key={v} style={{ color: "#b91c1c" }}>
            {v}
          </th>
        ))}
      </>
    );
  }
  return (
    <>
      <th>kg</th>
      <th style={{ color: "#b91c1c" }}>/{d.packingVesselKg}</th>
    </>
  );
}

function Cells({ qty, extra }: { qty?: number; extra: (number | string)[] }) {
  return (
    <>
      <td style={{ fontWeight: 700 }}>{qty ? Number(qty.toFixed(1)) : ""}</td>
      {extra.map((x, i) => (
        <td key={i}>{x}</td>
      ))}
    </>
  );
}
