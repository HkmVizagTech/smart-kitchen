import { useEffect, useMemo, useState } from "react";
// The booking screen's dish shape is the lighter one the /booking-menu route
// returns (no packing config, but it knows about accompaniments). Aliased so
// the rest of this file, lifted verbatim from the old booking app, is unchanged.
import { api, AuthedUser, Booking, BookingMenu, BookingDish as Dish, BookingStatus, MealStatus, Progress } from "../api";

const today = () => new Date();
const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const pretty = (d: Date) => d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });

// An order's date is stored as UTC midnight and arrives as an ISO string. Read
// it back in UTC — formatting it in the browser's zone shows the previous day
// anywhere west of Greenwich.
const prettyStored = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    weekday: "long", day: "numeric", month: "short", timeZone: "UTC",
  });
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

const SES_LONG: Record<string, string> = {
  BREAKFAST: "Morning Tiffin", LUNCH: "Lunch", DINNER: "Dinner",
};

/** Shown at the top when any meal is waiting on a close-out. */
function GateBanner({ gate, onCloseOutNeeded }: {
  gate: BookingStatus | null; onCloseOutNeeded?: () => void;
}) {
  if (!gate) return null;
  const stuck = (Object.entries(gate) as [string, MealStatus][]).filter(([, v]) => !v.canOrder);
  if (stuck.length === 0) return null;
  return (
    <div className="card soft" style={{ borderLeft: "3px solid var(--primary)" }}>
      <div className="section-title">
        <i className="ti ti-lock" aria-hidden="true"></i>{" "}
        {stuck.length === 1 ? "One meal is waiting on a close-out" : "Some meals are waiting on a close-out"}
      </div>
      {stuck.map(([session, v]) => (
        <p className="muted" key={session} style={{ margin: "6px 0 0" }}>
          <b>{SES_LONG[session] ?? session}</b> — finish {v.blockedBy?.needs.join(" and ")} for{" "}
          {v.blockedBy?.unit} on {prettyStored(v.blockedBy!.date)} before booking it again.
        </p>
      ))}
      {onCloseOutNeeded ? (
        <button className="btn sm" style={{ marginTop: 12 }} onClick={onCloseOutNeeded}>
          Go to Close a Meal
        </button>
      ) : null}
    </div>
  );
}

/** Inline note on the meal that is blocked. */
function BlockedNote({ status }: { status?: MealStatus }) {
  if (!status || status.canOrder) return null;
  return (
    <p className="err" style={{ margin: "8px 0 0", fontSize: 13 }}>
      Locked until you close out {status.blockedBy?.unit} ({status.blockedBy?.needs.join(" + ")}).
    </p>
  );
}

// Route selector. Empty value = let the API assign the next free route, which
// is what happens if the booker never touches this. Routes already taken for
// the same date+session are shown but not selectable.
//
// The auto option NAMES the route it will actually pick. It used to read
// "Auto — next free route (0 open)", which is worse than useless: it told the
// booker nothing about where their food was going, and when nothing was free it
// still presented auto as an ordinary choice even though picking it guaranteed
// a failure at the end of the form.
function RoutePicker({ id, progress, value, onChange }: {
  id: string; progress?: Progress; value: string; onChange: (v: string) => void;
}) {
  const free = progress?.units.filter((u) => !u.booked) ?? [];
  const nextFree = free[0];
  const nothingFree = !!progress && free.length === 0;
  return (
    <div className="route-pick">
      <label className="lab" htmlFor={`route-${id}`}>Route</label>
      <select
        id={`route-${id}`}
        value={value}
        disabled={nothingFree}
        onChange={(e) => onChange(e.target.value)}
      >
        {!nothingFree && (
          <option value="">{nextFree ? `Auto — ${nextFree.name}` : "Auto — next free route"}</option>
        )}
        {progress?.units.map((u) => (
          <option key={u.id} value={u.id} disabled={u.booked}>
            {u.name}{u.booked ? " — already booked" : ""}
          </option>
        ))}
      </select>
      {nothingFree && (
        <p className="err" style={{ margin: "6px 0 0", fontSize: 13 }}>
          All {progress?.total} routes are already booked for this meal.
        </p>
      )}
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

// ---------------------------------------------------------------- the picker
//
// A booker orders three or four dishes out of sixteen. The screen used to
// render all sixteen as full rows with steppers, every time — 4,232px on a
// phone, five screens of scrolling to place one order, with the confirm button
// stranded at the bottom. Now a meal starts empty and the booker adds the
// dishes they want; only those get a row.

const allDishes = (m: BookingMenu) => [...m.ITEM1, ...m.ITEM2, ...m.ITEM3];

/** Dishes explicitly added to this meal, in menu order. A key exists in
 *  `counts` as soon as a dish is added, even while its count is still blank —
 *  that is what keeps a freshly added row on screen at zero. */
const chosen = (menu: BookingMenu, c: Counts) =>
  allDishes(menu).filter((d) => !d.accompaniment && c[d.id] !== undefined);

/** Every accompaniment, whatever group it sits in. Their counts are derived. */
const accompaniments = (menu: BookingMenu) => allDishes(menu).filter((d) => d.accompaniment);

/** Rebuild counts from a past order's line items, which carry dish NAMES
 *  (`/bookings/recent` returns names, not ids). Dish names are unique in the
 *  schema, so the mapping is safe. Accompaniments are skipped — they are
 *  re-derived from the solids rather than copied. */
function countsFromItems(menu: BookingMenu, items: { dish: string; plates: number }[]): Counts {
  const byName = new Map(allDishes(menu).map((d) => [d.name, d]));
  const out: Counts = {};
  for (const it of items) {
    const d = byName.get(it.dish);
    if (d && !d.accompaniment && it.plates > 0) out[d.id] = String(it.plates);
  }
  return out;
}

/** A comparable fingerprint of a basket, for telling two shortcuts apart. */
const sig = (c: Counts) =>
  Object.entries(c)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k}:${Number(v)}`)
    .sort()
    .join(",");

/** What this booker usually orders for a meal: the dishes present in at least
 *  half of their last few orders, at their average plate count. Offered next to
 *  "repeat last" because the most recent order is sometimes the odd one out —
 *  a festival day, a half-empty hostel — and repeating it would carry that
 *  exception forward. Needs at least two orders to mean anything. */
function usualCounts(menu: BookingMenu, past: Booking[]): Counts | null {
  const recent = past.slice(0, 5);
  if (recent.length < 2) return null;
  const seen = new Map<number, number[]>();
  for (const o of recent) {
    for (const [id, plates] of Object.entries(countsFromItems(menu, o.items))) {
      const key = Number(id);
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key)!.push(Number(plates));
    }
  }
  const out: Counts = {};
  for (const [id, plates] of seen) {
    if (plates.length * 2 < recent.length) continue; // in fewer than half — not usual
    out[id] = String(Math.round(plates.reduce((a, b) => a + b, 0) / plates.length));
  }
  return Object.keys(out).length ? out : null;
}

/** "Idly ×120 · Wada ×60" — what a shortcut will actually fill in. */
function describe(menu: BookingMenu, c: Counts, max = 3) {
  const byId = new Map(allDishes(menu).map((d) => [d.id, d]));
  const parts = Object.entries(c)
    .filter(([, v]) => Number(v) > 0)
    .map(([id, v]) => `${byId.get(Number(id))?.name ?? "?"} ×${v}`);
  return parts.length > max ? `${parts.slice(0, max).join(" · ")} +${parts.length - max} more` : parts.join(" · ");
}

// ---------------- NEW BOOKING (single page) ----------------
export function NewBooking({ user, onBooked, onCloseOutNeeded }: {
  user: AuthedUser; onBooked: () => void; onCloseOutNeeded?: () => void;
}) {
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
  // Which meals this booker may open right now (the reorder gate).
  const [gate, setGate] = useState<BookingStatus | null>(null);
  // This booker's own recent orders, for the one-tap refills.
  const [past, setPast] = useState<Booking[]>([]);
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

  function loadGate() {
    api.bookingStatus().then(setGate).catch(() => {});
  }
  // This booker's own past orders, newest first — the source for the
  // repeat/usual shortcuts. /bookings/recent covers every booker (the kitchen
  // and admin screens want that), so filter to this user's own, and drop
  // emergencies: they are one-offs nobody wants to repeat by accident.
  function loadPast() {
    api.recentBookings()
      .then((bs) => setPast(bs.filter((b) => b.mine && !b.isEmergency && b.items.length > 0)))
      .catch(() => {});
  }
  useEffect(() => {
    api.bookingMenu().then(setMenu).catch((e) => setErr(e.message));
    loadProgress();
    loadGate();
    loadPast();
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
    setResult(out); setBusy(false); loadProgress(); loadGate(); loadPast();
    if (out.every((o) => o.startsWith("✓"))) { setTC({}); setDC({}); setLPpl(""); setEPpl(""); }
  }

  // What the confirm bar reports, so nobody has to scroll back up to check what
  // they typed before committing to it.
  const pending: { label: string; qty: string }[] = [];
  if (tOn && tTotal > 0) pending.push({ label: "Tiffin", qty: `${tTotal} plates` });
  if (dOn && dTotal > 0) pending.push({ label: "Dinner", qty: `${dTotal} plates` });
  if (lOn && +lPpl > 0) pending.push({ label: "Lunch", qty: `${+lPpl} people` });
  if (eOn && +ePpl > 0) pending.push({ label: `Emergency ${SES[eSes]}`, qty: `${+ePpl} people` });

  // Only this booker's own past orders of a given meal, newest first.
  const pastFor = (session: string) => past.filter((b) => b.session === session);

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

      <GateBanner gate={gate} onCloseOutNeeded={onCloseOutNeeded} />

      <h2>Tomorrow's meals</h2>
      <div className="grid2">
        <MealCard title="Morning Tiffin" on={tOn} setOn={setTOn} menu={menu} counts={tC} setCounts={setTC} total={tTotal}
          id="tiffin" progress={tProg} unit={tUnit} setUnit={setTUnit} blocked={gate?.BREAKFAST}
          past={pastFor("BREAKFAST")} />
        <MealCard title="Dinner" on={dOn} setOn={setDOn} menu={menu} counts={dC} setCounts={setDC} total={dTotal}
          id="dinner" progress={dProg} unit={dUnit} setUnit={setDUnit} blocked={gate?.DINNER}
          past={pastFor("DINNER")} />
      </div>

      <h2>Today (count only)</h2>
      <div className="grid2">
        <div className={`meal ${lOn ? "on" : ""}`}>
          <div className="head"><span className="mtitle">Lunch</span><Switch on={lOn} setOn={setLOn} /></div>
          <p className="muted" style={{ margin: "6px 0 0" }}>Same-day · before 11:00 AM · no menu</p>
          <BlockedNote status={gate?.LUNCH} />
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

      {err && menu && <div className="err">{err}</div>}
      {result.length > 0 && (
        <div className="card soft" style={{ marginTop: 14 }}>
          {result.map((r, i) => <div key={i} className={r.startsWith("✓") ? "ok" : "err"} style={{ marginTop: i ? 6 : 0 }}>{r}</div>)}
          <button className="btn ghost" style={{ marginTop: 12 }} onClick={onBooked}>View all bookings</button>
        </div>
      )}

      {/* Pinned to the bottom of the viewport. The confirm button used to sit
          at the end of a 4,000px page, so the booker committed to an order
          they could no longer see. */}
      <div className="confirm-bar">
        <div className="cb-sum">
          {pending.length === 0 ? (
            <span className="muted">Nothing to book yet</span>
          ) : (
            pending.map((p) => (
              <span className="cb-item" key={p.label}>
                <span className="cb-label">{p.label}</span>
                <b>{p.qty}</b>
              </span>
            ))
          )}
        </div>
        <button className="btn" disabled={busy || pending.length === 0} onClick={confirm}>
          {busy ? "Booking…" : "Confirm"}
        </button>
      </div>
    </>
  );
}

const GROUP_META: { key: "ITEM1" | "ITEM2" | "ITEM3"; label: string; note: string; icon: string }[] = [
  { key: "ITEM1", label: "Item 1", note: "Tiffin mains", icon: "ti-bowl-spoon" },
  { key: "ITEM2", label: "Item 2", note: "Rice & gravies", icon: "ti-bowl" },
  { key: "ITEM3", label: "Item 3", note: "Tiffin sides", icon: "ti-cookie" },
];

function MealCard({ title, on, setOn, menu, counts, setCounts, total, id, progress, unit, setUnit, blocked, past }: {
  title: string; on: boolean; setOn: (b: boolean) => void; menu: BookingMenu | null;
  counts: Counts; setCounts: (c: Counts) => void; total: number;
  id: string; progress?: Progress; unit: string; setUnit: (v: string) => void;
  blocked?: MealStatus;
  /** This booker's own past orders of THIS meal, newest first — drives the shortcuts. */
  past: Booking[];
}) {
  // The dish whose row was just added, so its input can take focus.
  const [justAdded, setJustAdded] = useState<number | null>(null);

  const setOne = (dishId: number, v: string) =>
    setCounts({ ...counts, [dishId]: v.replace(/[^0-9]/g, "") });
  const step = (dishId: number, delta: number) => {
    const next = Math.max(0, (Number(counts[dishId]) || 0) + delta);
    setCounts({ ...counts, [dishId]: next === 0 ? "" : String(next) });
  };
  // Adding starts the dish at blank rather than 1: a mis-tap should not quietly
  // put a plate on the order.
  const add = (dishId: number) => { setCounts({ ...counts, [dishId]: "" }); setJustAdded(dishId); };
  const remove = (dishId: number) => {
    const next = { ...counts };
    delete next[dishId];
    setCounts(next);
  };

  const picked = menu ? chosen(menu, counts) : [];
  const derived = menu ? solidPlates(menu, counts) : 0;

  return (
    <div className={`meal ${on ? "on" : ""}`}>
      <div className="head">
        <span className="mtitle">
          {title}
          {on && total > 0 ? <span className="pill" style={{ marginLeft: 8 }}>{total} plates</span> : null}
        </span>
        <Switch on={on} setOn={setOn} />
      </div>
      <BlockedNote status={blocked} />
      {!on && <p className="muted" style={{ margin: "6px 0 0" }}>Turn on to choose dishes.</p>}

      {on && <RoutePicker id={id} progress={progress} value={unit} onChange={setUnit} />}
      {on && !menu && <p className="muted" style={{ marginTop: 8 }}>Loading dishes…</p>}

      {on && menu && (
        <>
          <QuickFill menu={menu} past={past} counts={counts} apply={setCounts} />

          {picked.length === 0 ? (
            <p className="muted pick-empty">Nothing added yet — pick dishes below.</p>
          ) : (
            <div className="picked">
              {picked.map((d) => {
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
                      <input
                        inputMode="numeric" placeholder="0"
                        autoFocus={d.id === justAdded}
                        value={counts[d.id] ?? ""}
                        onChange={(e) => setOne(d.id, e.target.value)}
                      />
                      <button type="button" aria-label={`Increase ${d.name}`} onClick={() => step(d.id, +1)}>+</button>
                    </div>
                    <button type="button" className="row-x" aria-label={`Remove ${d.name}`} onClick={() => remove(d.id)}>
                      <i className="ti ti-x" aria-hidden="true"></i>
                    </button>
                  </div>
                );
              })}
              {derived > 0 && (
                <div className="derived">
                  <span className="derived-lab">Added automatically</span>
                  {accompaniments(menu).map((a) => (
                    <span className="derived-chip" key={a.id}>{a.name} <b>{derived}</b></span>
                  ))}
                </div>
              )}
            </div>
          )}

          <DishPicker menu={menu} counts={counts} onAdd={add} onRemove={remove} />
        </>
      )}
    </div>
  );
}

/** One-tap refills, built from this booker's own history. Hidden when there is
 *  no history yet, and a shortcut disappears once the basket already matches it
 *  so it never offers to do nothing. */
function QuickFill({ menu, past, counts, apply }: {
  menu: BookingMenu; past: Booking[]; counts: Counts; apply: (c: Counts) => void;
}) {
  const last = past[0] ? countsFromItems(menu, past[0].items) : null;
  const usual = usualCounts(menu, past);
  const now = sig(counts);

  const options: { key: string; label: string; icon: string; counts: Counts }[] = [];
  if (last && Object.keys(last).length) options.push({ key: "last", label: "Repeat last", icon: "ti-rotate", counts: last });
  if (usual && sig(usual) !== sig(last ?? {})) options.push({ key: "usual", label: "My usual", icon: "ti-star", counts: usual });

  const show = options.filter((o) => sig(o.counts) !== now);
  if (show.length === 0) return null;

  return (
    <div className="quickfill">
      {show.map((o) => (
        <button type="button" className="qf" key={o.key} onClick={() => apply({ ...o.counts })}>
          <i className={`ti ${o.icon}`} aria-hidden="true"></i>
          <span className="qf-text">
            <span className="qf-title">{o.label}</span>
            <span className="qf-sub">{describe(menu, o.counts)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Search + chips. Sixteen dishes fit in four rows here instead of sixteen
 *  full-height rows with steppers nobody is going to touch. */
function DishPicker({ menu, counts, onAdd, onRemove }: {
  menu: BookingMenu; counts: Counts; onAdd: (id: number) => void; onRemove: (id: number) => void;
}) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = GROUP_META
    .map((g) => ({
      ...g,
      dishes: menu[g.key].filter(
        (d) => !d.accompaniment && (!needle || d.name.toLowerCase().includes(needle))
      ),
    }))
    .filter((g) => g.dishes.length > 0);

  return (
    <div className="dish-picker">
      <div className="dp-search">
        <i className="ti ti-search" aria-hidden="true"></i>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search dishes…"
          aria-label="Search dishes"
        />
        {q && (
          <button type="button" className="dp-clear" aria-label="Clear search" onClick={() => setQ("")}>
            <i className="ti ti-x" aria-hidden="true"></i>
          </button>
        )}
      </div>

      {groups.length === 0 && <p className="muted" style={{ margin: "10px 0 0" }}>No dish matches “{q}”.</p>}

      {groups.map((g) => (
        <div className="dp-group" key={g.key}>
          <div className="dp-label">
            <i className={`ti ${g.icon}`} aria-hidden="true"></i> {g.label} · {g.note}
          </div>
          <div className="dp-chips">
            {g.dishes.map((d) => {
              const on = counts[d.id] !== undefined;
              return (
                <button
                  type="button" key={d.id}
                  className={`dp-chip ${on ? "on" : ""}`}
                  aria-pressed={on}
                  onClick={() => (on ? onRemove(d.id) : onAdd(d.id))}
                >
                  <i className={`ti ${on ? "ti-check" : "ti-plus"}`} aria-hidden="true"></i>
                  {d.name}
                </button>
              );
            })}
          </div>
        </div>
      ))}
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
  const [all, setAll] = useState<Booking[] | null>(null);
  const [err, setErr] = useState("");
  // The route returns every booker's orders. This screen is called "My
  // Bookings", so it defaults to the caller's own — but the whole list stays
  // one tap away, because seeing what the other routes ordered is useful.
  const [scope, setScope] = useState<"mine" | "all">("mine");
  useEffect(() => { api.recentBookings().then(setAll).catch((e) => setErr(e.message)); }, []);
  if (err) return <p className="err">{err}</p>;
  if (!all) return <p className="muted">Loading…</p>;
  const list = scope === "mine" ? all.filter((b) => b.mine) : all;
  const mineCount = all.filter((b) => b.mine).length;
  const need = list.filter((b) => b.needsCloseOut && b.status !== "CLOSED");
  const itemSummary = (b: Booking) =>
    b.items.length ? b.items.map((it) => `${it.dish}×${it.plates}`).join(", ") : `${b.peopleCount ?? 0} people`;
  return (
    <>
      <h1>Bookings</h1>
      <div className="segmented" role="tablist" aria-label="Whose bookings" style={{ marginBottom: 14 }}>
        <button role="tab" aria-selected={scope === "mine"} className={scope === "mine" ? "on" : ""}
          onClick={() => setScope("mine")}>Mine ({mineCount})</button>
        <button role="tab" aria-selected={scope === "all"} className={scope === "all" ? "on" : ""}
          onClick={() => setScope("all")}>All routes ({all.length})</button>
      </div>
      {need.length > 0 && (
        <>
          <h2>Needs your attention</h2>
          {need.map((b) => {
            const returned = b.consumptionStatus === "REJECTED";
            return (
              <div className={`card ${returned ? "returned" : "soft"}`} key={b.id}>
                <div className="between">
                  <div>
                    <b>{b.unit}</b> · {SES[b.session]} · {new Date(b.date).toDateString()}
                    {returned && (
                      <div className="returned-why">
                        <i className="ti ti-arrow-back-up" aria-hidden="true"></i>
                        <span><b>Sent back:</b> {b.rejectionReason || "no reason given"}</span>
                      </div>
                    )}
                  </div>
                  <button className="btn" onClick={() => onCloseOut(b)}>
                    {returned ? "Fix & resend" : "Close out"}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
      <h2>All bookings</h2>
      {list.length === 0 && (
        <div className="card">
          <p className="muted">{scope === "mine" ? "You haven't booked anything yet." : "No bookings yet."}</p>
        </div>
      )}
      {list.map((b) => (
        <div className="card" key={b.id}>
          <div className="between">
            <b>{b.unit} · {SES[b.session]}{b.isEmergency ? " · emergency" : ""}</b>
            <span className={`badge b-${b.status}`}>{b.status}</span>
          </div>
          <div className="muted" style={{ marginTop: 4 }}>{new Date(b.date).toDateString()} · {b.totalPlates ?? b.peopleCount ?? 0} plates</div>
          <div style={{ marginTop: 6, fontSize: 14 }}>{itemSummary(b)}</div>
          {b.consumptionStatus === "REJECTED" ? (
            <div className="returned-why" style={{ marginTop: 8 }}>
              <i className="ti ti-arrow-back-up" aria-hidden="true"></i>
              <span><b>Sent back:</b> {b.rejectionReason || "no reason given"}</span>
            </div>
          ) : b.consumptionStatus === "VERIFIED" ? (
            <div className="muted" style={{ marginTop: 4 }}>
              Verified{b.amount != null ? ` · ₹${b.amount.toLocaleString("en-IN")}` : ""}
            </div>
          ) : b.consumptionStatus ? (
            <div className="muted" style={{ marginTop: 4 }}>Awaiting verification</div>
          ) : null}
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
  // Set when this close-out was returned by verification, with their reason.
  const [sentBack, setSentBack] = useState<string | null>(null);

  function refreshList() {
    api.recentBookings().then((bs) => setList(bs.filter((b) => b.needsCloseOut && b.status !== "CLOSED")));
  }
  useEffect(() => { refreshList(); }, []);

  // Load the main items whenever a booking is chosen, restoring whatever was
  // submitted last time so a correction starts from the previous numbers
  // rather than from blank.
  useEffect(() => {
    if (!booking) { setLines([]); setSentBack(null); return; }
    setLoadingItems(true);
    api.closeoutItems(booking.id)
      .then((r) => {
        setLines(r.items.map((it) => ({ ...it, consumed: it.consumed == null ? "" : String(it.consumed) })));
        if (r.previous) {
          setNotes(r.previous.notes ?? "");
          setTaste(r.previous.taste ?? 0);
          setQuality(r.previous.quality ?? 0);
          setRemarks(r.previous.remarks ?? "");
          setSentBack(r.previous.status === "REJECTED" ? (r.previous.rejectionReason || "no reason given") : null);
        }
      })
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
      setOk("Submitted — this meal is closed out, so you can book it again now. It also goes to verification for approval.");
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
                <div>
                  <b>{b.unit}</b> · {SES[b.session]} · <span className="muted">{new Date(b.date).toDateString()}</span>
                  {b.consumptionStatus === "REJECTED" && (
                    <div className="returned-why">
                      <i className="ti ti-arrow-back-up" aria-hidden="true"></i>
                      <span><b>Sent back:</b> {b.rejectionReason || "no reason given"}</span>
                    </div>
                  )}
                </div>
                <button className="btn sm" onClick={() => setBooking(b)}>
                  {b.consumptionStatus === "REJECTED" ? "Fix" : "Select"}
                </button>
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

          {sentBack && (
            <div className="returned-banner">
              <i className="ti ti-arrow-back-up" aria-hidden="true"></i>
              <div>
                <b>Verification sent this back</b>
                <p>{sentBack}</p>
                <p className="muted">Your previous figures are filled in below — change what needs changing and send it again.</p>
              </div>
            </div>
          )}

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
          <button
            key={n}
            type="button"
            className={`star ${n <= v ? "on" : ""}`}
            aria-label={`${n} of 5`}
            aria-pressed={n <= v}
            onClick={() => set(n)}
          >
            ★
          </button>
        ))}
      </div>
    </div>
  );
}
