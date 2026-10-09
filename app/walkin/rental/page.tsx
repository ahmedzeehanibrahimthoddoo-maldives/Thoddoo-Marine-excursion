import type { Metadata } from "next";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import WalkinRentalClient from "./WalkinRentalClient";

export const metadata: Metadata = {
  title: "Rent Snorkel & Dive Gear | Thoddoo Marine Thoddoo",
  description:
    "Walk-in equipment rental: choose your gear, add your details and sign the liability waiver on your phone, then collect it at our counter.",
  robots: { index: false, follow: true },
};

export default function WalkinRentalPage() {
  return (
    <main>
      <Header />

      <section className="walkinHero">
        <div className="walkinHeroTitle">
          <span className="walkinBadge">ON-SITE WALK-IN RENTAL</span>
          <h1>Rent gear by the day</h1>
          <p className="walkinLocation">⌖ Scan · choose · sign · collect at the counter</p>
        </div>
      </section>

      <section className="walkinBody">
        <WalkinRentalClient />
      </section>

      <Footer />
    </main>
  );
}
