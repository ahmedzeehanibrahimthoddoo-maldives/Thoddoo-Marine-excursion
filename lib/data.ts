import type { Category, Activity, FilterOption } from "./types";

export const WHATSAPP_NUMBERS = ["9609472110", "6281353748031"];

export const categories: Category[] = [
  {
    id: "snorkeling",
    title: "Snorkeling",
    slug: "snorkeling",
    image: "/images/thoddoo/turtle-snorkeling.jpg",
    colorClass: "aqua",
    filterValue: "snorkeling",
  },
  {
    id: "sharks-mantas",
    title: "Sharks & Mantas",
    slug: "sharks-and-mantas",
    image: "/images/thoddoo/manta-snorkeling.jpg",
    colorClass: "teal",
    filterValue: "sharks-mantas",
  },
  {
    id: "excursions",
    title: "Excursions",
    slug: "excursions",
    image: "/images/thoddoo/island-hopping.jpg",
    colorClass: "green",
    filterValue: "excursions",
  },
  {
    id: "watersports",
    title: "Watersports",
    slug: "watersports",
    image: "/images/thoddoo/fun-ride.jpg",
    colorClass: "orange",
  },
  {
    id: "fishing",
    title: "Fishing",
    slug: "fishing",
    image: "/images/thoddoo/sunset-fishing.jpg",
    colorClass: "indigo",
    filterValue: "fishing",
  },
  {
    id: "cruises-dining",
    title: "Dining",
    slug: "dining",
    image: "/images/thoddoo/beach-candle-lit-dinner.jpg",
    colorClass: "purple",
    filterValue: "dining",
  },
];

export const filterOptions: FilterOption[] = [
  { label: "All", value: "all" },
  { label: "Snorkeling", value: "snorkeling" },
  { label: "Excursions", value: "excursions" },
  { label: "Island Trips", value: "island-trips" },
  { label: "Fishing", value: "fishing" },
  { label: "Dining", value: "dining" },
];

const snorkelIncludes = [
  "Snorkeling gear: mask, snorkel & fins",
  "Bottled water",
  "Local guide and crew",
];

export const adventures: Activity[] = [
  {
    id: "turtle-snorkeling",
    name: "Turtle Snorkeling",
    slug: "turtle-snorkeling",
    category: "snorkeling",
    filterCategory: "snorkeling",
    location: "Thoddoo shore reef",
    priceLabel: "$20",
    basePriceCents: 2000,
    currency: "USD",
    image: "/images/thoddoo/turtle-snorkeling.jpg",
    gallery: ["/images/thoddoo/turtle-snorkeling.jpg"],
    gopro: true,
    shortDescription:
      "Snorkel with turtles in the shallows — in-shore, easy, GoPro video included.",
    description:
      "Snorkel with sea turtles in the shallows straight from the beach. A short in-shore session, ideal for first timers and families, and a GoPro video of the swim is included.",
    includes: [...snorkelIncludes, "GoPro video of the swim"],
  },
  {
    id: "reef-snorkeling",
    name: "Reef Snorkeling",
    slug: "reef-snorkeling",
    category: "snorkeling",
    filterCategory: "snorkeling",
    location: "Near Thoddoo",
    priceLabel: "$35",
    basePriceCents: 3500,
    currency: "USD",
    image: "/images/thoddoo/reef-snorkeling.jpg",
    gallery: ["/images/thoddoo/reef-snorkeling.jpg"],
    gopro: true,
    shortDescription:
      "Guided reef snorkel just off Thoddoo, with GoPro video included.",
    description:
      "Snorkel the coral reefs around Thoddoo with the crew guiding you over the reef edge. A GoPro video of the session is included.",
    includes: [...snorkelIncludes, "GoPro video of the session"],
  },
  {
    id: "manta-snorkeling",
    name: "Manta Snorkeling",
    slug: "manta-snorkeling",
    category: "snorkeling",
    filterCategory: "snorkeling",
    location: "Near Thoddoo",
    priceLabel: "$40",
    basePriceCents: 4000,
    currency: "USD",
    image: "/images/thoddoo/manta-snorkeling.jpg",
    gallery: ["/images/thoddoo/manta-snorkeling.jpg"],
    gopro: true,
    shortDescription:
      "Snorkel with manta rays at the cleaning stations near Thoddoo.",
    description:
      "Boat out to the cleaning stations near Thoddoo and snorkel with manta rays. Sightings depend on natural conditions and cannot be guaranteed, but the crew knows these waters. GoPro video included.",
    includes: [...snorkelIncludes, "GoPro video of the trip"],
  },
  {
    id: "shark-feeding",
    name: "Shark Feeding",
    slug: "shark-feeding",
    category: "snorkeling",
    filterCategory: "snorkeling",
    location: "Rasdhoo",
    priceLabel: "$50",
    basePriceCents: 5000,
    currency: "USD",
    image: "/images/thoddoo/shark-feeding.jpg",
    gallery: ["/images/thoddoo/shark-feeding.jpg"],
    gopro: false,
    minGuests: 8,
    shortDescription:
      "Reef shark feeding at Rasdhoo plus a tour of the island. Min. 8 persons.",
    description:
      "Watch the reef sharks feed at Rasdhoo, followed by a tour of Rasdhoo itself. Minimum 8 persons for the trip to run.",
    includes: snorkelIncludes,
  },
  {
    id: "whale-shark-trip",
    name: "Whale Shark Trip",
    slug: "whale-shark-trip",
    category: "snorkeling",
    filterCategory: "snorkeling",
    location: "Dhigurah / Mahibadhoo",
    priceLabel: "$150",
    basePriceCents: 15000,
    currency: "USD",
    image: "/images/thoddoo/whale-shark-trip.jpg",
    gallery: ["/images/thoddoo/whale-shark-trip.jpg"],
    gopro: false,
    minGuests: 12,
    shortDescription:
      "Whale shark snorkeling at Dhigurah or Mahibadhoo. Min. 12 persons.",
    description:
      "Full trip to Dhigurah or Mahibadhoo in search of whale sharks, with snorkeling wherever they are found that day. Minimum 12 persons; sightings depend on natural conditions.",
    includes: snorkelIncludes,
  },
  {
    id: "island-hopping",
    name: "Island Hopping",
    slug: "island-hopping",
    category: "excursions",
    filterCategory: "excursions",
    location: "Rasdhoo / Mathiveri / Ukulhas",
    priceLabel: "$65",
    basePriceCents: 6500,
    currency: "USD",
    duration: "3 hours",
    image: "/images/thoddoo/island-hopping.jpg",
    gallery: ["/images/thoddoo/island-hopping.jpg"],
    gopro: false,
    minGuests: 8,
    shortDescription:
      "Three-hour visit to Rasdhoo, Mathiveri or Ukulhas. Min. 8 persons.",
    description:
      "Three hours visiting one island of your choice — Rasdhoo, Mathiveri or Ukulhas. Minimum 8 persons for the trip to run.",
  },
  {
    id: "dolphin-cruise",
    name: "Dolphin Cruise",
    slug: "dolphin-cruise",
    category: "excursions",
    filterCategory: "excursions",
    location: "Ari Atoll",
    priceLabel: "$65",
    basePriceCents: 6500,
    currency: "USD",
    duration: "17:00 – 18:30",
    image: "/images/thoddoo/dolphin-cruise.jpg",
    gallery: ["/images/thoddoo/dolphin-cruise.jpg"],
    gopro: false,
    minGuests: 4,
    shortDescription:
      "Sunset dolphin cruise with soft drinks and fruit. Min. 4 persons.",
    description:
      "Evening dolphin cruise from 17:00 to 18:30 with sunset views, soft drinks and fruit on board. Minimum 4 persons. Dolphin sightings depend on natural conditions.",
  },
  {
    id: "half-day-trip",
    name: "Half Day Trip",
    slug: "half-day-trip",
    category: "excursions",
    filterCategory: "excursions",
    location: "Ari Atoll",
    priceLabel: "$65",
    basePriceCents: 6500,
    currency: "USD",
    image: "/images/thoddoo/half-day-trip.jpg",
    gallery: ["/images/thoddoo/half-day-trip.jpg"],
    gopro: false,
    minGuests: 8,
    shortDescription:
      "Manta snorkeling, shark snorkeling and a sandbank in one half day. Min. 8 persons.",
    description:
      "A half-day combination of manta snorkeling, shark snorkeling and a sandbank stop. Minimum 8 persons for the trip to run.",
    includes: snorkelIncludes,
  },
  {
    id: "full-day-trip",
    name: "Full Day Trip",
    slug: "full-day-trip",
    category: "excursions",
    filterCategory: "excursions",
    location: "Ukulhas, Ari Atoll",
    priceLabel: "$95",
    basePriceCents: 9500,
    currency: "USD",
    image: "/images/thoddoo/full-day-trip.jpg",
    gallery: ["/images/thoddoo/full-day-trip.jpg"],
    gopro: false,
    minGuests: 8,
    shortDescription:
      "Manta, shark and shipwreck snorkeling with lunch at Ukulhas. Min. 8 persons.",
    description:
      "A full day of manta snorkeling, shark snorkeling and a shipwreck, with lunch at Ukulhas. Minimum 8 persons for the trip to run.",
    includes: [...snorkelIncludes, "Lunch at Ukulhas"],
  },
  {
    id: "resort-trip",
    name: "Resort Trip",
    slug: "resort-trip",
    category: "resort-trips",
    filterCategory: "excursions",
    location: "Ellaidhoo / Nika / Gangehi",
    priceLabel: "$150",
    basePriceCents: 15000,
    currency: "USD",
    image: "/images/thoddoo/resort-trip.jpg",
    gallery: ["/images/thoddoo/resort-trip.jpg"],
    gopro: false,
    minGuests: 10,
    shortDescription:
      "Resort day visit: Ellaidhoo, Nika Island or Gangehi. Min. 10 persons.",
    description:
      "Day visit to a resort — choose Ellaidhoo Maldives (all inclusive), Nika Island Resort (lunch only, drinks not included) or Gangehi (all inclusive). Minimum 10 persons for the trip to run.",
  },
  {
    id: "sandbank-trip",
    name: "Sand Bank Trip",
    slug: "sandbank-trip",
    category: "excursions",
    filterCategory: "excursions",
    location: "Ari Atoll",
    priceLabel: "$65",
    basePriceCents: 6500,
    currency: "USD",
    image: "/images/thoddoo/sandbank-trip.jpg",
    gallery: ["/images/thoddoo/sandbank-trip.jpg"],
    gopro: false,
    minGuests: 10,
    shortDescription: "Sandbank, fish feeding and a Rasdhoo tour. Min. 10 persons.",
    description:
      "Sandbank tour with fish feeding and a Rasdhoo tour. Minimum 10 persons for the trip to run.",
  },
  {
    id: "fun-ride",
    name: "Fun Ride",
    slug: "fun-ride",
    category: "excursions",
    filterCategory: "excursions",
    location: "Thoddoo Lagoon",
    priceLabel: "$35",
    basePriceCents: 3500,
    currency: "USD",
    image: "/images/thoddoo/fun-ride.jpg",
    gallery: ["/images/thoddoo/fun-ride.jpg"],
    gopro: false,
    shortDescription:
      "Speedboat ride around Thoddoo plus 15 minutes of reef snorkeling.",
    description:
      "A fast ride around Thoddoo followed by 15 minutes of reef snorkeling. The quick way to see the island and get in the water.",
  },
  {
    id: "sunset-fishing",
    name: "Sunset Fishing",
    slug: "sunset-fishing",
    category: "fishing",
    filterCategory: "fishing",
    location: "Ari Atoll",
    priceLabel: "$35",
    basePriceCents: 3500,
    currency: "USD",
    duration: "2 hours",
    image: "/images/thoddoo/sunset-fishing.jpg",
    gallery: ["/images/thoddoo/sunset-fishing.jpg"],
    gopro: false,
    shortDescription:
      "Two hours of night fishing after sunset; BBQ add-on available.",
    description:
      "Two hours of night fishing after sunset. Add a beach BBQ afterwards for 15 USD per person.",
  },
  {
    id: "octopus-hunting",
    name: "Octopus Hunting",
    slug: "octopus-hunting",
    category: "fishing",
    filterCategory: "fishing",
    location: "Near Thoddoo",
    priceLabel: "$45",
    basePriceCents: 4500,
    currency: "USD",
    image: "/images/thoddoo/octopus-hunting.jpg",
    gallery: ["/images/thoddoo/octopus-hunting.jpg"],
    gopro: false,
    shortDescription:
      "Traditional octopus hunt around the reef with the local crew.",
    description:
      "Join the crew on a traditional octopus hunt around the reef — wade and free-dive with speargun in hand, then see what the reef gives up.",
  },
  {
    id: "beach-candle-lit-dinner",
    name: "Beach Candle Lit Dinner",
    slug: "beach-candle-lit-dinner",
    category: "dining",
    filterCategory: "dining",
    location: "Thoddoo beach",
    priceLabel: "$150",
    basePriceCents: 15000,
    currency: "USD",
    duration: "18:30 – 19:30",
    image: "/images/thoddoo/beach-candle-lit-dinner.jpg",
    gallery: ["/images/thoddoo/beach-candle-lit-dinner.jpg"],
    gopro: false,
    shortDescription: "Decorated beach dinner with music, 18:30–19:30.",
    description:
      "Beach dinner with decoration and music, served 18:30–19:30 on the sand at Thoddoo.",
  },
  {
    id: "romantic-floating-dinner",
    name: "Romantic Floating Dinner",
    slug: "romantic-floating-dinner",
    category: "dining",
    filterCategory: "dining",
    location: "Thoddoo lagoon",
    priceLabel: "$150",
    basePriceCents: 15000,
    currency: "USD",
    image: "/images/thoddoo/romantic-floating-dinner.jpg",
    gallery: ["/images/thoddoo/romantic-floating-dinner.jpg"],
    gopro: false,
    shortDescription: "Floating sunset dinner on the lagoon with mocktails.",
    description:
      "A floating dinner on the lagoon at sunset, with mocktails. Set on the water for two.",
  },
  {
    id: "drone-photo-shoot",
    name: "Drone Photo Shoot",
    slug: "drone-photo-shoot",
    category: "add-ons",
    filterCategory: "excursions",
    location: "Thoddoo",
    priceLabel: "$40",
    basePriceCents: 4000,
    currency: "USD",
    image: "/images/thoddoo/drone-photo-shoot.jpg",
    gallery: ["/images/thoddoo/drone-photo-shoot.jpg"],
    gopro: false,
    shortDescription:
      "Drone photos and video at a location or theme of your choice.",
    description:
      "A drone photo and video session at a location or with a theme of your choice around Thoddoo.",
  },
];

export const watersportsActivities: Activity[] = [];

export const NAV_LINKS = [
  { label: "Home", href: "/#home" },
  { label: "Activities", href: "/#adventures" },
  { label: "Explore Thoddoo", href: "/#explore" },
  { label: "Gallery", href: "/#gallery" },
  { label: "About Us", href: "/#about" },
  { label: "Contact", href: "/#contact" },
];

export function getAdventureBySlug(slug: string): Activity | undefined {
  return adventures.find((a) => a.slug === slug);
}

export function getAdventuresByFilter(filter: string): Activity[] {
  if (filter === "all") return adventures;
  return adventures.filter((a) => a.filterCategory === filter);
}

export function getRelatedAdventures(current: Activity, limit = 3): Activity[] {
  return adventures
    .filter(
      (a) => a.id !== current.id && a.filterCategory === current.filterCategory,
    )
    .slice(0, limit);
}

export function getWatersportBySlug(slug: string): Activity | undefined {
  return watersportsActivities.find((w) => w.slug === slug);
}

export function getRelatedWatersports(
  current: Activity,
  limit = 3,
): Activity[] {
  return watersportsActivities
    .filter((w) => w.id !== current.id)
    .slice(0, limit);
}
