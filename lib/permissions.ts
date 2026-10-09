// Role-based access model for the admin/PMS.
// Mirrors the Supabase RLS matrix (migration 002 + 016/017).
// Central source of truth for nav filtering, middleware guards and UI decisions.

export type StaffRole = "owner" | "manager" | "reception" | "watersports_staff" | "boat_crew";

export const STAFF_ROLES: StaffRole[] = ["owner", "manager", "reception", "watersports_staff", "boat_crew"];

export const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  reception: "Reception",
  watersports_staff: "Watersports Staff",
  boat_crew: "Boat Crew",
};

export type Module =
  | "dashboard"
  | "operations"
  | "trips"
  | "manifests"
  | "reception"
  | "boats"
  | "crew"
  | "equipment"
  | "bookings"
  | "reports"
  | "report"
  | "activities"
  | "customers"
  | "consents"
  | "rentals"
  | "payments"
  | "invoices"
  | "expenses"
  | "cash-register"
  | "incidents"
  | "staff"
  | "tasks"
  | "content"
  | "orientation";

// Approved role matrix (owner = super admin):
//   owner  → sees everything A–Z.
//   manager → everything except Staff management + public-site Content.
//   reception → front-desk + finance: ops board, trips, manifests, reception,
//               bookings, customers, consents, payments, cash register,
//               invoices, reports, tomorrow's report, tasks, incidents.
//   watersports_staff → beach ops: ops board, trips, manifests, boats,
//               equipment, rentals, bookings, tasks, incidents.
//   boat_crew → sea ops: ops board, trips, manifests, tasks, incidents.
const ADMIN_FINANCE: StaffRole[] = ["owner", "manager", "reception"];
const ADMIN: StaffRole[] = ["owner", "manager"];
const OWNER_ONLY: StaffRole[] = ["owner"];
const FIELD_OPS: StaffRole[] = ["owner", "manager", "reception", "watersports_staff"];
const OPS_WRITE: StaffRole[] = ["owner", "manager", "reception", "watersports_staff"];
const ALL_STAFF: StaffRole[] = ["owner", "manager", "reception", "watersports_staff", "boat_crew"];

const MODULE_ACCESS: Record<Module, StaffRole[]> = {
  dashboard: ALL_STAFF,
  operations: ALL_STAFF,
  trips: ALL_STAFF,
  manifests: ALL_STAFF,
  reception: FIELD_OPS,
  boats: FIELD_OPS,
  crew: FIELD_OPS,
  equipment: OPS_WRITE,
  bookings: FIELD_OPS,
  reports: ADMIN_FINANCE,
  report: ADMIN_FINANCE,
  activities: ADMIN,
  customers: ADMIN_FINANCE,
  consents: ADMIN_FINANCE,
  rentals: OPS_WRITE,
  payments: ADMIN_FINANCE,
  invoices: ADMIN_FINANCE,
  expenses: ADMIN,
  "cash-register": ADMIN_FINANCE,
  incidents: ALL_STAFF,
  staff: OWNER_ONLY,
  tasks: ALL_STAFF,
  content: OWNER_ONLY,
  orientation: ADMIN,
};

export function canAccess(role: string | null | undefined, module: Module): boolean {
  return MODULE_ACCESS[module]?.includes(role as StaffRole) ?? false;
}

export function accessibleModules(role: string | null | undefined): Set<Module> {
  const out = new Set<Module>();
  for (const m of Object.keys(MODULE_ACCESS) as Module[]) {
    if (canAccess(role, m)) out.add(m);
  }
  return out;
}

export function isFinanceRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager" || role === "reception";
}

export function isOpsStaff(role: string | null | undefined): boolean {
  return role === "watersports_staff" || role === "boat_crew";
}

export function isAdminRole(role: string | null | undefined): boolean {
  return role === "owner" || role === "manager";
}

/** Map a route path under /admin to its module (for middleware guards). */
export function moduleForPath(path: string): Module | null {
  const p = path.split("?")[0];
  if (p === "/admin") return "dashboard";
  const m = p.replace(/^\/admin\/?/, "").split("/")[0];
  const map: Record<string, Module> = {
    operations: "operations",
    trips: "trips",
    manifests: "manifests",
    reception: "reception",
    boats: "boats",
    crew: "crew",
    equipment: "equipment",
    bookings: "bookings",
    reports: "reports",
    report: "report",
    payments: "payments",
    invoices: "invoices",
    expenses: "expenses",
    income: "expenses",
    cashreg: "cash-register",
    customers: "customers",
    consents: "consents",
    rentals: "rentals",
    incidents: "incidents",
    staff: "staff",
    tasks: "tasks",
    activities: "activities",
    content: "content",
    orientation: "orientation",
  };
  return map[m] ?? "dashboard";
}