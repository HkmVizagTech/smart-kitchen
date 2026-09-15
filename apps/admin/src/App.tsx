import { useEffect, useState } from "react";
import { AuthedUser, NotifSummary, api, clearToken, getToken } from "./api";
import { LogoMark } from "./Logo";
import { Dishes, Units, Users, Vessels, Packing, Orders, Dashboard, Reports, Settings } from "./sections";
import { NotificationBell } from "./Notifications";
import { OtaUpdate } from "./OtaUpdate";
import { ToastHost } from "./ui";
import Auth from "./Auth";

type Me = AuthedUser;

const initials = (name: string) =>
  name.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";

const TABS = ["Dashboard", "Orders", "Packing", "Reports", "Dishes", "Vessels", "Units", "Users", "Settings"] as const;
type Tab = (typeof TABS)[number];

const ICONS: Record<Tab, string> = {
  Dashboard: "ti ti-layout-dashboard",
  Orders: "ti ti-clipboard-list",
  Packing: "ti ti-file-spreadsheet",
  Reports: "ti ti-chart-bar",
  Dishes: "ti ti-soup",
  Vessels: "ti ti-bowl",
  Units: "ti ti-building-community",
  Users: "ti ti-users",
  Settings: "ti ti-settings",
};

export default function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("Dashboard");
  const [notif, setNotif] = useState<NotifSummary>({ unread: 0, sections: {} });
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    api.me().then((r) => setMe(r.user)).catch(() => clearToken()).finally(() => setReady(true));
  }, []);

  if (!ready) return <div className="auth"><div className="auth-hero"><div className="auth-brand">Loading…</div></div></div>;
  if (!me) return <Auth role="SUPER_ADMIN" subtitle="Super Admin Console" onAuthed={(u) => { setMe(u); setTab("Dashboard"); }} />;

  return (
    <ToastHost>
    <div className="app">
      <div className="navbar">
        <div className="left">
          <button className="hamburger" onClick={() => setNavOpen(true)} aria-label="Menu">
            <i className="ti ti-menu-2" aria-hidden="true"></i>
            {notif.unread > 0 ? <span className="navdot" style={{ top: 6, right: 6 }} /> : null}
          </button>
          <div className="logo"><LogoMark size={40} /></div>
          <div className="brand">
            <div className="title">Akshaya Patra Kitchen</div>
            <div className="sub">Super Admin Console</div>
          </div>
        </div>
        <div className="user">
          <NotificationBell onSummary={setNotif} onOpenSection={(s) => setTab(s === "orders" || s === "verify" ? "Orders" : "Dashboard")} />
          <div className="uchip">
            <span className="uavatar">{me.photo ? <img src={me.photo} alt="" /> : initials(me.name)}</span>
            <span className="umeta">
              <span className="uname">{me.name}</span>
              <span className="urole">Super Admin</span>
            </span>
          </div>
          <button className="signout" onClick={() => { clearToken(); setMe(null); }} aria-label="Sign out">
            <i className="ti ti-logout" aria-hidden="true"></i><span className="lbl">Sign out</span>
          </button>
        </div>
      </div>

      <OtaUpdate app="admin" />

      {navOpen ? <div className="drawer-scrim" onClick={() => setNavOpen(false)} /> : null}

      <div className="shell">
        <aside className={`sidebar drawer ${navOpen ? "open" : ""}`}>
          <div className="secthead">Administration</div>
          <div className="nav">
            {TABS.map((t) => (
              <div
                key={t}
                className={`item ${tab === t ? "active" : ""}`}
                onClick={() => { setTab(t); setNavOpen(false); }}
              >
                <i className={ICONS[t]} aria-hidden="true"></i> {t}
                {t === "Orders" && (notif.sections["orders"] || notif.sections["verify"]) ? <span className="navdot" /> : null}
              </div>
            ))}
          </div>
        </aside>

        <main className="main">
          {tab === "Dashboard" && <Dashboard />}
          {tab === "Orders" && <Orders />}
          {tab === "Packing" && <Packing />}
          {tab === "Reports" && <Reports />}
          {tab === "Dishes" && <Dishes />}
          {tab === "Vessels" && <Vessels />}
          {tab === "Units" && <Units />}
          {tab === "Users" && <Users />}
          {tab === "Settings" && <Settings />}
        </main>
      </div>
    </div>
    </ToastHost>
  );
}

