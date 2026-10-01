// One API client for the whole app.
//
// This replaces four near-identical copies (booking / kitchen / verification /
// admin) that each carried their own duplicate of the auth types, the fetch
// helper and the notification calls. Methods are grouped by the role that may
// call them — the server enforces that, this grouping is just for reading.

const API_BASE =
  (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "") ||
  `http://${window.location.hostname}:4000`;

export const API_BASE_URL = API_BASE;

const TOKEN_KEY = "sk_token";
export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options,
  });
  const text = await res.text();
  // Not every failure arrives as JSON: a platform 502, a proxy error page or a
  // sleeping service all return HTML, and JSON.parse on that threw a
  // "Unexpected token <" that told the user nothing about what had happened.
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new Error("The server sent something unreadable. Try again.");
  }
  if (!res.ok) {
    // 401 means the token expired or was invalidated (e.g. AUTH_SECRET was
    // rotated). Drop it so the app falls back to the sign-in screen instead of
    // showing a wall of errors.
    if (res.status === 401) clearToken();
    if (res.status >= 500)
      throw new Error("The server had a problem with this. It has been logged — try again in a moment.");
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data as T;
}

// ------------------------------------------------------------------ identity
export type Role = "BOOKING" | "KITCHEN_ADMIN" | "VERIFICATION_ADMIN" | "SUPER_ADMIN";

export interface AuthedUser {
  id: number;
  name: string;
  role: Role;
  username?: string;
  email?: string | null;
  phone?: string | null;
  photo?: string | null;
  iskconRole?: string | null;
  centre?: string | null;
  address?: string | null;
  unitId?: number | null;
}

export interface SignupPayload {
  role: Role;
  username: string;
  password: string;
  name: string;
  email?: string;
  phone?: string;
  iskconRole?: string;
  centre?: string;
  address?: string;
  photo?: string;
}

// ------------------------------------------------------------------ catalogue
export type DishGroup = "ITEM1" | "ITEM2" | "ITEM3";

/** A dish as the admin screens edit it — includes the packing configuration. */
export interface Dish {
  id: number;
  name: string;
  group: DishGroup;
  bookable: boolean;
  sortOrder: number;
  qtyPerPlate: number;
  unit: "NOS" | "G";
  packingFactor: number;
  packingVesselKg: number | null;
  /** Rupees per consumed plate. Null means "use the default rate setting". */
  ratePerPlate: number | null;
}

/** A dish as the booking screen sees it — no packing config, but knows whether
 *  it is an accompaniment (derived server-side, never entered by the booker). */
export interface BookingDish {
  id: number;
  name: string;
  qtyPerPlate: number;
  unit: "NOS" | "G";
  accompaniment: boolean;
}

export interface BookingMenu {
  ITEM1: BookingDish[];
  ITEM2: BookingDish[];
  ITEM3: BookingDish[];
}

export interface Unit {
  id: number;
  name: string;
  memberCount: number;
  isOptional: boolean;
}

export interface Vessel {
  id: number;
  session: "MORNING" | "EVENING";
  size: number;
}

// ------------------------------------------------------------------ orders
export interface OrderItem {
  id: number;
  dishId: number;
  plates: number;
  dish: { id: number; name: string; group: string; unit: string };
}

export interface Order {
  id: number;
  unitId: number;
  date: string;
  session: "BREAKFAST" | "LUNCH" | "DINNER";
  isEmergency: boolean;
  peopleCount: number | null;
  totalPlates: number | null;
  status: string;
  unit: { name: string };
  items: OrderItem[];
}

/** An order as the booker's own list shows it (flattened, no ids on items). */
export interface Booking {
  id: number;
  unit: string;
  date: string;
  session: "BREAKFAST" | "LUNCH" | "DINNER";
  isEmergency: boolean;
  peopleCount: number | null;
  totalPlates: number | null;
  items: { dish: string; plates: number }[];
  status: string;
  consumptionStatus: string | null;
  /** Feedback is the last step, so this is what says a close-out is finished. */
  hasFeedback: boolean;
  /** Why verification sent the close-out back, if they did. */
  rejectionReason: string | null;
  /** Rupees owed once verified. */
  amount: number | null;
  /** The three plate counts as booked, for one-tap repeats. */
  slots: SlotCounts;
  needsCloseOut: boolean;
  /** Who placed it. The list covers every booker, not just the caller. */
  bookedById: number | null;
  /** True when the signed-in user is the one who placed it. */
  mine: boolean;
}

/** A dish as it appears on the day's menu. */
export interface MenuDish {
  id: number;
  name: string;
  qtyPerPlate: number;
  unit: "NOS" | "G";
}

/** One line of the booking form. `group` is null for lunch, which is booked
 *  as a headcount — those slots exist to be read, not ordered. */
export interface MenuSlot {
  group: "ITEM1" | "ITEM2" | "ITEM3" | null;
  sortOrder: number;
  dish: MenuDish;
  /** Added automatically at this line's plate count. */
  accompaniments: MenuDish[];
}

export interface DayMenu {
  date: string;
  session: string;
  slots: MenuSlot[];
}

export type SlotCounts = Partial<Record<"ITEM1" | "ITEM2" | "ITEM3", number>>;

// ------------------------------------------------------------------ menu editor
/** A dish as the editor picks from, including whether it is a side. */
export interface MenuOptionDish extends MenuDish {
  accompaniment: boolean;
  group: string;
}

/** A menu line as the editor reads it — carries its row id, unlike MenuSlot. */
export interface MenuAdminSlot {
  id: number;
  group: "ITEM1" | "ITEM2" | "ITEM3" | null;
  sortOrder: number;
  dish: MenuDish;
  accompaniments: MenuDish[];
}

export interface DayPlan {
  day: string;
  slots: MenuAdminSlot[];
}

/** What the editor sends back for one day. */
export interface MenuDraft {
  group: string | null;
  dishId: number;
  accompanimentIds: number[];
}

/** The close-out form's data. `consumed` carries anything already submitted,
 *  so a close-out that was sent back reopens with its previous numbers. */
export interface CloseoutItems {
  orderId: number;
  unit: string;
  session: string;
  date: string;
  /** Which of the two booker steps is open — the screen reads this directly. */
  stage: "CONSUMPTION" | "AWAITING_VERIFICATION" | "FEEDBACK" | "DONE";
  items: { dishId: number; name: string; ordered: number; consumed: number | null }[];
  previous: {
    status: string;
    notes: string | null;
    rejectionReason: string | null;
    taste: number | null;
    quality: number | null;
    remarks: string | null;
  } | null;
}

/** Whether this booker may open a new order for each meal, and what blocks it. */
export interface MealStatus {
  canOrder: boolean;
  blockedBy: { orderId: number; unit: string; date: string; needs: string[] } | null;
}
export type BookingStatus = Record<"BREAKFAST" | "LUNCH" | "DINNER", MealStatus>;

export interface Progress {
  total: number;
  booked: number;
  ready: boolean;
  units: { id: number; name: string; booked: boolean }[];
}

// ------------------------------------------------------------------ packing
export interface PackingCell {
  qty: number;
  vessels?: Record<number, number>;
  vesselCount?: number;
}
export interface PackingRow {
  unit: string;
  plates: Record<number, number>;
  totalPlates: number;
  cells: Record<string, PackingCell>;
}
export interface PackingSheet {
  session: string;
  vesselSession: string;
  vessels: number[];
  indentDishes: { id: number; name: string }[];
  dishOrder: { id: number; name: string; packingVesselKg: number | null }[];
  rows: PackingRow[];
}

// ------------------------------------------------------------------ verification
export interface Pending {
  orderId: number;
  unit: string;
  session: string;
  date: string;
  received: number;
  consumed: number;
  leftover: number;
  notes: string | null;
  items: { name: string; ordered: number; consumed: number; leftover: number; extra: number }[];
}

export interface Done {
  orderId: number;
  unit: string;
  session: string;
  date: string;
  consumed: number;
  verifiedAt: string | null;
  /** Rupees owed, frozen when the close-out was approved. */
  amount: number | null;
}

// ------------------------------------------------------------------ admin
export interface User {
  id: number;
  name: string;
  role: Role;
  username: string;
  email: string | null;
  phone: string | null;
  photo: string | null;
  iskconRole: string | null;
  centre: string | null;
  address: string | null;
  active: boolean;
  deletedAt: string | null;
  createdAt?: string;
}

export interface NewUser {
  role: Role;
  username: string;
  password: string;
  name: string;
  email?: string;
  phone?: string;
  iskconRole?: string;
  centre?: string;
  address?: string;
}

export interface DashStat { booked: number; total: number; plates: number; orders: number }

export interface Dashboard {
  tomorrow: { breakfast: DashStat; dinner: DashStat };
  today: { lunch: DashStat };
  pendingVerifications: number;
  usersCount: number;
  dishesCount: number;
  totalKitchens: number;
  recent: { id: number; unit: string; session: string; status: string; plates: number; date: string; createdAt: string; isEmergency: boolean }[];
}

export interface Report {
  meals: number; ordered: number; consumed: number; leftover: number;
  wastePct: number; avgTaste: number; avgQuality: number;
  perUnit: { unit: string; ordered: number; consumed: number; leftover: number; meals: number; wastePct: number }[];
}

// ------------------------------------------------------------------ notifications
export interface Notif {
  id: number; type: string; title: string; body: string;
  section: string; orderId: number | null; read: boolean; createdAt: string;
}
export interface NotifSummary { unread: number; sections: Record<string, number> }

// ------------------------------------------------------------------ the client
export const api = {
  // --- anyone ---
  login: (identifier: string, password: string) =>
    req<{ token: string; user: AuthedUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ identifier, password }),
    }),
  signup: (payload: SignupPayload) =>
    req<{ token: string; user: AuthedUser }>("/auth/signup", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  me: () => req<{ user: AuthedUser }>("/auth/me"),

  // --- any signed-in user ---
  notifications: () => req<Notif[]>("/notifications"),
  notifSummary: () => req<NotifSummary>("/notifications/summary"),
  markNotifRead: (id: number) => req<{ ok: true }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotifsRead: (section?: string) =>
    req<{ ok: true }>("/notifications/read-all", {
      method: "POST",
      body: JSON.stringify(section ? { section } : {}),
    }),
  orders: (date: string) => req<Order[]>(`/orders?date=${date}`),

  // --- BOOKING ---
  bookingMenu: () => req<BookingMenu>("/booking-menu"),
  /** What is on the menu for one date and meal. */
  menu: (date: string, session: string) =>
    req<DayMenu>(`/menu?date=${date}&session=${encodeURIComponent(session)}`),
  recentBookings: () => req<Booking[]>("/bookings/recent"),
  closeoutItems: (orderId: number) => req<CloseoutItems>(`/orders/${orderId}/closeout-items`),
  bookingStatus: () => req<BookingStatus>("/me/booking-status"),
  progress: (date: string, session: string) =>
    req<Progress>(`/booking/progress?date=${date}&session=${session}`),
  placeOrder: (body: Record<string, unknown>) =>
    req<{ id: number; assignedUnit: string; booked: number; total: number }>("/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitConsumption: (body: Record<string, unknown>) =>
    req<unknown>("/orders/consumption", { method: "POST", body: JSON.stringify(body) }),
  /** Step 2 — only accepted once the consumption has been verified. */
  submitFeedback: (body: { orderId: number; taste: number; quality: number; remarks?: string }) =>
    req<unknown>("/orders/feedback", { method: "POST", body: JSON.stringify(body) }),

  // --- KITCHEN_ADMIN ---
  setStatus: (id: number, status: string) =>
    req<Order>(`/orders/${id}/status`, { method: "POST", body: JSON.stringify({ status }) }),
  bulkStatus: (date: string, session: string, status: string) =>
    req<{ updated: number }>("/orders/status/bulk", {
      method: "POST",
      body: JSON.stringify({ date, session, status }),
    }),
  // --- MENU EDITOR (kitchen + super admin) ---
  menuOptions: () =>
    req<{ dishes: MenuOptionDish[]; days: string[]; groups: string[]; cycles: Record<string, number> }>(
      "/menu-admin/options"
    ),
  menuPlan: (session: string, week: number) =>
    req<{ session: string; week: number; days: DayPlan[] }>(`/menu-admin/plan?session=${session}&week=${week}`),
  menuDay: (date: string, session: string) =>
    req<{ date: string; session: string; overridden: boolean; booked: number; slots: MenuAdminSlot[] }>(
      `/menu-admin/day?date=${date}&session=${session}`
    ),
  saveMenuPlan: (body: { session: string; week: number; day: string; slots: MenuDraft[] }) =>
    req<{ ok: true }>("/menu-admin/plan", { method: "PUT", body: JSON.stringify(body) }),
  saveMenuDay: (body: { session: string; date: string; slots: MenuDraft[] }) =>
    req<{ ok: true }>("/menu-admin/day", { method: "PUT", body: JSON.stringify(body) }),
  clearMenuDay: (date: string, session: string) =>
    req<{ removed: number }>(`/menu-admin/day?date=${date}&session=${session}`, { method: "DELETE" }),

  packing: (date: string, session: "BREAKFAST" | "DINNER") =>
    req<{ ready: boolean; booked: number; total: number; missing: string[]; sheet: PackingSheet | null }>(
      `/packing/preview?date=${date}&session=${session}`
    ),
  // A browser navigation cannot send an Authorization header, so the token
  // rides along as a query param. The API accepts it for this route only.
  packingExcelUrl: (date: string, force = false) =>
    `${API_BASE}/packing/excel?date=${date}${force ? "&force=1" : ""}&token=${encodeURIComponent(getToken() ?? "")}`,

  // --- VERIFICATION_ADMIN ---
  pending: () => req<Pending[]>("/verification/pending"),
  done: () => req<Done[]>("/verification/done"),
  /** The verifier is taken from the signed-in session server-side. */
  /** Approving freezes the amount; returning requires a reason. */
  verify: (orderId: number, approve: boolean, reason?: string) =>
    req<{ ok: boolean; amount: number | null }>("/orders/verify", {
      method: "POST",
      body: JSON.stringify({ orderId, approve, reason }),
    }),

  // --- SUPER_ADMIN ---
  dishes: () => req<Dish[]>("/admin/dishes"),
  saveDish: (
    id: number,
    body: Partial<Pick<Dish, "group" | "bookable" | "qtyPerPlate" | "unit" | "packingFactor" | "packingVesselKg" | "ratePerPlate">>
  ) => req<Dish>(`/admin/dishes/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  addDish: (body: {
    name: string;
    group: DishGroup;
    qtyPerPlate?: number;
    unit?: "NOS" | "G";
    packingFactor?: number;
    packingVesselKg?: number | null;
  }) => req<Dish>("/admin/dishes", { method: "POST", body: JSON.stringify(body) }),

  units: () => req<Unit[]>("/admin/units"),
  saveUnit: (id: number, body: Partial<Unit>) =>
    req<Unit>(`/admin/units/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  addUnit: (body: { name: string; memberCount: number }) =>
    req<Unit>("/admin/units", { method: "POST", body: JSON.stringify(body) }),

  users: (includeDeleted = false) =>
    req<User[]>(`/admin/users${includeDeleted ? "?includeDeleted=1" : ""}`),
  createUser: (body: NewUser) =>
    req<User>("/admin/users", { method: "POST", body: JSON.stringify(body) }),
  saveUser: (
    id: number,
    body: Partial<Pick<User, "name" | "role" | "email" | "phone" | "iskconRole" | "centre" | "address" | "active">>
  ) => req<User>(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  setUserActive: (id: number, active: boolean) =>
    req<User>(`/admin/users/${id}/active`, { method: "POST", body: JSON.stringify({ active }) }),
  resetPassword: (id: number, password: string) =>
    req<{ ok: true }>(`/admin/users/${id}/reset-password`, {
      method: "POST",
      body: JSON.stringify({ password }),
    }),
  deleteUser: (id: number) => req<{ ok: true }>(`/admin/users/${id}`, { method: "DELETE" }),
  restoreUser: (id: number) => req<User>(`/admin/users/${id}/restore`, { method: "POST" }),

  vessels: () => req<Vessel[]>("/admin/vessels"),
  addVessel: (body: { session: "MORNING" | "EVENING"; size: number }) =>
    req<Vessel>("/admin/vessels", { method: "POST", body: JSON.stringify(body) }),
  delVessel: (id: number) => req<unknown>(`/admin/vessels/${id}`, { method: "DELETE" }),

  dashboard: () => req<Dashboard>("/admin/dashboard"),
  report: (from: string, to: string) => req<Report>(`/admin/report?from=${from}&to=${to}`),
  settings: () => req<Record<string, string>>("/admin/settings"),
  saveSetting: (key: string, value: string) =>
    req<unknown>("/admin/settings", { method: "PUT", body: JSON.stringify({ key, value }) }),
};
