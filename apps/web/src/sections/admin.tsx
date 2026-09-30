import { useEffect, useState } from "react";
import { api, Dish, DishGroup, Unit, User, Vessel, Role, NewUser } from "../api";
import { ymd, today } from "../util";
import { Modal, Field, useToast } from "../ui";

function useAsync<T>(fn: () => Promise<T>, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const reload = () => {
    setLoading(true);
    fn()
      .then((d) => {
        setData(d);
        setError("");
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(reload, deps);
  return { data, error, loading, reload, setData };
}

// ---------------- DISHES ----------------
const DISH_GROUPS: DishGroup[] = ["ITEM1", "ITEM2", "ITEM3"];
const GROUP_LABEL: Record<DishGroup, string> = { ITEM1: "Item 1", ITEM2: "Item 2", ITEM3: "Item 3" };
const GROUP_NOTE: Record<DishGroup, string> = {
  ITEM1: "Tiffin mains (Idly, Sambar, FG Chutney…)",
  ITEM2: "Rice & gravies (White Rice, Dal, Biryani…)",
  ITEM3: "Tiffin sides (Wada, Punugulu, Uppama…)",
};

export function Dishes() {
  const { data, error, loading, reload } = useAsync(() => api.dishes());
  const toast = useToast();
  const [edits, setEdits] = useState<Record<number, Partial<Dish>>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  function set(id: number, key: "qtyPerPlate" | "packingFactor" | "packingVesselKg" | "ratePerPlate", value: string) {
    setEdits((e) => ({ ...e, [id]: { ...e[id], [key]: value === "" ? null : Number(value) } }));
  }
  async function save(d: Dish) {
    setSavingId(d.id);
    try {
      await api.saveDish(d.id, edits[d.id] ?? {});
      toast(`Saved ${d.name}`);
      setEdits((e) => { const n = { ...e }; delete n[d.id]; return n; });
      reload();
    } catch (e: any) { toast(e.message, "err"); }
    finally { setSavingId(null); }
  }
  async function saveField(d: Dish, body: Partial<Dish>) {
    try { await api.saveDish(d.id, body); toast(`Updated ${d.name}`); reload(); }
    catch (e: any) { toast(e.message, "err"); }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">{error}</p>;

  const dirty = (id: number) => !!edits[id] && Object.keys(edits[id]).length > 0;

  return (
    <div>
      <div className="between page-head">
        <div>
          <h1>Dishes</h1>
          <p className="muted">
            Groups, menu quantities, packing factors and rates. Vessel kg is blank for counted
            items; a blank rate charges the default set under Settings.
          </p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>
          <i className="ti ti-plus" aria-hidden="true"></i> Add Dish
        </button>
      </div>

      {DISH_GROUPS.map((g) => {
        const items = data!.filter((d) => d.group === g);
        if (items.length === 0) return null;
        return (
          <div className="card editor-group" key={g}>
            <div className="eg-head">
              <span className="eg-badge"><i className="ti ti-bowl-spoon" aria-hidden="true"></i> {GROUP_LABEL[g]}</span>
              <span className="eg-note">{GROUP_NOTE[g]}</span>
            </div>
            {items.map((d) => (
              <div className="erow" key={d.id}>
                <div className="erow-main">
                  <span className="dish-ic"><i className="ti ti-soup" aria-hidden="true"></i></span>
                  <div>
                    <div className="erow-name">{d.name}</div>
                    <div className="erow-sub">{d.bookable ? "Shown on booking menu" : "Hidden / auto-derived"}</div>
                  </div>
                </div>
                <div className="erow-fields">
                  <div className="ef">
                    <label>Group</label>
                    <select className="ctrl" defaultValue={d.group} onChange={(e) => saveField(d, { group: e.target.value as DishGroup })}>
                      {DISH_GROUPS.map((x) => <option key={x} value={x}>{GROUP_LABEL[x]}</option>)}
                    </select>
                  </div>
                  <div className="ef toggle">
                    <label>Bookable</label>
                    <label className="switch">
                      <input type="checkbox" defaultChecked={d.bookable} onChange={(e) => saveField(d, { bookable: e.target.checked })} />
                      <span className="sl"></span>
                    </label>
                  </div>
                  <div className="ef narrow">
                    <label>Qty / plate</label>
                    <div className="inp-unit">
                      <input className="ctrl" defaultValue={d.qtyPerPlate} onChange={(e) => set(d.id, "qtyPerPlate", e.target.value)} />
                      <span className="u">{d.unit === "NOS" ? "nos" : "g"}</span>
                    </div>
                  </div>
                  <div className="ef narrow">
                    <label>Packing factor</label>
                    <input className="ctrl" defaultValue={d.packingFactor} onChange={(e) => set(d.id, "packingFactor", e.target.value)} />
                  </div>
                  <div className="ef narrow">
                    <label>Rate / plate</label>
                    <div className="inp-unit">
                      <span className="u pre">₹</span>
                      <input className="ctrl" defaultValue={d.ratePerPlate ?? ""} placeholder="default"
                        onChange={(e) => set(d.id, "ratePerPlate", e.target.value)} />
                    </div>
                  </div>
                  <div className="ef narrow">
                    <label>Vessel kg</label>
                    <input className="ctrl" defaultValue={d.packingVesselKg ?? ""} placeholder="—" onChange={(e) => set(d.id, "packingVesselKg", e.target.value)} />
                  </div>
                </div>
                <div className="erow-action">
                  <button className={`btn sm ${savingId === d.id ? "loading" : ""}`} onClick={() => save(d)} disabled={!dirty(d.id) || savingId === d.id}>
                    <i className="ti ti-device-floppy" aria-hidden="true"></i> Save
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {adding && <AddDishModal onClose={() => setAdding(false)}
        onSaved={(name) => { toast(`Added ${name}`); reload(); }} />}
    </div>
  );
}

function AddDishModal({ onClose, onSaved }: { onClose: () => void; onSaved: (name: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: "", group: "ITEM1" as DishGroup, unit: "G" as "NOS" | "G", qtyPerPlate: "", packingFactor: "", packingVesselKg: "" });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  async function add() {
    setBusy(true);
    try {
      await api.addDish({
        name: f.name.trim(), group: f.group, unit: f.unit,
        qtyPerPlate: f.qtyPerPlate ? Number(f.qtyPerPlate) : undefined,
        packingFactor: f.packingFactor ? Number(f.packingFactor) : undefined,
        packingVesselKg: f.packingVesselKg ? Number(f.packingVesselKg) : undefined,
      });
      onSaved(f.name.trim()); onClose();
    } catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Add dish" subtitle="Add a new item to the catalog." onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${busy ? "loading" : ""}`} disabled={!f.name.trim() || busy} onClick={add}>Add dish</button>
      </>}>
      <div className="form-grid">
        <Field label="Dish name" full><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Coconut Rice" /></Field>
        <Field label="Group">
          <select value={f.group} onChange={(e) => set("group", e.target.value)}>
            {DISH_GROUPS.map((g) => <option key={g} value={g}>{GROUP_LABEL[g]}</option>)}
          </select>
        </Field>
        <Field label="Unit">
          <select value={f.unit} onChange={(e) => set("unit", e.target.value)}>
            <option value="G">Grams (g)</option>
            <option value="NOS">Count (nos)</option>
          </select>
        </Field>
        <Field label="Qty / plate"><input value={f.qtyPerPlate} onChange={(e) => set("qtyPerPlate", e.target.value)} placeholder="e.g. 150" /></Field>
        <Field label="Packing factor"><input value={f.packingFactor} onChange={(e) => set("packingFactor", e.target.value)} placeholder="e.g. 150" /></Field>
        <Field label="Vessel kg" full><input value={f.packingVesselKg} onChange={(e) => set("packingVesselKg", e.target.value)} placeholder="blank for counted items" /></Field>
      </div>
    </Modal>
  );
}

// ---------------- UNITS ----------------
export function Units() {
  const { data, error, loading, reload } = useAsync(() => api.units());
  const toast = useToast();
  const [adding, setAdding] = useState(false);

  async function saveMembers(u: Unit, value: string) {
    try { await api.saveUnit(u.id, { memberCount: Number(value) || 0 }); toast(`Saved ${u.name}`); }
    catch (e: any) { toast(e.message, "err"); }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">{error}</p>;
  return (
    <div>
      <div className="between page-head">
        <div>
          <h1>Kitchens / units</h1>
          <p className="muted">The kitchen sections orders are auto-assigned across.</p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>
          <i className="ti ti-plus" aria-hidden="true"></i> Add Kitchen
        </button>
      </div>

      <div className="card editor-group">
        {data!.map((u) => (
          <div className="erow" key={u.id}>
            <div className="erow-main">
              <span className="dish-ic"><i className="ti ti-building-community" aria-hidden="true"></i></span>
              <div>
                <div className="erow-name">{u.name} {u.isOptional && <span className="pill gray">optional</span>}</div>
                <div className="erow-sub">Kitchen section</div>
              </div>
            </div>
            <div className="erow-fields">
              <div className="ef narrow">
                <label>Members</label>
                <input className="ctrl" defaultValue={u.memberCount} onBlur={(e) => saveMembers(u, e.target.value)} />
              </div>
            </div>
          </div>
        ))}
      </div>

      {adding && <AddUnitModal onClose={() => setAdding(false)} onSaved={(n) => { toast(`Added ${n}`); reload(); }} />}
    </div>
  );
}

function AddUnitModal({ onClose, onSaved }: { onClose: () => void; onSaved: (n: string) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [members, setMembers] = useState("");
  async function add() {
    setBusy(true);
    try { await api.addUnit({ name: name.trim(), memberCount: Number(members) || 0 }); onSaved(name.trim()); onClose(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(false); }
  }
  return (
    <Modal title="Add kitchen" subtitle="Create a new kitchen section." onClose={onClose} width={420}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${busy ? "loading" : ""}`} disabled={!name.trim() || busy} onClick={add}>Add kitchen</button>
      </>}>
      <Field label="Kitchen name" full><input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Unit-5" /></Field>
      <div style={{ height: 12 }} />
      <Field label="Members (optional)" full><input value={members} onChange={(e) => setMembers(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" /></Field>
    </Modal>
  );
}

// ---------------- USERS ----------------
const ROLES: Role[] = ["BOOKING", "KITCHEN_ADMIN", "VERIFICATION_ADMIN", "SUPER_ADMIN"];
const ROLE_LABEL: Record<string, string> = {
  BOOKING: "Booking", KITCHEN_ADMIN: "Kitchen", VERIFICATION_ADMIN: "Verification", SUPER_ADMIN: "Super Admin",
};
const ROLE_PILL: Record<string, string> = {
  BOOKING: "", KITCHEN_ADMIN: "green", VERIFICATION_ADMIN: "gray", SUPER_ADMIN: "red",
};
const emptyNew = (): NewUser => ({ role: "BOOKING", username: "", password: "", name: "", email: "", phone: "", iskconRole: "", centre: "", address: "" });

export function Users() {
  const [showArchived, setShowArchived] = useState(false);
  const { data, error, loading, reload } = useAsync(() => api.users(showArchived), [showArchived]);
  const toast = useToast();
  const [filter, setFilter] = useState<string>("ALL");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);

  // modal state
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [deleting, setDeleting] = useState<User | null>(null);

  async function run(fn: () => Promise<any>, ok: string, after?: () => void) {
    setBusy(true);
    try { await fn(); toast(ok); reload(); after?.(); }
    catch (e: any) { toast(e.message, "err"); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">{error}</p>;

  const ql = q.trim().toLowerCase();
  const list = data!
    .filter((u) => filter === "ALL" || u.role === filter)
    .filter((u) => !ql || [u.name, u.username, u.email, u.phone, u.iskconRole, u.centre]
      .some((v) => (v ?? "").toLowerCase().includes(ql)));

  return (
    <div>
      <div className="between page-head">
        <div>
          <h1>Users</h1>
          <p className="muted">Create accounts, manage roles, reset passwords and archive members.</p>
        </div>
        <button className="btn" onClick={() => setAdding(true)}>
          <i className="ti ti-user-plus" aria-hidden="true"></i> Add User
        </button>
      </div>

      <div className="toolbar">
        <div className="search">
          <i className="ti ti-search" aria-hidden="true"></i>
          <input placeholder="Search name, username, email…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="segmented">
          {["ALL", ...ROLES].map((r) => (
            <button key={r} className={filter === r ? "on" : ""} onClick={() => setFilter(r)}>
              {r === "ALL" ? "All" : ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <button className={`btn sm ${showArchived ? "" : "ghost"}`} onClick={() => setShowArchived((s) => !s)}>
          <i className="ti ti-archive" aria-hidden="true"></i> {showArchived ? "Showing archived" : "Show archived"}
        </button>
      </div>

      {list.length === 0 ? (
        <div className="card"><div className="empty"><i className="ti ti-users" aria-hidden="true"></i>No users match.</div></div>
      ) : (
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Member</th><th>Role</th><th>Contact</th><th>Status</th><th style={{ textAlign: "right" }}>Actions</th></tr>
            </thead>
            <tbody>
              {list.map((u) => {
                const archived = !!u.deletedAt;
                return (
                  <tr key={u.id} style={archived ? { opacity: .6 } : undefined}>
                    <td>
                      <div className="row" style={{ gap: 11, flexWrap: "nowrap" }}>
                        {u.photo ? <img className="avatar sm" src={u.photo} alt="" /> : <span className="avatar sm">{u.name.slice(0, 1)}</span>}
                        <div>
                          <div style={{ fontWeight: 700 }}>{u.name}</div>
                          <div className="muted" style={{ fontSize: 12.5 }}>@{u.username}{u.iskconRole ? ` · ${u.iskconRole}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td><span className={`pill ${ROLE_PILL[u.role] || ""}`}>{ROLE_LABEL[u.role]}</span></td>
                    <td style={{ fontSize: 13 }}>
                      <div>{u.phone || <span className="muted">—</span>}</div>
                      <div className="muted" style={{ fontSize: 12.5 }}>{u.email || ""}</div>
                    </td>
                    <td>
                      {archived ? <span className="pill red">archived</span>
                        : <span className="row" style={{ gap: 7, flexWrap: "nowrap" }}><span className={`dot ${u.active ? "on" : "off"}`}></span>{u.active ? "Active" : "Inactive"}</span>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                        {archived ? (
                          <button className="btn accent sm" disabled={busy}
                            onClick={() => run(() => api.restoreUser(u.id), `Restored ${u.name}`)}>
                            <i className="ti ti-restore" aria-hidden="true"></i> Restore
                          </button>
                        ) : (
                          <>
                            <button className="iconbtn" title="Edit" onClick={() => setEditing(u)}><i className="ti ti-edit"></i></button>
                            <button className="iconbtn" title="Reset password" onClick={() => setResetting(u)}><i className="ti ti-key"></i></button>
                            <button className="iconbtn" title={u.active ? "Deactivate" : "Activate"} disabled={busy}
                              onClick={() => run(() => api.setUserActive(u.id, !u.active), `${u.name} ${u.active ? "deactivated" : "activated"}`)}>
                              <i className={`ti ${u.active ? "ti-user-off" : "ti-user-check"}`}></i>
                            </button>
                            <button className="iconbtn" title="Archive" onClick={() => setDeleting(u)} style={{ color: "var(--danger)" }}><i className="ti ti-trash"></i></button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddUserModal busy={busy} onClose={() => setAdding(false)}
        onSave={(body, done) => run(() => api.createUser(body), `Created ${body.name}`, done)} />}
      {editing && <EditUserModal user={editing} busy={busy} onClose={() => setEditing(null)}
        onSave={(body, done) => run(() => api.saveUser(editing.id, body), `Saved ${editing.name}`, done)} />}
      {resetting && <ResetPasswordModal user={resetting} busy={busy} onClose={() => setResetting(null)}
        onSave={(pw, done) => run(() => api.resetPassword(resetting.id, pw), `Password updated for ${resetting.name}`, done)} />}
      {deleting && <ConfirmModal
        title={`Archive ${deleting.name}?`}
        body="They'll be signed out and hidden from active lists. Order history is kept, and you can restore them anytime from “Show archived”."
        confirmLabel="Archive user" busy={busy} onClose={() => setDeleting(null)}
        onConfirm={(done) => run(() => api.deleteUser(deleting.id), `${deleting.name} archived`, done)} />}
    </div>
  );
}

function AddUserModal({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (b: NewUser, done: () => void) => void }) {
  const [f, setF] = useState<NewUser>(emptyNew());
  const set = (k: keyof NewUser, v: string) => setF((s) => ({ ...s, [k]: v }));
  const valid = f.name.trim() && f.username.trim() && f.password.length >= 6 && f.role;
  return (
    <Modal title="Add user" subtitle="Create an account and share the temporary password." onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${busy ? "loading" : ""}`} disabled={!valid || busy} onClick={() => onSave(f, onClose)}>Create user</button>
      </>}>
      <div className="form-grid">
        <Field label="Full name" full><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Radha Mohan Das" /></Field>
        <Field label="Role">
          <select value={f.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <Field label="Username"><input value={f.username} onChange={(e) => set("username", e.target.value)} placeholder="login id" /></Field>
        <Field label="Temporary password" full>
          <input value={f.password} onChange={(e) => set("password", e.target.value)} placeholder="min 6 characters" />
        </Field>
        <Field label="Phone"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} placeholder="optional" /></Field>
        <Field label="Email"><input value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="optional" /></Field>
        <Field label="ISKCON role"><input value={f.iskconRole} onChange={(e) => set("iskconRole", e.target.value)} placeholder="optional" /></Field>
        <Field label="Centre / org"><input value={f.centre} onChange={(e) => set("centre", e.target.value)} placeholder="optional" /></Field>
        <Field label="Address" full><input value={f.address} onChange={(e) => set("address", e.target.value)} placeholder="optional" /></Field>
      </div>
      {f.password.length > 0 && f.password.length < 6 && <p className="err" style={{ fontSize: 13 }}>Password must be at least 6 characters.</p>}
    </Modal>
  );
}

function EditUserModal({ user, busy, onClose, onSave }: { user: User; busy: boolean; onClose: () => void; onSave: (b: any, done: () => void) => void }) {
  const [f, setF] = useState({
    name: user.name, role: user.role as string, phone: user.phone ?? "", email: user.email ?? "",
    iskconRole: user.iskconRole ?? "", centre: user.centre ?? "", address: user.address ?? "",
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title={`Edit ${user.name}`} subtitle={`@${user.username}`} onClose={onClose}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${busy ? "loading" : ""}`} disabled={!f.name.trim() || busy} onClick={() => onSave(f, onClose)}>Save changes</button>
      </>}>
      <div className="form-grid">
        <Field label="Full name" full><input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Role">
          <select value={f.role} onChange={(e) => set("role", e.target.value)}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
        </Field>
        <Field label="Phone"><input value={f.phone} onChange={(e) => set("phone", e.target.value)} /></Field>
        <Field label="Email" full><input value={f.email} onChange={(e) => set("email", e.target.value)} /></Field>
        <Field label="ISKCON role"><input value={f.iskconRole} onChange={(e) => set("iskconRole", e.target.value)} /></Field>
        <Field label="Centre / org"><input value={f.centre} onChange={(e) => set("centre", e.target.value)} /></Field>
        <Field label="Address" full><input value={f.address} onChange={(e) => set("address", e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ResetPasswordModal({ user, busy, onClose, onSave }: { user: User; busy: boolean; onClose: () => void; onSave: (pw: string, done: () => void) => void }) {
  const [pw, setPw] = useState("");
  return (
    <Modal title="Reset password" subtitle={`Set a new password for ${user.name}`} onClose={onClose} width={420}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn ${busy ? "loading" : ""}`} disabled={pw.length < 6 || busy} onClick={() => onSave(pw, onClose)}>Update password</button>
      </>}>
      <Field label="New password" full><input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="min 6 characters" /></Field>
      <p className="muted" style={{ marginTop: 10 }}>Share this with the member. They'll use it to sign in (it won't be shown again).</p>
    </Modal>
  );
}

function ConfirmModal({ title, body, confirmLabel, busy, onClose, onConfirm }: {
  title: string; body: string; confirmLabel: string; busy: boolean; onClose: () => void; onConfirm: (done: () => void) => void;
}) {
  return (
    <Modal title={title} onClose={onClose} width={420}
      footer={<>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className={`btn danger ${busy ? "loading" : ""}`} disabled={busy} onClick={() => onConfirm(onClose)}>{confirmLabel}</button>
      </>}>
      <p style={{ margin: 0, color: "var(--text-2)", lineHeight: 1.55 }}>{body}</p>
    </Modal>
  );
}

// ---------------- DASHBOARD ----------------
export function Dashboard() {
  const { data, error, loading } = useAsync(() => api.dashboard());
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">{error}</p>;
  const d = data!;
  const Cover = ({ label, s }: { label: string; s: { booked: number; total: number; plates: number } }) => (
    <div className="stat">
      <div className="l">{label}</div>
      <div className="n">{s.booked}/{s.total}</div>
      <div className="s">{s.plates} plates · kitchens booked</div>
      <div className="progress"><div style={{ width: `${s.total ? (s.booked / s.total) * 100 : 0}%` }} /></div>
    </div>
  );
  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">Tomorrow's booking progress and today's activity.</p>
      <div className="stats-grid">
        <Cover label="Tomorrow · Tiffin" s={d.tomorrow.breakfast} />
        <Cover label="Tomorrow · Dinner" s={d.tomorrow.dinner} />
        <div className={`stat ${d.pendingVerifications ? "hot" : ""}`}>
          <div className="l">Pending verifications</div>
          <div className="n">{d.pendingVerifications}</div>
          <div className="s">awaiting approval</div>
        </div>
        <div className="stat">
          <div className="l">Today · Lunch</div>
          <div className="n">{d.today.lunch.plates}</div>
          <div className="s">{d.today.lunch.orders} orders</div>
        </div>
        <div className="stat"><div className="l">Registered users</div><div className="n">{d.usersCount}</div></div>
        <div className="stat"><div className="l">Bookable dishes</div><div className="n">{d.dishesCount}</div></div>
      </div>
      <div className="card">
        <div className="section-title">Recent activity</div>
        <div className="tablewrap" style={{ marginTop: 8 }}>
          <table>
            <thead><tr><th>Kitchen</th><th>Meal</th><th>Plates</th><th>Status</th><th>For</th></tr></thead>
            <tbody>
              {d.recent.map((o) => (
                <tr key={o.id}>
                  <td style={{ fontWeight: 600 }}>{o.unit}</td>
                  <td>{o.session}{o.isEmergency ? " ⚡" : ""}</td>
                  <td>{o.plates}</td>
                  <td><span className={`badge b-${o.status}`}>{o.status}</span></td>
                  <td>{new Date(o.date).toLocaleDateString()}</td>
                </tr>
              ))}
              {d.recent.length === 0 && <tr><td colSpan={5} className="muted">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ---------------- REPORTS ----------------
export function Reports() {
  const todayStr = ymd(today());
  const weekAgo = (() => { const d = today(); d.setDate(d.getDate() - 7); return ymd(d); })();
  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(todayStr);
  const { data, error, loading } = useAsync(() => api.report(from, to), [from, to]);
  return (
    <div>
      <h1>Reports &amp; Analytics</h1>
      <div className="toolbar">
        <span className="muted">From</span>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: "auto" }} />
        <span className="muted">To</span>
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: "auto" }} />
      </div>
      {loading && <p className="muted">Loading…</p>}
      {error && <p className="err">{error}</p>}
      {data && (
        <>
          <div className="stats-grid">
            <div className="stat"><div className="l">Verified meals</div><div className="n">{data.meals}</div></div>
            <div className="stat"><div className="l">Plates consumed</div><div className="n">{data.consumed}</div></div>
            <div className="stat hot"><div className="l">Waste %</div><div className="n">{data.wastePct}%</div><div className="s">{data.leftover} of {data.ordered} plates</div></div>
            <div className="stat"><div className="l">Avg taste / quality</div><div className="n">{data.avgTaste} / {data.avgQuality}</div><div className="s">out of 5</div></div>
          </div>
          <div className="card">
            <div className="section-title">By kitchen section</div>
            <div className="tablewrap" style={{ marginTop: 8 }}>
              <table>
                <thead><tr><th>Section</th><th>Meals</th><th>Ordered</th><th>Consumed</th><th>Leftover</th><th>Waste %</th></tr></thead>
                <tbody>
                  {data.perUnit.map((u) => (
                    <tr key={u.unit}>
                      <td style={{ fontWeight: 600 }}>{u.unit}</td>
                      <td>{u.meals}</td><td>{u.ordered}</td><td>{u.consumed}</td><td>{u.leftover}</td><td>{u.wastePct}%</td>
                    </tr>
                  ))}
                  {data.perUnit.length === 0 && <tr><td colSpan={6} className="muted">No verified meals in this range.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------- SETTINGS ----------------
export function Settings() {
  const { data, error, loading, reload } = useAsync(() => api.settings());
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");
  const FIELDS: [string, string, string, string?][] = [
    ["org_name", "Organization name", "Akshaya Patra Kitchen"],
    ["lunch_deadline", "Lunch booking cutoff (HH:MM)", "11:00"],
    [
      "ratePerPlate",
      "Default rate per plate (₹)",
      "0",
      "Charged for every consumed plate whose dish has no rate of its own. Changing it affects meals verified from now on — amounts already approved are frozen.",
    ],
  ];
  async function save(key: string) {
    try { await api.saveSetting(key, edits[key] ?? ""); setMsg("Saved " + key); reload(); }
    catch (e: any) { setMsg(e.message); }
  }
  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">{error}</p>;
  return (
    <div>
      <h1>Settings</h1>
      <div className="card">
        <div className="section-title">Organization</div>
        {FIELDS.map(([key, label, ph, help]) => (
          <div key={key} style={{ marginTop: 14 }}>
            <label className="lab">{label}</label>
            <div className="row">
              <input defaultValue={data![key] ?? ""} placeholder={ph}
                onChange={(e) => setEdits((s) => ({ ...s, [key]: e.target.value }))} style={{ maxWidth: 320 }} />
              <button className="btn sm" onClick={() => save(key)} disabled={edits[key] === undefined}>Save</button>
            </div>
            {help && <p className="muted" style={{ margin: "6px 0 0", fontSize: 12.5, maxWidth: 560 }}>{help}</p>}
          </div>
        ))}
        {msg && <div className="ok">{msg}</div>}
      </div>
      <div className="card">
        <div className="section-title">Catalog & rules</div>
        <p className="muted">Dishes, packing factors, per-dish rates and vessel sizes are managed under
          the <b>Dishes</b> and <b>Vessels</b> tabs. To use your own logo, drop <code>logo.png</code> into
          the web app's public folder.</p>
      </div>
    </div>
  );
}

// ---------------- VESSELS ----------------
export function Vessels() {
  const { data, error, loading, reload } = useAsync(() => api.vessels());
  const toast = useToast();

  async function add(session: "MORNING" | "EVENING", size: string) {
    if (!size) return;
    try { await api.addVessel({ session, size: Number(size) }); toast(`Added ${size}`); reload(); }
    catch (e: any) { toast(e.message, "err"); }
  }
  async function del(v: Vessel) {
    try { await api.delVessel(v.id); toast(`Removed ${v.size}`); reload(); }
    catch (e: any) { toast(e.message, "err"); }
  }

  if (loading) return <p className="muted">Loading…</p>;
  if (error) return <p className="err">{error}</p>;
  const groups: [string, "MORNING" | "EVENING", string][] = [
    ["Morning", "MORNING", "ti-sun"],
    ["Evening", "EVENING", "ti-moon"],
  ];
  return (
    <div>
      <div className="page-head">
        <h1>Vessel sizes</h1>
        <p className="muted">Plate-count vessels used on the packing sheet (idly / wada).</p>
      </div>
      <div className="grid2">
        {groups.map(([label, key, icon]) => {
          const list = data!.filter((v) => v.session === key);
          return <VesselCard key={key} label={label} icon={icon} list={list} onAdd={(s) => add(key, s)} onDel={del} />;
        })}
      </div>
    </div>
  );
}

function VesselCard({ label, icon, list, onAdd, onDel }: {
  label: string; icon: string; list: Vessel[]; onAdd: (size: string) => void; onDel: (v: Vessel) => void;
}) {
  const [size, setSize] = useState("");
  return (
    <div className="card">
      <div className="eg-head">
        <span className="eg-badge"><i className={`ti ${icon}`} aria-hidden="true"></i> {label}</span>
      </div>
      <div className="chiplist">
        {list.length === 0 && <span className="muted">No sizes yet.</span>}
        {list.map((v) => (
          <span className="chip" key={v.id}>{v.size}<button className="x" onClick={() => onDel(v)} aria-label="Remove">×</button></span>
        ))}
      </div>
      <div className="row" style={{ marginTop: 14 }}>
        <input placeholder="Add size" value={size} onChange={(e) => setSize(e.target.value.replace(/[^0-9]/g, ""))} style={{ maxWidth: 140 }} />
        <button className="btn sm" disabled={!size} onClick={() => { onAdd(size); setSize(""); }}>
          <i className="ti ti-plus" aria-hidden="true"></i> Add
        </button>
      </div>
    </div>
  );
}

// ---------------- ORDERS ----------------

// NOTE: the old admin app had its own read-only Orders table and a bare Packing
// download button. Both are superseded by the kitchen sections (./kitchen and
// ./packing), which a Super Admin can also see, so they were dropped in the
// merge rather than kept as a second, weaker copy.
