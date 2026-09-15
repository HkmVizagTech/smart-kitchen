import { useState } from "react";
import { api, AuthedUser, Role, setToken } from "./api";
import { Emblem } from "./Logo";

// Professional sign-in / create-account screen. Role is fixed by the app.
export default function Auth({
  role,
  subtitle,
  onAuthed,
  // Only the Booking app lets people create their own account. Kitchen,
  // Verification and Super Admin accounts are created by a Super Admin — the
  // API rejects self-signup for those roles, so we don't offer the tab.
  allowSignup = false,
}: {
  role: Role;
  subtitle: string;
  onAuthed: (u: AuthedUser) => void;
  allowSignup?: boolean;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // sign in
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  // sign up
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
      const { token, user } = await api.signup({ role, ...f, photo: photo || undefined });
      setToken(token); onAuthed(user);
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <div className="auth-hero">
        <div className="auth-emblem"><Emblem size={64} /></div>
        <div className="auth-brand">Akshaya Patra Kitchen</div>
        <div className="auth-sub">{subtitle}</div>
      </div>

      <div className="auth-card">
        {allowSignup ? (
          <div className="auth-tabs">
            <button className={mode === "signin" ? "on" : ""} onClick={() => { setMode("signin"); setError(""); }}>Sign in</button>
            <button className={mode === "signup" ? "on" : ""} onClick={() => { setMode("signup"); setError(""); }}>Create account</button>
          </div>
        ) : null}

        {mode === "signin" || !allowSignup ? (
          <div className="auth-form">
            <label className="lab">Username, email or phone</label>
            <input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="your login" autoComplete="username" />
            <label className="lab" style={{ marginTop: 12 }}>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="password" autoComplete="current-password"
              onKeyDown={(e) => e.key === "Enter" && password && identifier && signin()} />
            <button className="btn block" style={{ marginTop: 16 }} disabled={busy || !identifier || !password} onClick={signin}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 14, textAlign: "center" }}>
              Need an account? A Super Admin creates it for you.
            </p>
          </div>
        ) : (
          <div className="auth-form">
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
              <Field label="Full name *" v={f.name} on={(v) => set("name", v)} />
              <Field label="Username *" v={f.username} on={(v) => set("username", v)} />
            </Two>
            <Two>
              <Field label="Phone" v={f.phone} on={(v) => set("phone", v)} />
              <Field label="Email" v={f.email} on={(v) => set("email", v)} />
            </Two>
            <Field label="Password *" v={f.password} on={(v) => set("password", v)} type="password" />
            <Two>
              <Field label="Role in ISKCON" v={f.iskconRole} on={(v) => set("iskconRole", v)} />
              <Field label="Centre / organization" v={f.centre} on={(v) => set("centre", v)} />
            </Two>
            <Field label="Address" v={f.address} on={(v) => set("address", v)} />
            <button className="btn block" style={{ marginTop: 14 }} disabled={busy || !f.name || !f.username || !f.password} onClick={signup}>
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
function Field({ label, v, on, type }: { label: string; v: string; on: (v: string) => void; type?: string }) {
  return (
    <div style={{ marginTop: 10 }}>
      <label className="lab">{label}</label>
      <input type={type ?? "text"} value={v} onChange={(e) => on(e.target.value)} />
    </div>
  );
}
