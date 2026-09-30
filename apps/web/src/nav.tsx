// The whole app's navigation, in one table.
//
// This is what replaced four separate apps. Each section declares which roles
// may see it; the shell filters this list by the signed-in user's role. Adding
// a screen means adding one row here — nothing else in the shell changes.
//
// IMPORTANT: this list decides what is *shown*, not what is *allowed*. Access
// is enforced by the API (apps/api/src/guard.ts), which checks the role on
// every request. Hiding a nav item is a convenience, never a security control.

import type { ComponentType } from "react";
import type { Role } from "./api";
import { NewBooking, MyBookings, CloseOut } from "./sections/booking";
import { KitchenOrders } from "./sections/kitchen";
import Packing from "./sections/packing";
import Menu from "./sections/menu";
import { Verify, Payments } from "./sections/verification";
import { Dashboard, Dishes, Reports, Settings, Units, Users, Vessels } from "./sections/admin";

/** Every role that can reach a given area. SUPER_ADMIN sees everything. */
const ALL: Role[] = ["BOOKING", "KITCHEN_ADMIN", "VERIFICATION_ADMIN", "SUPER_ADMIN"];

export interface NavItem {
  /** Stable key — also the value the notification "section" field uses. */
  key: string;
  label: string;
  icon: string;
  roles: Role[];
  /** Heading this item sits under in the sidebar. */
  group: string;
  /** Show the shared cooking-date picker above this section. */
  needsDate?: boolean;
  component: ComponentType<any>;
}

export const NAV: NavItem[] = [
  // --- Booking ---
  { key: "new",       label: "New Booking",   icon: "ti ti-tools-kitchen-2",     group: "Booking",      roles: ["BOOKING", "SUPER_ADMIN"], component: NewBooking },
  { key: "mine",      label: "My Bookings",   icon: "ti ti-clipboard-list",      group: "Booking",      roles: ["BOOKING", "SUPER_ADMIN"], component: MyBookings },
  { key: "close",     label: "Close a Meal",  icon: "ti ti-checkup-list",        group: "Booking",      roles: ["BOOKING", "SUPER_ADMIN"], component: CloseOut },

  // --- Kitchen ---
  { key: "orders",    label: "Orders",        icon: "ti ti-clipboard-list",      group: "Kitchen",      roles: ["KITCHEN_ADMIN", "SUPER_ADMIN"], needsDate: true, component: KitchenOrders },
  { key: "packing",   label: "Packing Sheet", icon: "ti ti-file-spreadsheet",    group: "Kitchen",      roles: ["KITCHEN_ADMIN", "SUPER_ADMIN"], needsDate: true, component: Packing },
  { key: "menu",      label: "Menu",          icon: "ti ti-book",                group: "Kitchen",      roles: ["KITCHEN_ADMIN", "SUPER_ADMIN"], needsDate: true, component: Menu },

  // --- Verification ---
  { key: "verify",    label: "To verify",     icon: "ti ti-checkup-list",        group: "Verification", roles: ["VERIFICATION_ADMIN", "SUPER_ADMIN"], component: Verify },
  { key: "payments",  label: "Payments",      icon: "ti ti-receipt",             group: "Verification", roles: ["VERIFICATION_ADMIN", "SUPER_ADMIN"], component: Payments },

  // --- Administration (Super Admin only) ---
  { key: "dashboard", label: "Dashboard",     icon: "ti ti-layout-dashboard",    group: "Administration", roles: ["SUPER_ADMIN"], component: Dashboard },
  { key: "reports",   label: "Reports",       icon: "ti ti-chart-bar",           group: "Administration", roles: ["SUPER_ADMIN"], component: Reports },
  { key: "dishes",    label: "Dishes",        icon: "ti ti-soup",                group: "Administration", roles: ["SUPER_ADMIN"], component: Dishes },
  { key: "vessels",   label: "Vessels",       icon: "ti ti-bowl",                group: "Administration", roles: ["SUPER_ADMIN"], component: Vessels },
  { key: "units",     label: "Routes",        icon: "ti ti-building-community",  group: "Administration", roles: ["SUPER_ADMIN"], component: Units },
  { key: "users",     label: "Users",         icon: "ti ti-users",               group: "Administration", roles: ["SUPER_ADMIN"], component: Users },
  { key: "settings",  label: "Settings",      icon: "ti ti-settings",            group: "Administration", roles: ["SUPER_ADMIN"], component: Settings },
];

export const itemsFor = (role: Role) => NAV.filter((i) => i.roles.includes(role));

/** Where each role lands after signing in — the thing they came to do. */
const LANDING: Record<Role, string> = {
  BOOKING: "new",
  KITCHEN_ADMIN: "orders",
  VERIFICATION_ADMIN: "verify",
  SUPER_ADMIN: "dashboard",
};

export function landingFor(role: Role): string {
  const allowed = itemsFor(role);
  return allowed.some((i) => i.key === LANDING[role]) ? LANDING[role] : allowed[0]?.key ?? "";
}

/** What each role's job is called, shown under their name in the header. */
export const ROLE_LABEL: Record<Role, string> = {
  BOOKING: "Booking",
  KITCHEN_ADMIN: "Kitchen",
  VERIFICATION_ADMIN: "Verification",
  SUPER_ADMIN: "Super Admin",
};

/** Groups in sidebar order, for whatever this role can actually see. */
export function groupsFor(role: Role): { group: string; items: NavItem[] }[] {
  const out: { group: string; items: NavItem[] }[] = [];
  for (const item of itemsFor(role)) {
    const last = out[out.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else out.push({ group: item.group, items: [item] });
  }
  return out;
}

export { ALL };
