export interface Category {
  id: string;
  title: string;
  slug: string;
  image: string;
  colorClass: string;
  filterValue?: string;
}

export interface PricingOption {
  label: string;
  price: string;
  priceCents: number;
  pricingUnit?: "per_person" | "per_unit" | "per_hour";
  note?: string;
  currency?: string;
}

export interface Activity {
  id: string;
  name: string;
  slug: string;
  category: string;
  filterCategory: string;
  location: string;
  priceLabel: string;
  priceNote?: string;
  duration?: string;
  image: string;
  heroImageUrl?: string;
  gallery?: string[];
  gopro: boolean;
  shortDescription: string;
  featured?: boolean;
  description?: string;
  includes?: string[];
  minGuests?: number;
  pricingOptions?: PricingOption[];
  basePriceCents?: number;
  currency?: string;
}

export interface FilterOption {
  label: string;
  value: string;
}

export interface WhatsAppParams {
  activity?: string;
  option?: string;
  date?: string;
  guests?: number;
  name?: string;
  hotel?: string;
  message?: string;
}
