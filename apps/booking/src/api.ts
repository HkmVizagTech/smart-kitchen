// API client. Resolves the base URL automatically:
//  - web: the host you opened the page from, port 4000
//  - phone via Expo Go: the Mac's LAN IP, port 4000
// Override with EXPO_PUBLIC_API_URL.
import Constants from "expo-constants";
import { Platform } from "react-native";

const API_PORT = 4000;

function resolveBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_API_URL;
  if (override) return override.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `http://${window.location.hostname}:${API_PORT}`;
  }
  const hostUri =
    Constants.expoConfig?.hostUri ??
    // @ts-ignore older field
    Constants.manifest?.debuggerHost ??
    "";
  const host = hostUri.split(":")[0];
  return host ? `http://${host}:${API_PORT}` : `http://localhost:${API_PORT}`;
}

export const API_BASE = resolveBaseUrl();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

// ---- types
export type Role = "BOOKING" | "KITCHEN_ADMIN" | "VERIFICATION_ADMIN" | "SUPER_ADMIN";
export interface LoginUser {
  id: number;
  name: string;
  role: Role;
  unit: { name: string } | null;
}
export interface AuthedUser {
  id: number;
  name: string;
  role: Role;
  unitId: number | null;
}
export interface Dish {
  id: number;
  name: string;
  qtyPerPlate: number;
  unit: "NOS" | "G";
}
export interface Item2Option {
  id: number;
  label: string;
  dishes: Dish[];
}
export interface MenuResponse {
  template: {
    item1Dishes: Dish[];
    item3Dishes: Dish[];
    defaultItem2: Item2Option | null;
  } | null;
  item2Options: Item2Option[];
}
export interface Booking {
  id: number;
  date: string;
  session: "BREAKFAST" | "LUNCH" | "DINNER";
  isEmergency: boolean;
  peopleCount: number | null;
  item2Label: string | null;
  status: string;
  hasConsumption: boolean;
  hasFeedback: boolean;
  consumptionStatus: string | null;
  needsCloseOut: boolean;
}

// ---- endpoints
export const api = {
  users: () => request<LoginUser[]>("/auth/users"),
  login: (userId: number, pin: string) =>
    request<{ token: string; user: AuthedUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ userId, pin }),
    }),
  menu: (day: string, session: string) =>
    request<MenuResponse>(`/menu?day=${day}&session=${session}`),
  myBookings: (unitId: number) => request<Booking[]>(`/units/${unitId}/orders`),
  placeOrder: (body: Record<string, unknown>) =>
    request<{ id: number }>("/orders", { method: "POST", body: JSON.stringify(body) }),
  submitConsumption: (body: {
    orderId: number;
    receivedQty: number;
    consumedQty: number;
    leftoverQty: number;
    notes?: string;
    taste: number;
    quality: number;
    remarks?: string;
  }) => request<unknown>("/orders/consumption", { method: "POST", body: JSON.stringify(body) }),
};
