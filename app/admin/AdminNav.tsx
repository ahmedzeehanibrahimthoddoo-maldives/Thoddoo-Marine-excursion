"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter, usePathname } from "next/navigation";
import { accessibleModules, ROLE_LABEL, type Module } from "@/lib/permissions";
import { buildWhatsAppWebLink } from "@/lib/whatsapp";
import { WHATSAPP_NUMBERS } from "@/lib/data";

interface AdminNavProps {
  userName: string;
  userRole: string;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
  module: Module;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [{ label: "Dashboard", href: "/admin", icon: "◈", module: "dashboard" }],
  },
  {
    label: "OPERATIONS",
    items: [
      { label: "My Tasks", href: "/admin/tasks", icon: "☑", module: "tasks" },
      { label: "Ops Board", href: "/admin/operations", icon: "⌘", module: "operations" },
      { label: "Briefing Cards", href: "/admin/briefings", icon: "📋", module: "operations" },
      { label: "Trips", href: "/admin/trips", icon: "⛵", module: "trips" },
      { label: "Reception", href: "/admin/reception", icon: "⇄", module: "reception" },
      { label: "Manifests", href: "/admin/manifests", icon: "▤", module: "manifests" },
      { label: "Fleet", href: "/admin/boats", icon: "▣", module: "boats" },
      { label: "Crew", href: "/admin/crew", icon: "◉", module: "crew" },
      { label: "Equipment", href: "/admin/equipment", icon: "▨", module: "equipment" },
    ],
  },
  {
    label: "ADMIN",
    items: [
      { label: "Bookings", href: "/admin/bookings", icon: "◎", module: "bookings" },
      { label: "Reports", href: "/admin/reports", icon: "▤", module: "reports" },
      { label: "Tomorrow's Report", href: "/admin/report", icon: "🗓", module: "report" },
      { label: "Activities", href: "/admin/activities", icon: "△", module: "activities" },
      { label: "Customers", href: "/admin/customers", icon: "◇", module: "customers" },
      { label: "Consents", href: "/admin/consents", icon: "✓", module: "consents" },
      { label: "Rentals", href: "/admin/rentals", icon: "↻", module: "rentals" },
      { label: "Payments", href: "/admin/payments", icon: "$", module: "payments" },
      { label: "Expenses", href: "/admin/expenses", icon: "ƒ", module: "expenses" },
      { label: "Other Income", href: "/admin/income", icon: "+", module: "expenses" },
      { label: "Cash Register", href: "/admin/cashreg", icon: "₨", module: "cash-register" },
      { label: "Invoices", href: "/admin/invoices", icon: "¶", module: "invoices" },
      { label: "Incidents", href: "/admin/incidents", icon: "⚠", module: "incidents" },
      { label: "Staff", href: "/admin/staff", icon: "⬢", module: "staff" },
      { label: "Orientation", href: "/admin/orientation", icon: "📋", module: "orientation" },
    ],
  },
  {
    label: "CONTENT",
    items: [
      { label: "Site Settings", href: "/admin/content/settings", icon: "⚙", module: "content" },
      { label: "Gallery", href: "/admin/content/gallery", icon: "▦", module: "content" },
      { label: "Explore Pages", href: "/admin/content/explore", icon: "◪", module: "content" },
      { label: "Activity Pages", href: "/admin/content/activities", icon: "▰", module: "content" },
    ],
  },
];

const officeWhatsAppHref = buildWhatsAppWebLink(
  WHATSAPP_NUMBERS[0],
  "Hello Thoddoo Marine, this is a message from the admin system."
);

export default function AdminNav({ userName, userRole }: AdminNavProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const supabase = createClient();
  const [app, setApp] = useState<"pms" | "cms">(() => {
    const m = typeof document !== "undefined" ? document.cookie.match(/(?:^|; )ob-app=([^;]+)/) : null;
    return m && m[1] === "cms" ? "cms" : "pms";
  });

  const allowed = useMemo(() => accessibleModules(userRole), [userRole]);
  const groups = useMemo(
    () =>
      NAV_GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((i) => {
          if (!allowed.has(i.module)) return false;
          if (app === "cms") return i.module === "content";
          return i.module !== "content";
        }),
      })).filter((g) => g.items.length > 0),
    [allowed, app]
  );

  function switchApp(target: "pms" | "cms") {
    document.cookie = `ob-app=${target}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    setApp(target);
    router.push(target === "cms" ? "/admin/content/settings" : "/admin");
    router.refresh();
  }

  const canSwitchToCms = allowed.has("content");
  const canSwitchToPms = app === "cms" && Array.from(allowed.keys()).some((m) => m !== "content");

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      <header className="adminTopbar">
        <button
          className="adminHamburger"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle menu"
        >
          <span /><span /><span />
        </button>
        <a href="/admin" className="adminBrand">
          <img src="/images/logo-transparent.png" alt="Thoddoo Marine" />
          <span className="adminBrandText">ADMIN</span>
        </a>
        <div className="adminTopbarRight">
          <a
            className="adminWhatsAppBtn"
            href={officeWhatsAppHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Open WhatsApp Web — office number"
          >
            <span className="adminWhatsAppIcon" aria-hidden>💬</span>
            WhatsApp
          </a>
          <span className={`adminAppBadge adminAppBadge-${app}`}>{app.toUpperCase()}</span>
          <span className="adminUserRole">{ROLE_LABEL[userRole] || userRole.replace("_", " ")}</span>
          <span className="adminUserName">{userName}</span>
          {app === "cms" && canSwitchToPms && (
            <button className="adminSwitchApp" onClick={() => switchApp("pms")}>Open PMS</button>
          )}
          {app !== "cms" && canSwitchToCms && (
            <button className="adminSwitchApp" onClick={() => switchApp("cms")}>Open CMS</button>
          )}
          <button className="adminSignOut" onClick={handleSignOut}>
            Sign Out
          </button>
        </div>
      </header>

      {sidebarOpen && (
        <div className="adminSidebarOverlay" onClick={() => setSidebarOpen(false)}>
          <nav className="adminSidebar" onClick={(e) => e.stopPropagation()}>
            {groups.map((group, gi) => (
              <div key={gi}>
                {group.label && <div className="adminSidebarGroup">{group.label}</div>}
                {group.items.map((item) => (
                  <a
                    key={item.href}
                    href={item.href}
                    className={`adminSidebarLink ${pathname === item.href ? "active" : ""}`}
                    onClick={() => setSidebarOpen(false)}
                  >
                    <span className="adminSidebarIcon">{item.icon}</span>
                    {item.label}
                  </a>
                ))}
              </div>
            ))}
            <div className="adminSidebarDivider" />
            <a href="/" className="adminSidebarLink">
              <span className="adminSidebarIcon">⌂</span>
              Public Site
            </a>
            <a href={officeWhatsAppHref} target="_blank" rel="noopener noreferrer" className="adminSidebarLink" onClick={() => setSidebarOpen(false)}>
              <span className="adminSidebarIcon">💬</span>
              WhatsApp Web
            </a>
          </nav>
        </div>
      )}

      <aside className="adminSidebarDesktop">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.label && <div className="adminSidebarGroup">{group.label}</div>}
            {group.items.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className={`adminSidebarLink ${pathname === item.href ? "active" : ""}`}
              >
                <span className="adminSidebarIcon">{item.icon}</span>
                {item.label}
              </a>
            ))}
          </div>
        ))}
        <div className="adminSidebarDivider" />
        <a href="/" className="adminSidebarLink">
          <span className="adminSidebarIcon">⌂</span>
          Public Site
        </a>
        <a href={officeWhatsAppHref} target="_blank" rel="noopener noreferrer" className="adminSidebarLink">
          <span className="adminSidebarIcon">💬</span>
          WhatsApp Web
        </a>
      </aside>
    </>
  );
}