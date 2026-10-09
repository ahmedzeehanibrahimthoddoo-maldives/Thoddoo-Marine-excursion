import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import WalkinBookingClient from "./WalkinBookingClient";
import {
  getPublicActivityBySlug,
  getPublicWatersportBySlug,
  getPublicAllActivities,
  getPublicAdventureSlugs,
  getPublicWatersportSlugs,
} from "@/lib/supabase/public";
import { formatUsdOnly } from "@/lib/money";
import type { Activity } from "@/lib/types";

interface Props {
  params: Promise<{ activitySlug: string }>;
}

// Static so staff QR links never hit the Worker (and never Error 1102).
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  const [adventureSlugs, watersportSlugs] = await Promise.all([
    getPublicAdventureSlugs(),
    getPublicWatersportSlugs(),
  ]);
  return [...new Set([...adventureSlugs, ...watersportSlugs])].map((activitySlug) => ({
    activitySlug,
  }));
}

async function resolveActivity(slug: string): Promise<Activity | null> {
  const a = await getPublicActivityBySlug(slug);
  if (a) return a;
  return getPublicWatersportBySlug(slug);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { activitySlug } = await params;
  const activity = await resolveActivity(activitySlug);
  if (!activity) return { title: "Booking Not Found | Thoddoo Marine Thoddoo" };
  return {
    title: `Walk-in Booking – ${activity.name} | Thoddoo Marine Thoddoo`,
    description: `Quick on-site booking for ${activity.name}. Enter your details and our team will process it right away.`,
    robots: { index: false, follow: true },
  };
}

export default async function WalkinBookingPage({ params }: Props) {
  const { activitySlug } = await params;
  const activity = await resolveActivity(activitySlug);

  if (!activity) {
    notFound();
  }

  const allActivities = await getPublicAllActivities();
  const catalogue = allActivities.map((a) => ({
    id: a.id,
    slug: a.slug,
    name: a.name,
    category: a.category,
    basePriceCents: a.basePriceCents || 0,
    pricingOptions: a.pricingOptions,
    priceNote: a.priceNote,
    currency: a.currency,
  }));

  return (
    <main>
      <Header />

      <section className="walkinHero">
        <div className="walkinHeroTitle">
          <span className="walkinBadge">ON-SITE WALK-IN BOOKING</span>
          <h1>{activity.name}</h1>
          <p className="walkinLocation">⌖ {activity.location}</p>
        </div>
        <div className="walkinHeroPrice">
          <strong>{formatUsdOnly(activity.basePriceCents || 0, activity.currency)}</strong>
          {activity.priceNote && <span>{activity.priceNote}</span>}
        </div>
      </section>

      <section className="walkinBody">
        <WalkinBookingClient
          activityId={activity.id}
          activityName={activity.name}
          category={activity.category}
          basePriceCents={activity.basePriceCents || 0}
          pricingOptions={activity.pricingOptions}
          priceNote={activity.priceNote}
          currency={activity.currency}
          catalogue={catalogue}
        />
      </section>

      <Footer />
    </main>
  );
}