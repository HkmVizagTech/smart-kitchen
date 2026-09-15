// In the native app / a deployed PWA, set VITE_API_URL to the public API URL
// (e.g. https://your-api.up.railway.app). On the dev Mac it falls back to the
// machine that served the page, on port 4000.
const API_BASE =
  (import.meta as any).env?.VITE_API_URL?.replace(/\/$/, "") ||
  `http://${window.location.hostname}:4000`;
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
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

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

export type DishGroup = "ITEM1" | "ITEM2" | "ITEM3";
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
}
export interface Unit {
  id: number;
  name: string;
  memberCount: number;
  isOptional: boolean;
}
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
export interface Vessel {
  id: number;
  session: "MORNING" | "EVENING";
  size: number;
}
export interface OrderItem {
  id: number;
  dishId: number;
  plates: number;
  dish: { id: number; name: string; group: DishGroup; unit: "NOS" | "G" };
}
export interface Order {
  id: number;
  unitId: number;
  date: string;
  session: string;
  isEmergency: boolean;
  peopleCount: number | null;
  totalPlates: number | null;
  status: string;
  unit: { name: string };
  items: OrderItem[];
}

export const API_BASE_URL = API_BASE;

export interface Notif { id: number; type: string; title: string; body: string; section: string; orderId: number | null; read: boolean; createdAt: string; }
export interface NotifSummary { unread: number; sections: Record<string, number>; }

export const api = {
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

  dishes: () => req<Dish[]>("/admin/dishes"),
  saveDish: (
    id: number,
    body: Partial<
      Pick<Dish, "group" | "bookable" | "qtyPerPlate" | "unit" | "packingFactor" | "packingVesselKg">
    >,
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
  saveUser: (id: number, body: Partial<Pick<User, "name" | "role" | "email" | "phone" | "iskconRole" | "centre" | "address" | "active">>) =>
    req<User>(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  setUserActive: (id: number, active: boolean) =>
    req<User>(`/admin/users/${id}/active`, { method: "POST", body: JSON.stringify({ active }) }),
  resetPassword: (id: number, password: string) =>
    req<{ ok: true }>(`/admin/users/${id}/reset-password`, { method: "POST", body: JSON.stringify({ password }) }),
  deleteUser: (id: number) =>
    req<{ ok: true }>(`/admin/users/${id}`, { method: "DELETE" }),
  restoreUser: (id: number) =>
    req<User>(`/admin/users/${id}/restore`, { method: "POST" }),

  vessels: () => req<Vessel[]>("/admin/vessels"),
  addVessel: (body: { session: "MORNING" | "EVENING"; size: number }) =>
    req<Vessel>("/admin/vessels", { method: "POST", body: JSON.stringify(body) }),
  delVessel: (id: number) => req<unknown>(`/admin/vessels/${id}`, { method: "DELETE" }),

  orders: (date: string) => req<Order[]>(`/orders?date=${date}`),
  // A browser navigation cannot send an Authorization header, so the token
  // rides along as a query param. The API accepts it for this route only.
  packingExcelUrl: (date: string) =>
    `${API_BASE}/packing/excel?date=${date}&token=${encodeURIComponent(getToken() ?? "")}`,

  dashboard: () => req<Dashboard>("/admin/dashboard"),
  report: (from: string, to: string) => req<Report>(`/admin/report?from=${from}&to=${to}`),
  settings: () => req<Record<string, string>>("/admin/settings"),
  saveSetting: (key: string, value: string) =>
    req<unknown>("/admin/settings", { method: "PUT", body: JSON.stringify({ key, value }) }),
  notifications: () => req<Notif[]>("/notifications"),
  notifSummary: () => req<NotifSummary>("/notifications/summary"),
  markNotifRead: (id: number) => req<{ ok: true }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotifsRead: (section?: string) =>
    req<{ ok: true }>("/notifications/read-all", { method: "POST", body: JSON.stringify(section ? { section } : {}) }),
};
