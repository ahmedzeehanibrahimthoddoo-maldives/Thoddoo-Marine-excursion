import { createPublicClient } from "@/lib/supabase/public-read";

export interface GalleryItemRow {
  id: string;
  image_url: string;
  caption: string;
  orientation: string;
  sort_order: number;
  active: boolean;
  tag: string | null;
}

export interface ExploreItemRow {
  id: string;
  title: string;
  body: string;
  image_url: string;
  sort_order: number;
  active: boolean;
}

export async function getSiteContent(): Promise<Record<string, string>> {
  try {
    const supabase = createPublicClient();
    const { data } = await supabase.from("site_content").select("key, value");
    const map: Record<string, string> = {};
    for (const r of data ?? []) map[r.key] = r.value;
    return map;
  } catch {
    return {};
  }
}

export async function getGalleryItems(): Promise<GalleryItemRow[]> {
  try {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("gallery_items")
      .select("id, image_url, caption, orientation, sort_order, active, tag")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    return (data ?? []) as GalleryItemRow[];
  } catch {
    return [];
  }
}

export async function getExploreItems(): Promise<ExploreItemRow[]> {
  try {
    const supabase = createPublicClient();
    const { data } = await supabase
      .from("explore_items")
      .select("id, title, body, image_url, sort_order, active")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    return (data ?? []) as ExploreItemRow[];
  } catch {
    return [];
  }
}

export function contentFallback(map: Record<string, string>, key: string, fallback: string): string {
  const v = map[key];
  return v && v.trim() !== "" ? v : fallback;
}