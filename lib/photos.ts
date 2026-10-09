export interface Photo {
  src: string;
  alt: string;
  orientation: "landscape" | "portrait";
  tag: string | null;
  source: string;
}

// Static fallback used when the CMS gallery is empty (local dev without
// Supabase). The live gallery is gallery_items, seeded in 018_cms.sql.
export const photos: Photo[] = [
  {
    src: "/images/thoddoo/turtle-snorkeling.jpg",
    alt: "Turtle snorkeling off Thoddoo",
    orientation: "landscape",
    tag: "turtle-snorkeling",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/manta-snorkeling.jpg",
    alt: "Manta snorkeling near Thoddoo",
    orientation: "landscape",
    tag: "manta-snorkeling",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/reef-snorkeling.jpg",
    alt: "Reef snorkeling in Ari Atoll",
    orientation: "landscape",
    tag: "reef-snorkeling",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/whale-shark-trip.jpg",
    alt: "Whale shark trip to Dhigurah",
    orientation: "landscape",
    tag: "whale-shark-trip",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/shark-feeding.jpg",
    alt: "Shark feeding at Rasdhoo",
    orientation: "landscape",
    tag: "shark-feeding",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/sandbank-trip.jpg",
    alt: "Sandbank trip in Ari Atoll",
    orientation: "landscape",
    tag: "sandbank-trip",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/island-hopping.jpg",
    alt: "Island hopping from Thoddoo",
    orientation: "landscape",
    tag: "island-hopping",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/dolphin-cruise.jpg",
    alt: "Dolphin cruise at sunset",
    orientation: "landscape",
    tag: "dolphin-cruise",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/half-day-trip.jpg",
    alt: "Half day trip from Thoddoo",
    orientation: "landscape",
    tag: "half-day-trip",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/full-day-trip.jpg",
    alt: "Full day trip with lunch at Ukulhas",
    orientation: "landscape",
    tag: "full-day-trip",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/resort-trip.jpg",
    alt: "Resort day visit from Thoddoo",
    orientation: "landscape",
    tag: "resort-trip",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/sunset-fishing.jpg",
    alt: "Night fishing after sunset",
    orientation: "landscape",
    tag: "sunset-fishing",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/octopus-hunting.jpg",
    alt: "Octopus hunting on the reef",
    orientation: "landscape",
    tag: "octopus-hunting",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/fun-ride.jpg",
    alt: "Fun ride around Thoddoo",
    orientation: "landscape",
    tag: "fun-ride",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/beach-candle-lit-dinner.jpg",
    alt: "Beach candle lit dinner",
    orientation: "landscape",
    tag: "beach-candle-lit-dinner",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/romantic-floating-dinner.jpg",
    alt: "Romantic floating dinner on the lagoon",
    orientation: "landscape",
    tag: "romantic-floating-dinner",
    source: "take-app",
  },
  {
    src: "/images/thoddoo/drone-photo-shoot.jpg",
    alt: "Drone photo shoot over Thoddoo",
    orientation: "landscape",
    tag: "drone-photo-shoot",
    source: "take-app",
  },
];

export const taggedPhotos = photos.filter((p) => p.tag !== null);

export const TAG_LABELS: Record<string, string> = {
  "turtle-snorkeling": "Turtle Snorkeling",
  "reef-snorkeling": "Reef Snorkeling",
  "manta-snorkeling": "Manta Snorkeling",
  "shark-feeding": "Shark Feeding",
  "whale-shark-trip": "Whale Shark Trip",
  "island-hopping": "Island Hopping",
  "dolphin-cruise": "Dolphin Cruise",
  "half-day-trip": "Half Day Trip",
  "full-day-trip": "Full Day Trip",
  "resort-trip": "Resort Trip",
  "sandbank-trip": "Sand Bank Trip",
  "fun-ride": "Fun Ride",
  "sunset-fishing": "Sunset Fishing",
  "octopus-hunting": "Octopus Hunting",
  "beach-candle-lit-dinner": "Beach Candle Lit Dinner",
  "romantic-floating-dinner": "Romantic Floating Dinner",
  "drone-photo-shoot": "Drone Photo Shoot",
};
