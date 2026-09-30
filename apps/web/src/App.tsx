// The one app shell.
//
// Replaces four separate React apps that each had their own copy of this
// layout. There is now a single sign-in, and the role on the account decides
// which sections appear (see ./nav). A Super Admin sees all of them, which was
// impossible before — they previously had to sign into a different URL with a
// different account to see a booking or kitchen screen.

import { useEffect, useMemo, useState } from "react";
import { AuthedUser, Booking, NotifSummary, api, clearToken, getToken } from "./api";
import { groupsFor, landingFor, NAV, ROLE_LABEL } from "./nav";
import { LogoMark } from "./Logo";
import { NotificationBell } from "./Notifications";
import { ToastHost } from "./ui";
import { tomorrow, ymd } from "./util";
import Auth from "./Auth";
import { SectionErrorBoundary } from "./ErrorBoundary";
import InstallBanner from "./Install";

const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

export default function App() {
  const [me, setMe] = useState<AuthedUser | null>(null);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<string>("");
  const [navOpen, setNavOpen] = useState(false);
  const [notif, setNotif] = useState<NotifSummary>({ unread: 0, sections: {} });

  // Shared cooking date for the kitchen sections.
  const [date, setDate] = useState(ymd(tomorrow()));
  // Set when the booker jumps from "My Bookings" into closing a specific meal.
  const [closing, setClosing] = useState<Booking | null>(null);

  // Restore a session from a stored token.
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.me()
      .then((r) => { setMe(r.user); setSection(landingFor(r.user.role)); })
      .catch(() => clearToken())
      .finally(() => setReady(true));
  }, []);

  const groups = useMemo(() => (me ? groupsFor(me.role) : []), [me]);
  // Roles with a handful of sections get a thumb-reachable bottom tab bar on a
  // phone; only Super Admin, with fourteen, needs the off-canvas drawer. A
  // hamburger hides every destination behind a tap the booker has to learn
  // about first, which is the wrong trade for three items.
  const tabCount = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);
  const useDrawer = tabCount > 5;
  const current = useMemo(() => NAV.find((i) => i.key === section) ?? null, [section]);

  function signIn(user: AuthedUser) {
    setMe(user);
    setSection(landingFor(user.role));
    setClosing(null);
  }

  function signOut() {
    clearToken();
    setMe(null);
    setSection("");
    setClosing(null);
  }

  /** A notification asks to open a section — honour it only if this role has it. */
  function openSection(key: string) {
    if (!me) return;
    if (NAV.some((i) => i.key === key && i.roles.includes(me.role))) {
      setSection(key);
      setNavOpen(false);
    }
  }

  function go(key: string) {
    setSection(key);
    setNavOpen(false);
  }

  if (!ready)
    return (
      <div className="auth">
        <div className="auth-hero"><div className="auth-brand">Loading…</div></div>
      </div>
    );

  if (!me) return <Auth onAuthed={signIn} />;

  // Props each section needs. Sections ignore what they don't use.
  const sectionProps: Record<string, unknown> = {
    user: me,
    date,
    preset: closing,
    onBooked: () => go("mine"),
    onCloseOut: (b: Booking) => { setClosing(b); go("close"); },
    onDone: () => { setClosing(null); go("mine"); },
    onCloseOutNeeded: () => go("close"),
  };

  const Current = current?.component;

  return (
    <ToastHost>
      <div className="app">
        <div className="navbar">
          <div className="left">
            {useDrawer && (
              <button className="hamburger" onClick={() => setNavOpen(true)} aria-label="Menu">
                <i className="ti ti-menu-2" aria-hidden="true"></i>
                {notif.unread > 0 ? <span className="navdot" style={{ top: 6, right: 6 }} /> : null}
              </button>
            )}
            <div className="logo"><LogoMark size={40} /></div>
            <div className="brand">
              <div className="title">Akshaya Patra Kitchen</div>
              <div className="sub">{ROLE_LABEL[me.role]}</div>
            </div>
          </div>
          <div className="user">
            <NotificationBell onSummary={setNotif} onOpenSection={openSection} />
            <div className="uchip">
              <span className="uavatar">{me.photo ? <img src={me.photo} alt="" /> : initials(me.name)}</span>
              <span className="umeta">
                <span className="uname">{me.name}</span>
                <span className="urole">{ROLE_LABEL[me.role]}</span>
              </span>
            </div>
            <button className="signout" onClick={signOut} aria-label="Sign out">
              <i className="ti ti-logout" aria-hidden="true"></i><span className="lbl">Sign out</span>
            </button>
          </div>
        </div>

        {useDrawer && navOpen ? <div className="drawer-scrim" onClick={() => setNavOpen(false)} /> : null}

        <div className="shell">
          <aside className={`sidebar ${useDrawer ? "drawer" : ""} ${navOpen ? "open" : ""}`}>
            {groups.map(({ group, items }) => (
              <div key={group}>
                <div className="secthead">{group}</div>
                <div className="nav">
                  {items.map((item) => (
                    <div
                      key={item.key}
                      className={`item ${section === item.key ? "active" : ""}`}
                      onClick={() => go(item.key)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(item.key)}
                    >
                      <i className={item.icon} aria-hidden="true"></i> {item.label}
                      {notif.sections[item.key] ? <span className="navdot" /> : null}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          <main className="main">
            <InstallBanner />

            {current?.needsDate ? (
              <div className="toolbar">
                <label className="muted" htmlFor="cooking-date">Cooking date</label>
                <input
                  id="cooking-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  style={{ width: "auto" }}
                />
              </div>
            ) : null}

            <SectionErrorBoundary resetKey={section}>
              {Current ? <Current {...sectionProps} /> : <p className="muted">Pick a section.</p>}
            </SectionErrorBoundary>
          </main>
        </div>
      </div>
    </ToastHost>
  );
}
