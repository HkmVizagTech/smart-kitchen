import { useEffect, useMemo, useState } from "react";
import {
  api, AuthedUser, Booking, BookingStatus, DayMenu, MealStatus, MenuDish, MenuSlot,
  Progress, SlotCounts,
} from "../api";

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

function Banner() {
  return (
    <div className="banner" id="hero">
      <img src="/hero.jpg" alt="" style={{ display: "none" }}
        onLoad={(e) => { const b = document.getElementById("hero"); if (b) { b.classList.add("hasimg"); (e.currentTarget as HTMLImageElement).style.display = "block"; b.querySelector(".cap")?.remove(); } }} />
      <div className="cap">
        <h1>Book today, served tomorrow</h1>
        <p>The kitchen sets the menu. You just enter how many plates of each item your route needs.</p>
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
          <b>{SES_LONG[session] ?? session}</b> — next step for {v.blockedBy?.unit} on{" "}
          {prettyStored(v.blockedBy!.date)}: {v.blockedBy?.needs.join(" and ")}.
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
      Locked — {status.blockedBy?.unit} still needs you to {status.blockedBy?.needs.join(" and ")}.
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

// The booker enters three plate counts; the day's menu says what they are.
// Everything that used to live here — a dish-id map, the accompaniment
// derivation, the "describe this basket" helper — belonged to the old model
// where a booker picked from sixteen dishes. The menu does that job now.

// ---------------- NEW BOOKING (single page) ----------------
export function NewBooking({ user, onBooked, onCloseOutNeeded }: {
  user: AuthedUser; onBooked: () => void; onCloseOutNeeded?: () => void;
}) {
  const [err, setErr] = useState("");
  // The day's menu per meal — what Item 1/2/3 actually are.
  const [menus, setMenus] = useState<Record<string, DayMenu>>({});

  const [tOn, setTOn] = useState(true);
  const [tC, setTC] = useState<SlotCounts>({});
  const [dOn, setDOn] = useState(false);
  const [dC, setDC] = useState<SlotCounts>({});
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
  // The menu for each meal we might book. Tiffin and dinner are for tomorrow;
  // lunch and emergency are for today.
  function loadMenus() {
    const wanted: [string, string][] = [
      [ymd(tomorrow()), "BREAKFAST"],
      [ymd(tomorrow()), "DINNER"],
      [ymd(today()), "LUNCH"],
    ];
    Promise.all(
      wanted.map(([d, ses]) => api.menu(d, ses).then((m) => [pkey(d, ses), m] as const).catch(() => null))
    ).then((rs) => {
      const next: Record<string, DayMenu> = {};
      for (const r of rs) if (r) next[r[0]] = r[1];
      setMenus((prev) => ({ ...prev, ...next }));
    });
  }
  useEffect(() => {
    loadMenus();
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

  const totalOf = (c: SlotCounts) => (c.ITEM1 ?? 0) + (c.ITEM2 ?? 0) + (c.ITEM3 ?? 0);
  const tTotal = useMemo(() => totalOf(tC), [tC]);
  const dTotal = useMemo(() => totalOf(dC), [dC]);
  const tMenu = menus[pkey(ymd(tomorrow()), "BREAKFAST")] ?? null;
  const dMenu = menus[pkey(ymd(tomorrow()), "DINNER")] ?? null;
  const lMenu = menus[pkey(ymd(today()), "LUNCH")] ?? null;

  async function confirm() {
    setBusy(true); setErr(""); setResult([]);
    const by = user.id;
    const jobs: { label: string; body: Record<string, unknown> }[] = [];
    // unitId is omitted when the picker is left on "Auto", which makes the API
    // assign the next free route — the old behaviour.
    const pick = (v: string) => (v ? { unitId: Number(v) } : {});
    if (tOn && tTotal > 0) jobs.push({ label: "Morning Tiffin", body: { bookedById: by, date: ymd(tomorrow()), session: "BREAKFAST", slots: tC, ...pick(tUnit) } });
    if (dOn && dTotal > 0) jobs.push({ label: "Dinner", body: { bookedById: by, date: ymd(tomorrow()), session: "DINNER", slots: dC, ...pick(dUnit) } });
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
      {err && Object.keys(menus).length === 0 && <p className="err">{err}</p>}

      <GateBanner gate={gate} onCloseOutNeeded={onCloseOutNeeded} />

      <h2>Tomorrow's meals</h2>
      <div className="grid2">
        <MealCard title="Morning Tiffin" on={tOn} setOn={setTOn} menu={tMenu} counts={tC} setCounts={setTC} total={tTotal}
          id="tiffin" progress={tProg} unit={tUnit} setUnit={setTUnit} blocked={gate?.BREAKFAST}
          past={pastFor("BREAKFAST")} />
        <MealCard title="Dinner" on={dOn} setOn={setDOn} menu={dMenu} counts={dC} setCounts={setDC} total={dTotal}
          id="dinner" progress={dProg} unit={dUnit} setUnit={setDUnit} blocked={gate?.DINNER}
          past={pastFor("DINNER")} />
      </div>

      <h2>Today (count only)</h2>
      <div className="grid2">
        <div className={`meal ${lOn ? "on" : ""}`}>
          <div className="head"><span className="mtitle">Lunch</span><Switch on={lOn} setOn={setLOn} /></div>
          <p className="muted" style={{ margin: "6px 0 0" }}>Same-day · before 11:00 AM · headcount only</p>
          <LunchMenu menu={lMenu} />
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

      {err && Object.keys(menus).length > 0 && <div className="err">{err}</div>}
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

const GROUP_LABEL: Record<string, string> = { ITEM1: "Item 1", ITEM2: "Item 2", ITEM3: "Item 3" };

/** How much of a dish one plate gets — "4 nos", "300 g". */
const perPlate = (d: MenuDish) => (d.unit === "NOS" ? `${d.qtyPerPlate} nos` : `${d.qtyPerPlate} g`);

/**
 * One meal, booked the way the kitchen's own sheet works: three plate counts.
 *
 * The booker used to pick dishes out of a list of sixteen, which is not how
 * any of this runs — the packing sheet's Indent block is three numbers per
 * route, and the menu for that date decides what they are. So the form names
 * the dishes and asks only "how many plates".
 */
function MealCard({ title, on, setOn, menu, counts, setCounts, total, id, progress, unit, setUnit, blocked, past }: {
  title: string; on: boolean; setOn: (b: boolean) => void; menu: DayMenu | null;
  counts: SlotCounts; setCounts: (c: SlotCounts) => void; total: number;
  id: string; progress?: Progress; unit: string; setUnit: (v: string) => void;
  blocked?: MealStatus;
  /** This booker's own past orders of THIS meal, newest first. */
  past: Booking[];
}) {
  const slots = (menu?.slots ?? []).filter((s) => s.group);

  const set = (group: string, v: string) =>
    setCounts({ ...counts, [group]: Number(v.replace(/[^0-9]/g, "")) || 0 });
  const step = (group: string, delta: number) =>
    setCounts({ ...counts, [group]: Math.max(0, (counts[group as "ITEM1"] ?? 0) + delta) });

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
      {!on && <p className="muted" style={{ margin: "6px 0 0" }}>Turn on to enter plate counts.</p>}

      {on && <RoutePicker id={id} progress={progress} value={unit} onChange={setUnit} />}
      {on && !menu && <p className="muted" style={{ marginTop: 8 }}>Loading the menu…</p>}
      {on && menu && slots.length === 0 && (
        <p className="err" style={{ marginTop: 10, fontSize: 13 }}>
          No menu is set for this day. Ask the kitchen to set one before booking.
        </p>
      )}

      {on && slots.length > 0 && (
        <>
          <QuickFill past={past} counts={counts} apply={setCounts} slots={slots} />
          <div className="slots">
            {slots.map((slot) => {
              const val = counts[slot.group as "ITEM1"] ?? 0;
              return (
                <div className="slot" key={slot.group}>
                  <div className="slot-info">
                    <div className="slot-tag">{GROUP_LABEL[slot.group!] ?? slot.group}</div>
                    <div className="slot-dish">
                      {slot.dish.name} <span className="slot-qty">{perPlate(slot.dish)}</span>
                    </div>
                    {slot.accompaniments.length > 0 && (
                      <div className="slot-with">
                        with {slot.accompaniments.map((a) => `${a.name} ${perPlate(a)}`).join(" · ")}
                      </div>
                    )}
                  </div>
                  <div className={`stepper ${val > 0 ? "filled" : ""}`}>
                    <button type="button" aria-label={`Fewer ${slot.dish.name}`} disabled={val === 0} onClick={() => step(slot.group!, -1)}>−</button>
                    <input
                      inputMode="numeric" placeholder="0"
                      aria-label={`${GROUP_LABEL[slot.group!]} plates`}
                      value={val === 0 ? "" : String(val)}
                      onChange={(e) => set(slot.group!, e.target.value)}
                    />
                    <button type="button" aria-label={`More ${slot.dish.name}`} onClick={() => step(slot.group!, +1)}>+</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/** A fingerprint of three plate counts, for telling two shortcuts apart. */
const sigOf = (c: SlotCounts) =>
  (["ITEM1", "ITEM2", "ITEM3"] as const).map((g) => `${g}:${c[g] ?? 0}`).join(",");

/** What this booker usually orders: the average of their last few, rounded.
 *  Offered next to "repeat last" because the most recent order is sometimes
 *  the odd one out and repeating it carries that exception forward. */
function usualSlots(past: Booking[]): SlotCounts | null {
  const recent = past.slice(0, 5).filter((b) => b.slots && Object.keys(b.slots).length);
  if (recent.length < 2) return null;
  const out: SlotCounts = {};
  for (const g of ["ITEM1", "ITEM2", "ITEM3"] as const) {
    const vals = recent.map((b) => b.slots[g] ?? 0).filter((n) => n > 0);
    if (vals.length * 2 < recent.length) continue;
    out[g] = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  return Object.keys(out).length ? out : null;
}

/** One-tap refills from this booker's own history. A shortcut hides itself
 *  once the form already matches it, so it never offers to do nothing. */
function QuickFill({ past, counts, apply, slots }: {
  past: Booking[]; counts: SlotCounts; apply: (c: SlotCounts) => void; slots: MenuSlot[];
}) {
  const last = past[0]?.slots && Object.keys(past[0].slots).length ? past[0].slots : null;
  const usual = usualSlots(past);
  const now = sigOf(counts);

  const options: { key: string; label: string; icon: string; counts: SlotCounts }[] = [];
  if (last) options.push({ key: "last", label: "Repeat last", icon: "ti-rotate", counts: last });
  if (usual && sigOf(usual) !== sigOf(last ?? {})) options.push({ key: "usual", label: "My usual", icon: "ti-star", counts: usual });

  const show = options.filter((o) => sigOf(o.counts) !== now);
  if (show.length === 0) return null;

  const describe = (c: SlotCounts) =>
    slots.map((s) => `${s.dish.name} ${c[s.group as "ITEM1"] ?? 0}`).join(" · ");

  return (
    <div className="quickfill">
      {show.map((o) => (
        <button type="button" className="qf" key={o.key} onClick={() => apply({ ...o.counts })}>
          <i className={`ti ${o.icon}`} aria-hidden="true"></i>
          <span className="qf-text">
            <span className="qf-title">{o.label}</span>
            <span className="qf-sub">{describe(o.counts)}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/** Lunch is a headcount, so its menu is shown rather than ordered. */
function LunchMenu({ menu }: { menu: DayMenu | null }) {
  if (!menu || menu.slots.length === 0) return null;
  return (
    <div className="lunch-menu">
      <span className="lm-lab">Today's menu</span>
      <div className="lm-items">
        {menu.slots.map((s) => <span className="lm-item" key={s.dish.id}>{s.dish.name}</span>)}
      </div>
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

type Stage = "CONSUMPTION" | "AWAITING_VERIFICATION" | "FEEDBACK" | "DONE";

const STAGE_STEP: Record<Stage, number> = {
  CONSUMPTION: 1,
  AWAITING_VERIFICATION: 2,
  FEEDBACK: 3,
  DONE: 3,
};

/** The three-step close-out, shown as a strip so the booker can see where they are. */
function Steps({ stage }: { stage: Stage }) {
  const at = STAGE_STEP[stage];
  const labels = ["Consumption", "Verification", "Feedback"];
  return (
    <ol className="steps" aria-label="Close-out progress">
      {labels.map((l, i) => {
        const n = i + 1;
        const state = stage === "DONE" || n < at ? "done" : n === at ? "now" : "todo";
        return (
          <li key={l} className={`step ${state}`} aria-current={state === "now" ? "step" : undefined}>
            <span className="step-n">{state === "done" ? "\u2713" : n}</span>
            <span className="step-l">{l}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function CloseOut({ preset, onDone }: { user: AuthedUser; preset: Booking | null; onDone: () => void }) {
  const [booking, setBooking] = useState<Booking | null>(preset);
  const [list, setList] = useState<Booking[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [stage, setStage] = useState<Stage>("CONSUMPTION");
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
    if (!booking) { setLines([]); setSentBack(null); setStage("CONSUMPTION"); return; }
    setLoadingItems(true);
    setErr(""); setOk("");
    api.closeoutItems(booking.id)
      .then((r) => {
        setLines(r.items.map((it) => ({ ...it, consumed: it.consumed == null ? "" : String(it.consumed) })));
        setStage(r.stage);
        if (r.previous) {
          setNotes(r.previous.notes ?? "");
          setTaste(r.previous.taste ?? 0);
          setQuality(r.previous.quality ?? 0);
          setRemarks(r.previous.remarks ?? "");
          setSentBack(r.previous.status === "REJECTED" ? (r.previous.rejectionReason || "no reason given") : null);
        } else {
          setNotes(""); setTaste(0); setQuality(0); setRemarks(""); setSentBack(null);
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

  async function sendConsumption() {
    if (!booking) return;
    setBusy(true); setErr(""); setOk("");
    try {
      await api.submitConsumption({
        orderId: booking.id,
        items: lines.map((l) => ({ dishId: l.dishId, consumed: Number(l.consumed) || 0 })),
        notes,
      });
      setStage("AWAITING_VERIFICATION");
      setSentBack(null);
      setOk("Sent to the verification team. They will check the numbers, and then the feedback step opens here.");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  async function sendFeedback() {
    if (!booking) return;
    if (!taste || !quality) { setErr("Rate both taste and quality."); return; }
    setBusy(true); setErr(""); setOk("");
    try {
      await api.submitFeedback({ orderId: booking.id, taste, quality, remarks });
      setStage("DONE");
      setOk("Thank you \u2014 this meal is closed. You can book this route again now.");
      setTimeout(onDone, 1600);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <>
      <h1>Close out a meal</h1>

      {!booking && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Pick a meal to close out</h2>
          {list.length === 0 ? <p className="muted">Nothing to close out right now.</p> :
            list.map((b) => {
              const waiting = b.consumptionStatus === "PENDING";
              const forFeedback = b.consumptionStatus === "VERIFIED" && !b.hasFeedback;
              return (
                <div className="between" key={b.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
                  <div>
                    <b>{b.unit}</b> · {SES[b.session]} · <span className="muted">{new Date(b.date).toDateString()}</span>
                    {b.consumptionStatus === "REJECTED" && (
                      <div className="returned-why">
                        <i className="ti ti-arrow-back-up" aria-hidden="true"></i>
                        <span><b>Sent back:</b> {b.rejectionReason || "no reason given"}</span>
                      </div>
                    )}
                    {waiting && <div className="muted" style={{ marginTop: 3 }}>Waiting on verification</div>}
                    {forFeedback && <div className="muted" style={{ marginTop: 3 }}>Verified \u2014 feedback is open</div>}
                  </div>
                  <button className={`btn sm ${waiting ? "ghost" : ""}`} onClick={() => setBooking(b)}>
                    {b.consumptionStatus === "REJECTED" ? "Fix" : forFeedback ? "Give feedback" : waiting ? "View" : "Select"}
                  </button>
                </div>
              );
            })}
        </div>
      )}

      {booking && (
        <>
          <div className="card soft">
            <div className="between">
              <div><b>{booking.unit}</b> · {SES[booking.session]} · {new Date(booking.date).toDateString()}</div>
              <button className="btn ghost sm" onClick={() => { setBooking(null); refreshList(); }}>Change order</button>
            </div>
            <Steps stage={stage} />
          </div>

          {sentBack && (
            <div className="returned-banner">
              <i className="ti ti-arrow-back-up" aria-hidden="true"></i>
              <div>
                <b>Verification sent this back</b>
                <p>{sentBack}</p>
                <p className="muted">Your previous figures are filled in below \u2014 change what needs changing and send it again.</p>
              </div>
            </div>
          )}

          {(stage === "CONSUMPTION" || stage === "AWAITING_VERIFICATION") && (
            <div className="card">
              <div className="section-title">Step 1 · What was actually consumed</div>
              <p className="muted" style={{ margin: "4px 0 8px" }}>
                {stage === "CONSUMPTION"
                  ? "Enter plates consumed \u2014 leftover is worked out for you."
                  : "Submitted. These are the figures the team is checking."}
              </p>
              {loadingItems && <p className="muted">Loading items\u2026</p>}
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
                    {stage === "CONSUMPTION" ? (
                      <div className={`stepper ${c > 0 ? "filled" : ""}`}>
                        <button type="button" aria-label={`Decrease ${l.name}`} disabled={c === 0} onClick={() => stepConsumed(l.dishId, -1)}>−</button>
                        <input inputMode="numeric" placeholder="0" value={l.consumed} onChange={(e) => setConsumed(l.dishId, e.target.value)} />
                        <button type="button" aria-label={`Increase ${l.name}`} onClick={() => stepConsumed(l.dishId, +1)}>+</button>
                      </div>
                    ) : (
                      <div className="readnum">{c}</div>
                    )}
                  </div>
                );
              })}
              <div className="between" style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", fontWeight: 800 }}>
                <span>Total</span>
                <span>{consumedTotal} / {orderedTotal} plates{orderedTotal - consumedTotal > 0 ? ` · ${orderedTotal - consumedTotal} leftover` : ""}</span>
              </div>
              {stage === "CONSUMPTION" && (
                <>
                  <label className="lab" style={{ marginTop: 14 }}>Notes (optional)</label>
                  <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="anything for the kitchen" />
                </>
              )}
            </div>
          )}

          {stage === "CONSUMPTION" && (
            <button className="btn block" disabled={busy} onClick={sendConsumption}>
              {busy ? "Sending\u2026" : "Send to verification"}
            </button>
          )}

          {stage === "AWAITING_VERIFICATION" && (
            <div className="card soft">
              <div className="section-title">Step 2 · With the verification team</div>
              <p className="muted" style={{ marginTop: 6 }}>
                Nothing to do here. Once they approve the figures, the feedback step opens on this
                screen and you will get a notification. If they send it back, the reason shows here
                and you can correct the numbers.
              </p>
            </div>
          )}

          {(stage === "FEEDBACK" || stage === "DONE") && (
            <div className="card">
              <div className="section-title">Step 3 · How was the food?</div>
              <p className="muted" style={{ margin: "4px 0 10px" }}>
                Your figures are verified. This last step closes the meal and lets you book this route again.
              </p>
              <Stars label="Taste" v={taste} set={setTaste} />
              <Stars label="Quality" v={quality} set={setQuality} />
              <label className="lab" style={{ marginTop: 10 }}>Anything wrong with the food? (optional)</label>
              <input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. sambar arrived cold, idly short by 20" />
              {stage === "FEEDBACK" && (
                <button className="btn block" style={{ marginTop: 14 }} disabled={busy} onClick={sendFeedback}>
                  {busy ? "Saving\u2026" : "Submit feedback & close this meal"}
                </button>
              )}
            </div>
          )}
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
