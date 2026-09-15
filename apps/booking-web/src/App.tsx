import { useEffect, useState } from "react";
import { api, AuthedUser, Booking, NotifSummary, clearToken, getToken } from "./api";
import { LogoMark } from "./Logo";
import { NotificationBell } from "./Notifications";
import { OtaUpdate } from "./OtaUpdate";
import { NewBooking, MyBookings, CloseOut } from "./views";
import Auth from "./Auth";

type View = "new" | "mine" | "close";

const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

export default function App() {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<View>("new");
  const [closing, setClosing] = useState<Booking | null>(null);
  const [notif, setNotif] = useState<NotifSummary>({ unread: 0, sections: {} });

  // restore session
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.me().then((r) => setUser(r.user)).catch(() => clearToken()).finally(() => setReady(true));
  }, []);

  function signOut() { clearToken(); setUser(null); setView("new"); }

  if (!ready) return <div className="auth"><div className="auth-hero"><div className="auth-brand">Loading…</div></div></div>;
  if (!user) return <Auth role="BOOKING" subtitle="Meal Booking Portal" allowSignup onAuthed={(u) => { setUser(u); setView("new"); }} />;

  const nav = (v: View) => setView(v);

  return (
    <div className="app">
      <div className="navbar">
        <div className="left">
          <div className="logo"><LogoMark size={40} /></div>
          <div className="brand">
            <div className="title">Akshaya Patra Kitchen</div>
            <div className="sub">Meal Booking Portal</div>
          </div>
        </div>
        <div className="user">
          <NotificationBell onSummary={setNotif} onOpenSection={(s) => { if (s === "new" || s === "mine" || s === "close") setView(s as View); }} />
          <div className="uchip">
            <span className="uavatar">{user.photo ? <img src={user.photo} alt="" /> : initials(user.name)}</span>
            <span className="umeta">
              <span className="uname">{user.name}</span>
              <span className="urole">Booking</span>
            </span>
          </div>
          <button className="signout" onClick={signOut} aria-label="Sign out">
            <i className="ti ti-logout" aria-hidden="true"></i><span className="lbl">Sign out</span>
          </button>
        </div>
      </div>

      <OtaUpdate app="booking" />

      <div className="shell">
        <aside className="sidebar">
          <div className="secthead">Booking</div>
          <div className="nav">
            <div className={`item ${view === "new" ? "active" : ""}`} onClick={() => nav("new")}>
              <i className="ti ti-tools-kitchen-2" aria-hidden="true"></i> New Booking
            </div>
            <div className={`item ${view === "mine" ? "active" : ""}`} onClick={() => nav("mine")}>
              <i className="ti ti-clipboard-list" aria-hidden="true"></i> My Bookings
              {notif.sections["mine"] ? <span className="navdot" /> : null}
            </div>
            <div className={`item ${view === "close" ? "active" : ""}`} onClick={() => nav("close")}>
              <i className="ti ti-checkup-list" aria-hidden="true"></i> Close a Meal
              {notif.sections["close"] ? <span className="navdot" /> : null}
            </div>
          </div>
        </aside>

        <main className="main">
          {view === "new" && <NewBooking user={user} onBooked={() => setView("mine")} />}
          {view === "mine" && (
            <MyBookings user={user} onCloseOut={(b) => { setClosing(b); setView("close"); }} />
          )}
          {view === "close" && (
            <CloseOut user={user} preset={closing} onDone={() => { setClosing(null); setView("mine"); }} />
          )}
        </main>
      </div>
    </div>
  );
}
