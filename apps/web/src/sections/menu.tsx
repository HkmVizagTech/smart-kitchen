// The menu editor — the kitchen's screen, not the booker's.
//
// The kitchen decides what is cooked; bookers only say how many plates. So this
// screen edits the thing everything else derives from, and it is deliberately
// plain: a weekday down the side, three lines across, dishes chosen from a list.
//
// Two tabs, because they answer two different questions:
//
//   Weekly plan   "what do we cook on a Tuesday?"   — repeats, every Tuesday
//   One day       "what are we cooking this Tuesday?" — pins that date only
//
// The plan is what people edit twice a year. The one-day override is for the
// festival, the delivery that did not arrive, the visitor. Keeping them apart
// means nobody changes every Tuesday when they meant to change one.

import { useEffect, useMemo, useState } from "react";
import { api, MenuOptionDish, MenuAdminSlot, DayPlan } from "../api";

const SESSIONS: { key: "BREAKFAST" | "LUNCH" | "DINNER"; label: string }[] = [
  { key: "BREAKFAST", label: "Morning Tiffin" },
  { key: "LUNCH", label: "Lunch" },
  { key: "DINNER", label: "Dinner" },
];
const DAY_LABEL: Record<string, string> = {
  MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday",
  FRI: "Friday", SAT: "Saturday", SUN: "Sunday",
};
const GROUPS = ["ITEM1", "ITEM2", "ITEM3"] as const;
const GROUP_LABEL: Record<string, string> = { ITEM1: "Item 1", ITEM2: "Item 2", ITEM3: "Item 3" };

/** A line being edited. Kept flat so the form stays easy to reason about. */
type Draft = { group: string | null; dishId: number; accompanimentIds: number[] };

const perPlate = (d: { qtyPerPlate: number; unit: string }) =>
  `${d.qtyPerPlate} ${d.unit === "NOS" ? "nos" : "g"}`;

const toDraft = (s: MenuAdminSlot): Draft => ({
  group: s.group,
  dishId: s.dish.id,
  accompanimentIds: s.accompaniments.map((a) => a.id),
});

export default function Menu({ date }: { date: string }) {
  const [tab, setTab] = useState<"plan" | "day">("plan");
  const [session, setSession] = useState<"BREAKFAST" | "LUNCH" | "DINNER">("BREAKFAST");
  const [dishes, setDishes] = useState<MenuOptionDish[]>([]);
  const [cycles, setCycles] = useState<Record<string, number>>({});
  const [week, setWeek] = useState(1);
  const [plan, setPlan] = useState<DayPlan[]>([]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [daySlots, setDaySlots] = useState<MenuAdminSlot[]>([]);
  const [overridden, setOverridden] = useState(false);
  const [booked, setBooked] = useState(0);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  const mains = useMemo(() => dishes.filter((d) => !d.accompaniment), [dishes]);
  const sides = useMemo(() => dishes.filter((d) => d.accompaniment), [dishes]);
  const cycle = cycles[session] ?? 1;

  useEffect(() => {
    api.menuOptions()
      .then((o) => { setDishes(o.dishes); setCycles(o.cycles); })
      .catch((e) => setErr(e.message));
  }, []);

  function loadPlan() {
    api.menuPlan(session, week)
      .then((r) => setPlan(r.days))
      .catch((e) => setErr(e.message));
  }
  function loadDay() {
    api.menuDay(date, session)
      .then((r) => { setDaySlots(r.slots); setOverridden(r.overridden); setBooked(r.booked); })
      .catch((e) => setErr(e.message));
  }
  useEffect(() => { if (tab === "plan") loadPlan(); }, [tab, session, week]);
  useEffect(() => { if (tab === "day") loadDay(); }, [tab, session, date]);
  useEffect(() => { setDraft(null); setOpenDay(null); setErr(""); setOk(""); }, [tab, session, week, date]);

  // ---- editing a draft -------------------------------------------------
  function addLine() {
    setDraft((d) => {
      const cur = d ?? [];
      if (session !== "LUNCH") {
        const free = GROUPS.find((g) => !cur.some((l) => l.group === g));
        if (!free) return cur;
        return [...cur, { group: free, dishId: mains[0]?.id ?? 0, accompanimentIds: [] }];
      }
      return [...cur, { group: null, dishId: mains[0]?.id ?? 0, accompanimentIds: [] }];
    });
  }
  const setLine = (i: number, patch: Partial<Draft>) =>
    setDraft((d) => (d ?? []).map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const dropLine = (i: number) => setDraft((d) => (d ?? []).filter((_, k) => k !== i));
  const toggleSide = (i: number, id: number) =>
    setDraft((d) => (d ?? []).map((l, k) => k !== i ? l : {
      ...l,
      accompanimentIds: l.accompanimentIds.includes(id)
        ? l.accompanimentIds.filter((x) => x !== id)
        : [...l.accompanimentIds, id],
    }));

  async function savePlan(day: string) {
    if (!draft) return;
    setBusy(true); setErr(""); setOk("");
    try {
      await api.saveMenuPlan({ session, week, day, slots: draft });
      setOk(`Every ${DAY_LABEL[day]} updated.`);
      setDraft(null); setOpenDay(null); loadPlan();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function saveDay() {
    if (!draft) return;
    setBusy(true); setErr(""); setOk("");
    try {
      await api.saveMenuDay({ session, date, slots: draft });
      setOk("This one day is changed. The weekly plan is untouched.");
      setDraft(null); loadDay();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function clearDay() {
    setBusy(true); setErr(""); setOk("");
    try {
      await api.clearMenuDay(date, session);
      setOk("Back to the weekly plan for this day.");
      setDraft(null); loadDay();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  // ---- the shared line editor -----------------------------------------
  function Editor({ onSave, onCancel, saveLabel }: {
    onSave: () => void; onCancel: () => void; saveLabel: string;
  }) {
    const lines = draft ?? [];
    return (
      <div className="menu-edit">
        {lines.length === 0 && <p className="muted">Nothing planned. Add a line below.</p>}
        {lines.map((l, i) => (
          <div className="menu-line" key={i}>
            <div className="between">
              <span className="slot-tag">
                {l.group ? GROUP_LABEL[l.group] : `Dish ${i + 1}`}
              </span>
              <button className="btn ghost sm" type="button" onClick={() => dropLine(i)}>
                <i className="ti ti-trash" aria-hidden="true"></i> Remove
              </button>
            </div>
            <select
              value={l.dishId}
              aria-label="Dish"
              onChange={(e) => setLine(i, { dishId: Number(e.target.value) })}
            >
              {mains.map((d) => (
                <option key={d.id} value={d.id}>{d.name} — {perPlate(d)} a plate</option>
              ))}
            </select>
            <div className="lab" style={{ marginTop: 10 }}>Served with</div>
            <div className="chips">
              {sides.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`chip ${l.accompanimentIds.includes(s.id) ? "on" : ""}`}
                  aria-pressed={l.accompanimentIds.includes(s.id)}
                  onClick={() => toggleSide(i, s.id)}
                >
                  {s.name}
                </button>
              ))}
            </div>
            <p className="muted" style={{ marginTop: 6, fontSize: 12 }}>
              These are cooked at this line's plate count. Nobody orders them separately.
            </p>
          </div>
        ))}
        <div className="row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
          <button className="btn ghost sm" type="button" onClick={addLine}
            disabled={session !== "LUNCH" && lines.length >= 3}>
            <i className="ti ti-plus" aria-hidden="true"></i> Add a dish
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn ghost sm" type="button" onClick={onCancel}>Cancel</button>
          <button className="btn sm" type="button" disabled={busy} onClick={onSave}>
            {busy ? "Saving…" : saveLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <h1>Menu</h1>
      <p className="muted" style={{ marginTop: -6 }}>
        What the kitchen cooks. Bookers see this and enter plate counts against it — they never
        pick dishes.
      </p>

      <div className="toolbar" style={{ marginTop: 14 }}>
        <div className="segmented">
          <button className={tab === "plan" ? "on" : ""} onClick={() => setTab("plan")}>Weekly plan</button>
          <button className={tab === "day" ? "on" : ""} onClick={() => setTab("day")}>One day</button>
        </div>
        <div className="segmented">
          {SESSIONS.map((s) => (
            <button key={s.key} className={session === s.key ? "on" : ""} onClick={() => setSession(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
        {tab === "plan" && cycle > 1 && (
          <div className="segmented">
            {Array.from({ length: cycle }, (_, i) => i + 1).map((w) => (
              <button key={w} className={week === w ? "on" : ""} onClick={() => setWeek(w)}>Week {w}</button>
            ))}
          </div>
        )}
      </div>

      {err && <div className="err">{err}</div>}
      {ok && <div className="ok">{ok}</div>}

      {tab === "plan" && (
        <>
          <div className="card soft">
            <p className="muted" style={{ margin: 0 }}>
              Changes here apply to <b>every</b> {session === "LUNCH" ? "lunch" : "week"} from now on.
              To change a single date instead, use <b>One day</b>.
            </p>
          </div>
          {plan.map((d) => (
            <div className="card" key={d.day}>
              <div className="between">
                <div className="section-title">{DAY_LABEL[d.day] ?? d.day}</div>
                {openDay === d.day ? null : (
                  <button className="btn ghost sm" onClick={() => { setOpenDay(d.day); setDraft(d.slots.map(toDraft)); }}>
                    <i className="ti ti-pencil" aria-hidden="true"></i> Edit
                  </button>
                )}
              </div>
              {openDay === d.day ? (
                <Editor onSave={() => savePlan(d.day)} onCancel={() => { setOpenDay(null); setDraft(null); }}
                  saveLabel={`Save every ${DAY_LABEL[d.day]}`} />
              ) : (
                <SlotList slots={d.slots} />
              )}
            </div>
          ))}
        </>
      )}

      {tab === "day" && (
        <div className="card">
          <div className="between">
            <div className="section-title">
              {new Date(date + "T00:00:00").toDateString()}
              {overridden ? <span className="pill" style={{ marginLeft: 8 }}>changed for this day</span> : null}
            </div>
            {draft || booked > 0 ? null : (
              <div className="row" style={{ gap: 8 }}>
                {overridden && (
                  <button className="btn ghost sm" disabled={busy} onClick={clearDay}>
                    <i className="ti ti-rotate" aria-hidden="true"></i> Use the weekly plan
                  </button>
                )}
                <button className="btn ghost sm" onClick={() => setDraft(daySlots.map(toDraft))}>
                  <i className="ti ti-pencil" aria-hidden="true"></i> Change this day
                </button>
              </div>
            )}
          </div>
          {draft ? (
            <Editor onSave={saveDay} onCancel={() => setDraft(null)} saveLabel="Save this day only" />
          ) : (
            <>
              {booked > 0 ? (
                <p className="muted" style={{ marginTop: 6 }}>
                  {booked} route{booked === 1 ? " has" : "s have"} already booked this meal, so the menu
                  for this day is fixed — their orders were written against it. Change the date above,
                  or edit the weekly plan for future days.
                </p>
              ) : !overridden ? (
                <p className="muted" style={{ marginTop: 6 }}>
                  From the weekly plan. Changing it here pins this date and leaves the plan alone.
                </p>
              ) : null}
              <SlotList slots={daySlots} />
            </>
          )}
        </div>
      )}
    </>
  );

  function SlotList({ slots }: { slots: MenuAdminSlot[] }) {
    if (slots.length === 0) return <p className="muted" style={{ marginTop: 8 }}>Nothing planned.</p>;
    return (
      <div className="slots" style={{ marginTop: 8 }}>
        {slots.map((s) => (
          <div className="slot" key={s.id}>
            <div className="slot-info">
              {s.group && <div className="slot-tag">{GROUP_LABEL[s.group]}</div>}
              <div className="slot-dish">
                {s.dish.name} <span className="slot-qty">{perPlate(s.dish)}</span>
              </div>
              {s.accompaniments.length > 0 && (
                <div className="slot-with">
                  with {s.accompaniments.map((a) => `${a.name} ${perPlate(a)}`).join(" · ")}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
}
