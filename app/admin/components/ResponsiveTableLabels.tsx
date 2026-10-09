"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Auto-labels table cells for the mobile card layout.
 * Copies each <th> label onto the matching <td> as data-label so the
 * responsive CSS can render every admin table as stacked cards on phones
 * and small tablets — no per-page changes needed.
 */
export default function ResponsiveTableLabels() {
  const pathname = usePathname();

  useEffect(() => {
    const label = () => {
      document.querySelectorAll<HTMLTableElement>("table.adminTable").forEach((table) => {
        if (table.querySelector("td[data-label]")) return;
        const header = table.querySelector("thead");
        if (!header) return;
        const labels = Array.from(header.querySelectorAll("th")).map((t) => t.textContent || "");
        const rows = table.querySelectorAll("tbody tr");
        if (rows.length === 0) return;
        rows.forEach((tr) => {
          Array.from(tr.children).forEach((td, i) => {
            td.setAttribute("data-label", labels[i] || "");
          });
        });
        table.setAttribute("data-cards", "");
      });
    };
    label();
    const observer = new MutationObserver(label);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [pathname]);

  return null;
}