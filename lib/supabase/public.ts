import type { Activity } from "@/lib/types";
import { adventures, watersportsActivities } from "@/lib/data";
import { createPublicClient } from "./public-read";
import { formatMoney, currencyForDisplay } from "@/lib/money";

interface PricingRow {
  label: string;
  price_cents: number;
  pricing_unit?: string;
  currency?: string;
  note?: string;
  sort_order: number;
}

interface ActivityRow {
  id: string;
  name: string;
  slug: string;
  category: string;
  description?: string;
  short_description?: string;
  location?: string;
  duration_minutes?: number;
  max_guests?: number;
  base_price_cents: number;
  currency?: string;
  price_note?: string;
  image?: string;
  hero_image_url?: string;
  gopro: boolean;
  active: boolean;
  featured: boolean;
  activity_pricing?: PricingRow[];
}

function centsToMoney(cents: number, currency?: string): string {
  return formatMoney(cents, currencyForDisplay(currency));
}

function mapRow(row: ActivityRow): Activity {
  const currency = currencyForDisplay(row.currency);
  const pricingOptions = (row.activity_pricing ?? [])
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((pr) => ({
      label: pr.label,
      price: centsToMoney(pr.price_cents, pr.currency || currency),
      priceCents: pr.price_cents,
      pricingUnit: (pr.pricing_unit as "per_person" | "per_unit" | "per_hour") || undefined,
      note: pr.note || undefined,
      currency: pr.currency || currency,
    }));

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    filterCategory: row.category,
    location: row.location ?? "",
    priceLabel: centsToMoney(row.base_price_cents, currency),
    priceNote: row.price_note || undefined,
    duration: row.duration_minutes ? `${row.duration_minutes} min` : undefined,
    image: row.image ?? "",
    heroImageUrl: row.hero_image_url ?? "",
    gopro: row.gopro,
    shortDescription: row.short_description ?? "",
    featured: !!row.featured,
    description: row.description || undefined,
    pricingOptions: pricingOptions.length > 0 ? pricingOptions : undefined,
    basePriceCents: row.base_price_cents,
    currency,
  };
}

async function fetchAll(): Promise<Activity[]> {
  const supabase = createPublicClient();
  const { data, error } = await supabase
    .from("activities")
    .select("*, activity_pricing(*)")
    .eq("active", true);

  if (error || !data) return [];
  return data.map((row) => mapRow(row as ActivityRow));
}

export async function getPublicActivities(): Promise<Activity[]> {
  try {
    const rows = await fetchAll();
    const filtered = rows.filter((a) => a.category !== "watersports");
    return filtered.length > 0 ? filtered : adventures;
  } catch {
    return adventures;
  }
}

export async function getPublicWatersports(): Promise<Activity[]> {
  try {
    const rows = await fetchAll();
    const filtered = rows.filter((a) => a.category === "watersports");
    return filtered.length > 0 ? filtered : watersportsActivities;
  } catch {
    return watersportsActivities;
  }
}

export async function getPublicFeatured(limit = 6): Promise<Activity[]> {
  try {
    const rows = await fetchAll();
    const featured = rows.filter((a) => a.featured);
    const source = featured.length > 0 ? featured : rows;
    if (source.length === 0) return [...adventures, ...watersportsActivities].slice(0, limit);
    return source.slice(0, limit);
  } catch {
    return [...adventures, ...watersportsActivities].slice(0, limit);
  }
}

export async function getPublicActivityBySlug(slug: string): Promise<Activity | null> {
  try {
    const rows = await fetchAll();
    const found = rows.find((a) => a.slug === slug && a.category !== "watersports");
    return found ?? adventures.find((a) => a.slug === slug) ?? null;
  } catch {
    return adventures.find((a) => a.slug === slug) ?? null;
  }
}

export async function getPublicWatersportBySlug(slug: string): Promise<Activity | null> {
  try {
    const rows = await fetchAll();
    const found = rows.find((a) => a.slug === slug && a.category === "watersports");
    return found ?? watersportsActivities.find((w) => w.slug === slug) ?? null;
  } catch {
    return watersportsActivities.find((w) => w.slug === slug) ?? null;
  }
}

export async function getPublicAllActivities(): Promise<Activity[]> {
  try {
    const [others, watersports] = await Promise.all([
      getPublicActivities(),
      getPublicWatersports(),
    ]);
    const seen = new Set<string>();
    return [...others, ...watersports].filter((a) =>
      seen.has(a.id) ? false : (seen.add(a.id), true)
    );
  } catch {
    return [...adventures, ...watersportsActivities];
  }
}

export async function getPublicRelatedActivities(current: Activity, limit = 3): Promise<Activity[]> {
  try {
    const rows = await getPublicActivities();
    return rows.filter((a) => a.id !== current.id && a.filterCategory === current.filterCategory).slice(0, limit);
  } catch {
    return adventures
      .filter((a) => a.id !== current.id && a.filterCategory === current.filterCategory)
      .slice(0, limit);
  }
}

export async function getPublicRelatedWatersports(current: Activity, limit = 3): Promise<Activity[]> {
  try {
    const rows = await getPublicWatersports();
    return rows.filter((w) => w.id !== current.id).slice(0, limit);
  } catch {
    return watersportsActivities.filter((w) => w.id !== current.id).slice(0, limit);
  }
}

export async function getPublicAdventureSlugs(): Promise<string[]> {
  try {
    const rows = await getPublicActivities();
    return rows.map((a) => a.slug);
  } catch {
    return adventures.map((a) => a.slug);
  }
}

export async function getPublicWatersportSlugs(): Promise<string[]> {
  try {
    const rows = await getPublicWatersports();
    return rows.map((w) => w.slug);
  } catch {
    return watersportsActivities.map((w) => w.slug);
  }
}
