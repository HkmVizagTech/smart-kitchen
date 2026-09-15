import { useEffect, useMemo, useState } from "react";
// The booking screen's dish shape is the lighter one the /booking-menu route
// returns (no packing config, but it knows about accompaniments). Aliased so
// the rest of this file, lifted verbatim from the old booking app, is unchanged.
import { api, AuthedUser, Booking, BookingMenu, BookingDish as Dish, Progress } from "../api";

const today = () => new Date();
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pretty = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
const SES: Record<string, string> = { BREAKFAST: "Morning Tiffin", LUNCH: "Lunch", DINNER: "Dinner" };
const unitLabel = (d: Dish) => (d.unit === "NOS" ? `${d.qtyPerPlate} nos/plate` : `${d.qtyPerPlate} g/plate`);

function Banner() {
  return (
    <div className="banner" id="hero">
      <img src="/hero.jpg" alt="" style={{ display: "none" }}
        onLoad={(e) => { const b = document.getElementById("hero"); if (b) { b.classList.add("hasimg"); (e.currentTarget as HTMLImageElement).style.display = "block"; b.querySelector(".cap")?.remove(); } }} />
      <div className="cap">
        <h1>Book today, served tomorrow</h1>
        <p>Choose the dishes you need and enter plate counts — tiffin and dinner, together or separately.</p>
      </div>
    </div>
  );
}

const pkey = (date: string, session: string) => `${date}|${session}`;

// Route selector. Empty value = let the API assign the next free route, which
// is what happens if the booker never touches this. Routes already taken for
// the same date+session are shown but not selectable.
function RoutePicker({ id, progress, value, onChange }: {
  id: string; progress?: Progress; value: string; onChange: (v: string) => void;
}) {
  const free = progress?.units.filter((u) => !u.booked).length ?? 0;
  return (
    <div style={{ marginTop: 10 }}>
      <label className="lab" htmlFor={`route-${id}`}>Route</label>
      <select id={`route-${id}`} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Auto — next free route{progress ? ` (${free} open)` : ""}</option>
        {progress?.units.map((u) => (
          <option key={u.id} value={u.id} disabled={u.booked}>
            {u.name}{u.booked ? " — already booked" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// counts: dishId -> plates (string)
type Counts = Record<number, string>;
// sum over non-accompaniment dishes only (accompaniments are auto-derived)
const sum = (menu: Dish[], c: Counts) =>
  menu.reduce((a, d) => a + (d.accompaniment ? 0 : Number(c[d.id]) || 0), 0);
const itemsFrom = (c: Counts) =>
  Object.entries(c).map(([id, p]) => ({ dishId: Number(id), plates: Number(p) || 0 })).filter((x) => x.plates > 0);
// accompaniment plates = sum of Item 1 + Item 3 solid dishes (idly + wada + punugulu + …)
const solidPlates = (menu: BookingMenu, c: Counts) => sum(menu.ITEM1, c) + sum(menu.ITEM3, c);

// ---------------- NEW BOOKING (single page) ----------------
export function NewBooking({ user, onBooked }: { user: AuthedUser; onBooked: () => void }) {
  const [menu, setMenu] = useState<BookingMenu | null>(null);
  const [err, setErr] = useState("");

  const [tOn, setTOn] = useState(true);
  const [tC, setTC] = useState<Counts>({});
  const [dOn, setDOn] = useState(false);
  const [dC, setDC] = useState<Counts>({});
  const [lOn, setLOn] = useState(false);
  const [lPpl, setLPpl] = useState("");
  const [eOn, setEOn] = useState(false);
  const [eSes, setESes] = useState<"BREAKFAST" | "LUNCH" | "DINNER">("LUNCH");
  const [ePpl, setEPpl] = useState("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string[]>([]);

  // Which routes are already taken, per date+session. Drives the route pickers.
  const [prog, setProg] = useState<Record<string, Progress>>({});
  // Route chosen per meal. "" means auto-assign the next free one.
  const [tUnit, setTUnit] = useState("");
  const [dUnit, setDUnit] = useState("");
  const [lUnit, setLUnit] = useState("");
  const [eUnit, setEUnit] = useState("");

  const slots = (): [string, string][] => [
    [ymd(tomorrow()), "BREAKFAST"],
    [ymd(tomorrow()), "DINNER"],
    [ymd(today()), "LUNCH"],
    [ymd(today()), eSes],
  ];

  async function loadProgress() {
    const seen = new Set<string>();
    const wanted = slots().filter(([d, ses]) => {
      const k = pkey(d, ses);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    const results = await Promise.all(
      wanted.map(([d, ses]) => api.progress(d, ses).then((r) => [pkey(d, ses), r] as const).catch(() => null))
    );
    const next: Record<string, Progress> = {};
    for (const r of results) if (r) next[r[0]] = r[1];
    setProg((prev) => ({ ...prev, ...next }));
  }

  useEffect(() => {
    api.bookingMenu().then(setMenu).catch((e) => setErr(e.message));
    loadProgress();
  }, []);
  // The emergency meal selector changes which slot we need coverage for.
  useEffect(() => { loadProgress(); }, [eSes]);

  const tProg = prog[pkey(ymd(tomorrow()), "BREAKFAST")];
  const dProg = prog[pkey(ymd(tomorrow()), "DINNER")];
  const lProg = prog[pkey(ymd(today()), "LUNCH")];
  const eProg = prog[pkey(ymd(today()), eSes)];
  const count = (p?: Progress) => (p ? `${p.booked}/${p.total} routes booked` : "…");

  const tTotal = useMemo(() => menu ? sum(menu.ITEM1, tC) + sum(menu.ITEM2, tC) + sum(menu.ITEM3, tC) : 0, [menu, tC]);
  const dTotal = useMemo(() => menu ? sum(menu.ITEM1, dC) + sum(menu.ITEM2, dC) + sum(menu.ITEM3, dC) : 0, [menu, dC]);

  async function confirm() {
    setBusy(true); setErr(""); setResult([]);
    const by = user.id;
    const jobs: { label: string; body: Record<string, unknown> }[] = [];
    // unitId is omitted when the picker is left on "Auto", which makes the API
    // assign the next free route — the old behaviour.
    const pick = (v: string) => (v ? { unitId: Number(v) } : {});
    if (tOn && itemsFrom(tC).length) jobs.push({ label: "Morning Tiffin", body: { bookedById: by, date: ymd(tomorrow()), session: "BREAKFAST", items: itemsFrom(tC), ...pick(tUnit) } });
    if (dOn && itemsFrom(dC).length) jobs.push({ label: "Dinner", body: { bookedById: by, date: ymd(tomorrow()), session: "DINNER", items: itemsFrom(dC), ...pick(dUnit) } });
    if (lOn && +lPpl > 0) jobs.push({ label: "Lunch", body: { bookedById: by, date: ymd(today()), session: "LUNCH", peopleCount: +lPpl, ...pick(lUnit) } });
    if (eOn && +ePpl > 0) jobs.push({ label: "Emergency " + SES[eSes], body: { bookedById: by, date: ymd(today()), session: eSes, isEmergency: true, peopleCount: +ePpl, ...pick(eUnit) } });
    if (jobs.length === 0) { setErr("Turn on a meal and enter at least one plate count."); setBusy(false); return; }
    const out: string[] = [];
    for (const j of jobs) {
      try { const r = await api.placeOrder(j.body); out.push(`✓ ${j.label} → ${r.assignedUnit} (${r.booked}/${r.total} kitchens booked)`); }
      catch (e: any) { out.push(`✗ ${j.label}: ${e.message}`); }
    }
    setResult(out); setBusy(false); loadProgress();
    if (out.every((o) => o.startsWith("✓"))) { setTC({}); setDC({}); setLPpl(""); setEPpl(""); }
  }

  return (
    <>
      <Banner />
      <h1>New Booking</h1>
      <p className="muted">Tiffin &amp; dinner are for tomorrow — {pretty(tomorrow())}. Lunch &amp; emergency are for today.</p>
      <p className="muted" style={{ marginTop: 4 }}>
        Each meal goes to the next free route unless you pick one yourself.
        Tomorrow: tiffin <b>{count(tProg)}</b>, dinner <b>{count(dProg)}</b>.
      </p>
      {err && !menu && <p className="err">{err}</p>}

      <h2>Tomorrow's meals</h2>
      <div className="grid2">
        <MealCard title="Morning Tiffin" on={tOn} setOn={setTOn} menu={menu} counts={tC} setCounts={setTC} total={tTotal}
          id="tiffin" progress={tProg} unit={tUnit} setUnit={setTUnit} />
        <MealCard title="Dinner" on={dOn} setOn={setDOn} menu={menu} counts={dC} setCounts={setDC} total={dTotal}
          id="dinner" progress={dProg} unit={dUnit} setUnit={setDUnit} />
      </div>

      <h2>Today (count only)</h2>
      <div className="grid2">
        <div className={`meal ${lOn ? "on" : ""}`}>
          <div className="head"><span className="mtitle">Lunch</span><Switch on={lOn} setOn={setLOn} /></div>
          <p className="muted" style={{ margin: "6px 0 0" }}>Same-day · before 11:00 AM · no menu</p>
          {lOn && <><RoutePicker id="lunch" progress={lProg} value={lUnit} onChange={setLUnit} /><Ppl value={lPpl} set={setLPpl} /></>}
        </div>
        <div className={`meal ${eOn ? "on" : ""}`}>
          <div className="head"><span className="mtitle">Emergency</span><Switch on={eOn} setOn={setEOn} /></div>
          <p className="muted" style={{ margin: "6px 0 0" }}>Count only · needs admin approval</p>
          {eOn && (
            <>
              <label className="lab" style={{ marginTop: 10 }}>For which meal</label>
              <select value={eSes} onChange={(e) => setESes(e.target.value as any)}>
                <option value="BREAKFAST">Morning Tiffin</option>
                <option value="LUNCH">Lunch</option>
                <option value="DINNER">Dinner</option>
              </select>
              <RoutePicker id="emergency" progress={eProg} value={eUnit} onChange={setEUnit} />
              <Ppl value={ePpl} set={setEPpl} />
            </>
          )}
        </div>
      </div>

      <button className="btn block" style={{ marginTop: 8 }} disabled={busy} onClick={confirm}>
        {busy ? "Booking…" : "Confirm bookings"}
      </button>
      {err && menu && <div className="err">{err}</div>}
      {result.length > 0 && (
        <div className="card soft" style={{ marginTop: 14 }}>
          {result.map((r, i) => <div key={i} className={r.startsWith("✓") ? "ok" : "err"} style={{ marginTop: i ? 6 : 0 }}>{r}</div>)}
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={onBooked}>View all bookings</button>
        </div>
      )}
    </>
  );
}

const GROUP_META: { key: "ITEM1" | "ITEM2" | "ITEM3"; label: string; note: string; icon: string }[] = [
  { key: "ITEM1", label: "Item 1", note: "Tiffin mains", icon: "ti-bowl-spoon" },
  { key: "ITEM2", label: "Item 2", note: "Rice & gravies — pick any", icon: "ti-bowl" },
  { key: "ITEM3", label: "Item 3", note: "Tiffin sides", icon: "ti-cookie" },
];

function MealCard({ title, on, setOn, menu, counts, setCounts, total, id, progress, unit, setUnit }: {
  title: string; on: boolean; setOn: (b: boolean) => void; menu: BookingMenu | null;
  counts: Counts; setCounts: (c: Counts) => void; total: number;
  id: string; progress?: Progress; unit: string; setUnit: (v: string) => void;
}) {
  const setOne = (id: number, v: string) => setCounts({ ...counts, [id]: v.replace(/[^0-9]/g, "") });
  const step = (id: number, delta: number) => {
    const next = Math.max(0, (Number(counts[id]) || 0) + delta);
    setCounts({ ...counts, [id]: next === 0 ? "" : String(next) });
  };
  return (
    <div className={`meal ${on ? "on" : ""}`}>
      <div className="head">
        <span className="mtitle">{title}{on && total > 0 ? <span className="pill" style={{ marginLeft: 8 }}>{total} plates</span> : null}</span>
        <Switch on={on} setOn={setOn} />
      </div>
      {!on && <p className="muted" style={{ margin: "6px 0 0" }}>Turn on to choose dishes and counts.</p>}
      {on && <RoutePicker id={id} progress={progress} value={unit} onChange={setUnit} />}
      {on && !menu && <p className="muted" style={{ marginTop: 8 }}>Loading dishes…</p>}
      {on && menu && GROUP_META.map((g) => (
        <Group key={g.key} meta={g} dishes={menu[g.key]} counts={counts}
          setOne={setOne} step={step} sideTotal={solidPlates(menu, counts)} />
      ))}
    </div>
  );
}

function Group({ meta, dishes, counts, setOne, step, sideTotal }: {
  meta: { label: string; note: string; icon: string };
  dishes: Dish[]; counts: Counts; setOne: (id: number, v: string) => void;
  step: (id: number, delta: number) => void; sideTotal: number;
}) {
  const sub = sum(dishes, counts);
  if (dishes.length === 0) return null;
  return (
    <div className="book-group">
      <div className="bg-head">
        <span className="bg-badge"><i className={`ti ${meta.icon}`} aria-hidden="true"></i> {meta.label} · {meta.note}</span>
        {sub > 0 && <span className="bg-sub">{sub} plates</span>}
      </div>
      {dishes.map((d) => {
        if (d.accompaniment) {
          return (
            <div className="book-row" key={d.id} style={{ opacity: 0.9 }}>
              <span className="book-ic"><i className="ti ti-bowl" aria-hidden="true"></i></span>
              <div className="info">
                <div className="book-name">{d.name} <span className="pill gray" style={{ fontSize: 10 }}>auto</span></div>
                <div className="book-sub">from Idly + Wada + Punugulu…</div>
              </div>
              <div className="book-auto"><span className="val">{sideTotal}</span></div>
            </div>
          );
        }
        const val = Number(counts[d.id]) || 0;
        return (
          <div className="book-row" key={d.id}>
            <span className="book-ic"><i className="ti ti-soup" aria-hidden="true"></i></span>
            <div className="info">
              <div className="book-name">{d.name}</div>
              <div className="book-sub">{unitLabel(d)}</div>
            </div>
            <div className={`stepper ${val > 0 ? "filled" : ""}`}>
              <button type="button" aria-label={`Decrease ${d.name}`} disabled={val === 0} onClick={() => step(d.id, -1)}>−</button>
              <input inputMode="numeric" placeholder="0" value={counts[d.id] ?? ""} onChange={(e) => setOne(d.id, e.target.value)} />
              <button type="button" aria-label={`Increase ${d.name}`} onClick={() => step(d.id, +1)}>+</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Switch({ on, setOn }: { on: boolean; setOn: (b: boolean) => void }) {
  return (<label className="switch"><input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} /><span className="sl" /></label>);
}
function Ppl({ value, set }: { value: string; set: (s: string) => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <label className="lab">Number of people</label>
      <input value={value} onChange={(e) => set(e.target.value.replace(/[^0-9]/g, ""))} inputMode="numeric" placeholder="0" />
    </div>
  );
}

// ---------------- MY BOOKINGS ----------------
export function MyBookings({ onCloseOut }: { user: AuthedUser; onCloseOut: (b: Booking) => void }) {
  const [list, setList] = useState<Booking[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.recentBookings().then(setList).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="err">{err}</p>;
  if (!list) return <p className="muted">Loading…</p>;
  const need = list.filter((b) => b.needsCloseOut && b.status !== "CLOSED");
  const itemSummary = (b: Booking) =>
    b.items.length ? b.items.map((it) => `${it.dish}×${it.plates}`).join(", ") : `${b.peopleCount ?? 0} people`;
  return (
    <>
      <h1>Bookings</h1>
      {need.length > 0 && (
        <>
          <h2>Needs close-out</h2>
          {need.map((b) => (
            <div className="card soft" key={b.id}>
              <div className="between">
                <div><b>{b.unit}</b> · {SES[b.session]} · {new Date(b.date).toDateString()}</div>
                <button className="btn" onClick={() => onCloseOut(b)}>Close out</button>
              </div>
            </div>
          ))}
        </>
      )}
      <h2>All bookings</h2>
      {list.length === 0 && <div className="card"><p className="muted">No bookings yet.</p></div>}
      {list.map((b) => (
        <div className="card" key={b.id}>
          <div className="between">
            <b>{b.unit} · {SES[b.session]}{b.isEmergency ? " · emergency" : ""}</b>
            <span className={`badge b-${b.status}`}>{b.status}</span>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>{new Date(b.date).toDateString()} · {b.totalPlates ?? b.peopleCount ?? 0} plates</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>{itemSummary(b)}</div>
          {b.consumptionStatus && <div className="muted" style={{ marginTop: 4 }}>Verification: {b.consumptionStatus}</div>}
        </div>
      ))}
    </>
  );
}

// ---------------- CLOSE OUT (per main item) ----------------
type Line = { dishId: number; name: string; ordered: number; consumed: string };

export function CloseOut({ preset, onDone }: { user: AuthedUser; preset: Booking | null; onDone: () => void }) {
  const [booking, setBooking] = useState<Booking | null>(preset);
  const [list, setList] = useState<Booking[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [taste, setTaste] = useState(0);
  const [quality, setQuality] = useState(0);
  const [remarks, setRemarks] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  function refreshList() {
    api.recentBookings().then((bs) => setList(bs.filter((b) => b.needsCloseOut && b.status !== "CLOSED")));
  }
  useEffect(() => { refreshList(); }, []);

  // load main items whenever a booking is chosen
  useEffect(() => {
    if (!booking) { setLines([]); return; }
    setLoadingItems(true);
    api.closeoutItems(booking.id)
      .then((r) => setLines(r.items.map((it) => ({ ...it, consumed: "" }))))
      .catch((e) => setErr(e.message))
      .finally(() => setLoadingItems(false));
  }, [booking?.id]);

  const orderedTotal = lines.reduce((a, l) => a + l.ordered, 0);
  const consumedTotal = lines.reduce((a, l) => a + (Number(l.consumed) || 0), 0);

  function setConsumed(dishId: number, v: string) {
    setLines((ls) => ls.map((l) => (l.dishId === dishId ? { ...l, consumed: v.replace(/[^0-9]/g, "") } : l)));
  }
  function stepConsumed(dishId: number, delta: number) {
    setLines((ls) => ls.map((l) => {
      if (l.dishId !== dishId) return l;
      const next = Math.max(0, (Number(l.consumed) || 0) + delta);
      return { ...l, consumed: next === 0 ? "" : String(next) };
    }));
  }

  async function submit() {
    if (!booking) return;
    if (!taste || !quality) { setErr("Feedback required: rate taste and quality."); return; }
    setBusy(true); setErr(""); setOk("");
    try {
      await api.submitConsumption({
        orderId: booking.id,
        items: lines.map((l) => ({ dishId: l.dishId, consumed: Number(l.consumed) || 0 })),
        notes, taste, quality, remarks,
      });
      setOk("Submitted! Sent to verification. Your next booking unlocks once approved.");
      setTimeout(onDone, 1300);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Close out a meal</h1>

      {!booking && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pick a meal to close out</h2>
          {list.length === 0 ? <p className="muted">Nothing to close out right now.</p> :
            list.map((b) => (
              <div className="between" key={b.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                <div><b>{b.unit}</b> · {SES[b.session]} · <span className="muted">{new Date(b.date).toDateString()}</span></div>
                <button className="btn sm" onClick={() => setBooking(b)}>Select</button>
              </div>
            ))}
        </div>
      )}

      {booking && (
        <>
          <div className="card soft">
            <div className="between">
              <div><b>{booking.unit}</b> · {SES[booking.session]} · {new Date(booking.date).toDateString()}</div>
              <button className="btn ghost sm" onClick={() => { setBooking(null); refreshList(); }}>Change order</button>
            </div>
          </div>

          <div className="card">
            <div className="section-title">1 · Consumption (main items)</div>
            <p className="muted" style={{ margin: "4px 0 8px" }}>Enter plates consumed — leftover is worked out for you.</p>
            {loadingItems && <p className="muted">Loading items…</p>}
            {lines.map((l) => {
              const c = Number(l.consumed) || 0;
              const left = Math.max(0, l.ordered - c);
              const extra = c > l.ordered ? c - l.ordered : 0;
              return (
                <div className="book-row" key={l.dishId}>
                  <span className="book-ic"><i className="ti ti-bowl" aria-hidden="true"></i></span>
                  <div className="info">
                    <div className="book-name">{l.name}</div>
                    <div className="book-sub">
                      Ordered {l.ordered} · Leftover {left}{extra ? ` · +${extra} extra` : ""}
                    </div>
                  </div>
                  <div className={`stepper ${c > 0 ? "filled" : ""}`}>
                    <button type="button" aria-label={`Decrease ${l.name}`} disabled={c === 0} onClick={() => stepConsumed(l.dishId, -1)}>−</button>
                    <input inputMode="numeric" placeholder="0" value={l.consumed} onChange={(e) => setConsumed(l.dishId, e.target.value)} />
                    <button type="button" aria-label={`Increase ${l.name}`} onClick={() => stepConsumed(l.dishId, +1)}>+</button>
                  </div>
                </div>
              );
            })}
            <div className="between" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontWeight: 800 }}>
              <span>Total</span>
              <span>{consumedTotal} / {orderedTotal} plates{orderedTotal - consumedTotal > 0 ? ` · ${orderedTotal - consumedTotal} leftover` : ""}</span>
            </div>
            <label className="lab" style={{ marginTop: 14 }}>Notes (optional)</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="anything for the kitchen" />
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>2 · Feedback (required)</h2>
            <Stars label="Taste" v={taste} set={setTaste} />
            <Stars label="Quality" v={quality} set={setQuality} />
            <label className="lab" style={{ marginTop: 10 }}>Remarks (optional)</label>
            <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="taste / quality comments" />
          </div>

          <button className="btn block" disabled={busy} onClick={submit}>{busy ? "Submitting…" : "Submit & send to verification"}</button>
        </>
      )}
      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}
    </>
  );
}
function Stars({ label, v, set }: { label: string; v: number; set: (n: number) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <label className="lab">{label}</label>
      <div className="row" style={{ gap: 6 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} className="btn ghost" style={{ padding: "8px 12px", color: n <= v ? "#e0701a" : "#bbb", borderColor: n <= v ? "#e0701a" : undefined }} onClick={() => set(n)}>★</button>
        ))}
      </div>
    </div>
  );
}
