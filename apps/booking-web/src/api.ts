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
  unitId: number | null;
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
export interface Dish {
  id: number;
  name: string;
  qtyPerPlate: number;
  unit: "NOS" | "G";
  accompaniment: boolean;
}
export interface BookingMenu {
  ITEM1: Dish[];
  ITEM2: Dish[];
  ITEM3: Dish[];
}
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
  needsCloseOut: boolean;
}
export interface Progress {
  total: number;
  booked: number;
  ready: boolean;
  units: { id: number; name: string; booked: boolean }[];
}

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
  bookingMenu: () => req<BookingMenu>("/booking-menu"),
  recentBookings: () => req<Booking[]>("/bookings/recent"),
  closeoutItems: (orderId: number) =>
    req<{ orderId: number; unit: string; session: string; items: { dishId: number; name: string; ordered: number }[] }>(
      `/orders/${orderId}/closeout-items`
    ),
  progress: (date: string, session: string) =>
    req<Progress>(`/booking/progress?date=${date}&session=${session}`),
  placeOrder: (body: Record<string, unknown>) =>
    req<{ id: number; assignedUnit: string; booked: number; total: number }>("/orders", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  submitConsumption: (body: Record<string, unknown>) =>
    req<unknown>("/orders/consumption", { method: "POST", body: JSON.stringify(body) }),
  notifications: () => req<Notif[]>("/notifications"),
  notifSummary: () => req<NotifSummary>("/notifications/summary"),
  markNotifRead: (id: number) => req<{ ok: true }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotifsRead: (section?: string) =>
    req<{ ok: true }>("/notifications/read-all", { method: "POST", body: JSON.stringify(section ? { section } : {}) }),
};
