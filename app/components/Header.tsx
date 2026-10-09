"use client";

import { useState } from "react";
import { NAV_LINKS } from "@/lib/data";
import { buildGeneralWhatsAppLink } from "@/lib/whatsapp";

const whatsapp = buildGeneralWhatsAppLink();

export default function Header() {
  const [open, setOpen] = useState(false);

  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="Thoddoo Marine home">
        <img src="/images/logo-transparent.png" alt="Thoddoo Marine Excursion Centre" />
      </a>

      <nav className="navlinks" aria-label="Primary navigation">
        {NAV_LINKS.map((link) => (
          <a key={link.href} href={link.href}>{link.label}</a>
        ))}
      </nav>

      <a className="book topbook" href={whatsapp} target="_blank" rel="noreferrer">
        ● BOOK NOW<br />
        <small>via WhatsApp</small>
      </a>

      <button
        className="hamburger"
        onClick={() => setOpen(!open)}
        aria-label="Toggle navigation menu"
        aria-expanded={open}
      >
        <span /><span /><span />
      </button>

      {open && (
        <div className="mobileOverlay" onClick={() => setOpen(false)}>
          <nav className="mobileNav" onClick={(e) => e.stopPropagation()}>
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
                {link.label}
              </a>
            ))}
            <a className="book mobileBook" href={whatsapp} target="_blank" rel="noreferrer">
              ● BOOK NOW via WhatsApp
            </a>
          </nav>
        </div>
      )}
    </header>
  );
}
