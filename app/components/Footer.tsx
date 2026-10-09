import { WHATSAPP_NUMBERS } from "@/lib/data";
import { formatWaNumber } from "@/lib/whatsapp";

export default function Footer() {
  return (
    <footer className="siteFooter">
      <div className="footerInner">
        <div className="footerBrand">
          <p className="footerLogo">Thoddoo Marine</p>
          <p className="footerTagline">Your Trips Partner · Thoddoo, Maldives</p>
        </div>

        <div className="footerLinks">
          <h4>Explore</h4>
          <a href="/#home">Home</a>
          <a href="/#adventures">Activities</a>
          <a href="/#explore">Explore Thoddoo</a>
        </div>

        <div className="footerLinks">
          <h4>Company</h4>
          <a href="/#about">About Us</a>
          <a href="/#gallery">Gallery</a>
          <a href="/#contact">Contact</a>
        </div>

        <div className="footerContact">
          <h4>Contact</h4>
          <p>WhatsApp</p>
          {WHATSAPP_NUMBERS.map((num) => (
            <a
              key={num}
              href={`https://wa.me/${num}`}
              target="_blank"
              rel="noreferrer"
            >
              {formatWaNumber(num)}
            </a>
          ))}
        </div>
      </div>

      <div className="footerBottom">
        <span>© 2026 Thoddoo Marine Excursion Centre, Thoddoo Maldives.</span>
      </div>
    </footer>
  );
}
