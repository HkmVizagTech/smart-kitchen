// One sign-in screen for everyone.
//
// The four old apps each hard-coded the role they signed people in as. There is
// now a single entry point: you sign in, and the role on your account decides
// what you see. Self-registration creates a BOOKING account only — the API
// rejects any other role from this endpoint, and kitchen, verification and
// super-admin accounts are created by a Super Admin.

import { useState } from "react";
import { api, AuthedUser, setToken } from "./api";
import { Emblem } from "./Logo";

export default function Auth({ onAuthed }: { onAuthed: (u: AuthedUser) => void }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const [f, setF] = useState({
    name: "", username: "", password: "", phone: "", email: "",
    iskconRole: "", centre: "", address: "",
  });
  const [photo, setPhoto] = useState<string>("");
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));

  function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhoto(String(reader.result));
    reader.readAsDataURL(file);
  }

  async function signin() {
    setBusy(true); setError("");
    try {
      const { token, user } = await api.login(identifier, password);
      setToken(token); onAuthed(user);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  async function signup() {
    setBusy(true); setError("");
    try {
      const { token, user } = await api.signup({ role: "BOOKING", ...f, photo: photo || undefined });
      setToken(token); onAuthed(user);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-emblem"><Emblem size={64} /></div>
        <div className="auth-brand">Akshaya Patra Kitchen</div>
        <div className="auth-sub">Sign in to continue</div>
      </div>

      <div className="auth-card">
        <div className="auth-tabs">
          <button id="tab-signin" className={mode === "signin" ? "on" : ""}
            onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
          <button id="tab-signup" className={mode === "signup" ? "on" : ""}
            onClick={() => { setMode("signup"); setError(""); }}>Create booking account</button>
        </div>

        {mode === "signin" ? (
          <div className="auth-form">
            <label className="lab" htmlFor="identifier">Username, email or phone</label>
            <input id="identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)}
              placeholder="your login" autoComplete="username" />
            <label className="lab" htmlFor="password" style={{ marginTop: 12 }}>Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              placeholder="password" autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && password && identifier && signin()} />
            <button className="btn block" style={{ marginTop: 16 }}
              disabled={busy || !identifier || !password} onClick={signin}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 14, textAlign: "center" }}>
              Kitchen, verification and admin accounts are created by a Super Admin.
            </p>
          </div>
        ) : (
          <div className="auth-form">
            <p className="muted" style={{ fontSize: 12, marginBottom: 10 }}>
              This creates a booking account, for placing meal orders.
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6 }}>
              <label className="photo-pick">
                {photo ? <img src={photo} alt="" /> : <i className="ti ti-camera" aria-hidden="true"></i>}
                <input type="file" accept="image/*" onChange={onPhoto} hidden />
              </label>
              <div>
                <div style={{ fontWeight: 600 }}>Profile photo</div>
                <div className="muted" style={{ fontSize: 12 }}>Tap to add (optional)</div>
              </div>
            </div>
            <Two>
              <Field id="su-name" label="Full name *" v={f.name} on={(v) => set("name", v)} />
              <Field id="su-username" label="Username *" v={f.username} on={(v) => set("username", v)} />
            </Two>
            <Two>
              <Field id="su-phone" label="Phone" v={f.phone} on={(v) => set("phone", v)} />
              <Field id="su-email" label="Email" v={f.email} on={(v) => set("email", v)} />
            </Two>
            <Field id="su-password" label="Password * (min 8 characters)" v={f.password}
              on={(v) => set("password", v)} type="password" />
            <Two>
              <Field id="su-role" label="Role in ISKCON" v={f.iskconRole} on={(v) => set("iskconRole", v)} />
              <Field id="su-centre" label="Centre / organization" v={f.centre} on={(v) => set("centre", v)} />
            </Two>
            <Field id="su-address" label="Address" v={f.address} on={(v) => set("address", v)} />
            <button className="btn block" style={{ marginTop: 14 }}
              disabled={busy || !f.name || !f.username || f.password.length < 8} onClick={signup}>
              {busy ? "Creating…" : "Create account"}
            </button>
          </div>
        )}
        {error && <div className="err">{error}</div>}
      </div>
    </div>
  );
}

function Two({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}

function Field({ id, label, v, on, type }: {
  id: string; label: string; v: string; on: (v: string) => void; type?: string;
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <label className="lab" htmlFor={id}>{label}</label>
      <input id={id} type={type ?? "text"} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
