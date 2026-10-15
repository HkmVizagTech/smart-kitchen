// What the routes said about the food.
//
// The close-out has always ended by asking the booker to rate taste and
// quality and to say what was wrong. Every one of those answers was stored and
// none of them were ever shown: the only trace anywhere in the app was an
// average on the admin Reports tile. The kitchen — the one group that can act
// on "sambar arrived cold" — had no way to see it at all.
//
// This screen is that missing half. Kitchen and Super Admin see it; the
// verification team deliberately does not, because their job is to check the
// plate counts and a rating seen beforehand would colour that.

import { useCallback, useEffect, useState } from "react";
import { api, FeedbackRow } from "../api";
import { plural, useLiveRefresh } from "../ui";

const SES: Record<string, string> = { BREAKFAST: "Tiffin", LUNCH: "Lunch", DINNER: "Dinner" };

/** Five boxes, filled to the rating. Colour carries the warning, not the count. */
function Stars({ n }: { n: number }) {
  return (
    <span className={`fb-stars ${n <= 2 ? "poor" : n >= 4 ? "good" : ""}`} aria-label={`${n} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={`ti ti-star${i <= n ? "-filled" : ""}`} aria-hidden="true" />
      ))}
    </span>
  );
}

export default function Feedback() {
  const [rows, setRows] = useState<FeedbackRow[]>([]);
  const [sum, setSum] = useState<{ count: number; avgTaste: number; avgQuality: number; poor: number; withRemarks: number } | null>(null);
  const [filter, setFilter] = useState<"all" | "problems" | "remarks">("all");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (fresh = false) => {
    if (fresh) setLoading(true);
    try {
      const [r, s] = await Promise.all([api.feedback({ limit: 100 }), api.feedbackSummary()]);
      setRows(r);
      setSum(s);
      setErr("");
    } catch (e: any) {
      if (fresh) setErr(e.message);
    } finally {
      if (fresh) setLoading(false);
    }
  }, []);

  useEffect(() => { load(true); }, [load]);
  // New feedback arrives from somebody else's phone, so this screen waits on
  // other people the same way the close-out does.
  useLiveRefresh(() => load(false), true);

  if (loading) return <p className="muted">Loading…</p>;
  if (err) return <p className="err">{err}</p>;

  const shown = rows.filter((r) =>
    filter === "problems" ? r.taste <= 2 || r.quality <= 2
    : filter === "remarks" ? !!r.remarks
    : true
  );

  return (
    <div>
      <h1>Feedback</h1>
      <p className="muted">What each route said about the food after their meal was verified.</p>

      {sum && (
        <div className="stats-grid">
          <div className="stat">
            <div className="l">Last 30 days</div>
            <div className="n">{sum.count}</div>
            <div className="s">{plural(sum.withRemarks, "written comment")}</div>
          </div>
          <div className="stat">
            <div className="l">Avg taste</div>
            <div className="n">{sum.avgTaste || "—"}</div>
            <div className="s">out of 5</div>
          </div>
          <div className="stat">
            <div className="l">Avg quality</div>
            <div className="n">{sum.avgQuality || "—"}</div>
            <div className="s">out of 5</div>
          </div>
          <div className={`stat ${sum.poor ? "hot" : ""}`}>
            <div className="l">Rated 2 or below</div>
            <div className="n">{sum.poor}</div>
            <div className="s">worth following up</div>
          </div>
        </div>
      )}

      <div className="segmented" style={{ marginTop: 16 }}>
        <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
          All ({rows.length})
        </button>
        <button className={filter === "problems" ? "on" : ""} onClick={() => setFilter("problems")}>
          Problems ({rows.filter((r) => r.taste <= 2 || r.quality <= 2).length})
        </button>
        <button className={filter === "remarks" ? "on" : ""} onClick={() => setFilter("remarks")}>
          With a comment ({rows.filter((r) => r.remarks).length})
        </button>
      </div>

      {shown.length === 0 && (
        <p className="muted" style={{ marginTop: 16 }}>
          {rows.length === 0
            ? "No feedback yet. It appears here once a route closes out a meal and verification approves the counts."
            : "Nothing matches this filter."}
        </p>
      )}

      <div className="olist" style={{ marginTop: 14 }}>
        {shown.map((f) => (
          <div className={`ocard ${f.taste <= 2 || f.quality <= 2 ? "fb-poor" : ""}`} key={f.id}>
            <div className="top">
              <div>
                <div className="ounit">{f.unit}</div>
                <div className="oplates">
                  {SES[f.session] ?? f.session} · {new Date(f.date).toDateString()}
                  {f.by ? ` · ${f.by}` : ""}
                </div>
              </div>
              <div className="fb-rates">
                <span className="fb-rate"><span className="fb-lab">Taste</span><Stars n={f.taste} /></span>
                <span className="fb-rate"><span className="fb-lab">Quality</span><Stars n={f.quality} /></span>
              </div>
            </div>

            {f.remarks && (
              <blockquote className="fb-remark">
                <i className="ti ti-message-2" aria-hidden="true"></i>
                <span>{f.remarks}</span>
              </blockquote>
            )}

            {f.dishes.length > 0 && (
              <div className="oitems">
                {f.dishes.map((d) => `${d.plates}× ${d.name}`).join(" · ")}
              </div>
            )}

            {f.consumed != null && (
              <div className="oplates" style={{ marginTop: 8 }}>
                {f.consumed} of {f.ordered} plates eaten
                {f.leftover ? ` · ${f.leftover} left over` : ""}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
