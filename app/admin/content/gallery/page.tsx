import { getAllGalleryItems } from "@/lib/supabase/actions";
import GalleryClient from "./GalleryClient";

export const metadata = { title: "Gallery | Thoddoo Marine Admin" };

export const dynamic = "force-dynamic";

export default async function ContentGalleryPage() {
  let items: Record<string, unknown>[] = [];
  try {
    items = (await getAllGalleryItems()) as unknown as Record<string, unknown>[];
  } catch {
    items = [];
  }

  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Gallery</h1>
        <p className="adminPageSub">
          Images shown on the public landing page. Use /images/... paths for files in the deployment or full image URLs.
        </p>
      </div>
      <GalleryClient initialItems={items} />
    </div>
  );
}