import Header from "./components/Header";
import Footer from "./components/Footer";
import BookingButton from "./components/BookingButton";
import type { AddonActivity } from "./components/BookingForm";
import GalleryGrid from "./components/GalleryGrid";
import { categories, WHATSAPP_NUMBERS } from "@/lib/data";
import {
  getSiteContent,
  getGalleryItems,
  getExploreItems,
  contentFallback,
} from "@/lib/content";
import {
  getPublicActivities,
  getPublicWatersports,
} from "@/lib/supabase/public";
import {
  buildGeneralWhatsAppLink,
  buildActivityWhatsAppLink,
  formatWaNumber,
} from "@/lib/whatsapp";
import { formatUsdOnly } from "@/lib/money";
import type { Activity } from "@/lib/types";

// Fully static: public content is read with a cookie-less client, so this page
// is prerendered at build time and served straight from Cloudflare's static
// asset store — no Worker CPU, no Error 1102 on the free plan.
export const dynamic = "force-static";
export const revalidate = false;

const whatsapp = buildGeneralWhatsAppLink();

function pricingUnitLabel(unit?: string): string {
  if (unit === "per_hour") return "/ hr";
  if (unit === "per_unit") return "/ session";
  return "";
}

function ActivityCard({
  item,
  addons,
}: {
  item: Activity;
  addons: AddonActivity[];
}) {
  const hasOptions = item.pricingOptions && item.pricingOptions.length > 0;
  return (
    <article className="advCard" id={item.slug}>
      <div className="advCardMedia">
        <img src={item.heroImageUrl || item.image} alt={item.name} />
        {item.gopro && <span className="badge">GOPRO</span>}
      </div>
      <div className="advCardBody">
        <h3>{item.name}</h3>
        <p className="advPlace">⌖ {item.location}</p>
        <p className="advDesc">{item.shortDescription}</p>

        {hasOptions ? (
          <div className="wsPricing">
            {item.pricingOptions!.map((opt) => (
              <div className="wsPriceRow" key={opt.label}>
                <span className="wsPriceLabel">{opt.label}</span>
                <span className="wsPriceValue">
                  {formatUsdOnly(opt.priceCents, opt.currency || item.currency)}
                  {pricingUnitLabel(opt.pricingUnit)}
                  {opt.note ? ` ${opt.note}` : ""}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="advMeta">
            <div>
              <strong>
                {formatUsdOnly(item.basePriceCents || 0, item.currency)}
              </strong>
              {item.priceNote && <small>{item.priceNote}</small>}
            </div>
            {item.duration && <span>◷ {item.duration}</span>}
          </div>
        )}

        {item.includes && item.includes.length > 0 && (
          <ul className="advIncludes">
            {item.includes.map((line) => (
              <li key={line}>✓ {line}</li>
            ))}
          </ul>
        )}

        <div className="advActions">
          <BookingButton
            activityId={item.id}
            activityName={item.name}
            category={item.category}
            basePriceCents={item.basePriceCents || 0}
            priceNote={item.priceNote}
            pricingOptions={item.pricingOptions}
            currency={item.currency}
            className="advBook"
            addonActivities={addons.filter((a) => a.id !== item.id)}
          >
            BOOK NOW
          </BookingButton>
          <a
            className="advDetails"
            href={buildActivityWhatsAppLink(item.name)}
            target="_blank"
            rel="noreferrer"
          >
            WHATSAPP
          </a>
        </div>
      </div>
    </article>
  );
}

export default async function Home() {
  const [content, adventures, watersports, gallery, explore] =
    await Promise.all([
      getSiteContent(),
      getPublicActivities(),
      getPublicWatersports(),
      getGalleryItems(),
      getExploreItems(),
    ]);

  const phoneText = [
    contentFallback(content, "phone_1", "+960 947 2110"),
    contentFallback(content, "phone_2", "+62 813 5374 8031"),
  ].join(" / ");
  const addressLine = contentFallback(
    content,
    "address_line",
    "Thoddoo, Ari Atoll, Maldives",
  );

  const galleryItems = gallery.map((g) => ({
    src: g.image_url,
    alt: g.caption || "Thoddoo Marine Excursion",
    orientation: (g.orientation === "portrait" ? "portrait" : "landscape") as
      "landscape" | "portrait",
    tag: g.tag ?? null,
  }));

  const addonPool: AddonActivity[] = [...adventures, ...watersports].map(
    (a) => ({
      id: a.id,
      name: a.name,
      basePriceCents: a.basePriceCents || 0,
      priceNote: a.priceNote,
      currency: a.currency,
      pricingOptions: a.pricingOptions,
    }),
  );

  return (
    <main>
      <Header />

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section id="home" className="hero">
        <div className="heroShade" />
        <div className="heroContent">
          <p className="eyebrow">
            {contentFallback(content, "hero_eyebrow", "THODDOO • MALDIVES")}
          </p>
          <h1>
            {contentFallback(content, "hero_title_1", "MAKE WAVES.")}
            <br />
            <span>
              {contentFallback(content, "hero_title_2", "CHASE ADVENTURE.")}
            </span>
          </h1>
          <p>
            {contentFallback(
              content,
              "hero_subtitle",
              "Snorkel with manta rays and reef sharks, hop between islands, chase sandbanks and end the day watching the sunset over Ari Atoll.",
            )}
          </p>
          <div className="heroActions">
            <a className="primary" href="#adventures">
              EXPLORE ACTIVITIES ≋
            </a>
            <a
              className="secondary"
              href={whatsapp}
              target="_blank"
              rel="noreferrer"
            >
              ◉ BOOK NOW
            </a>
          </div>
          <div className="trust">
            <span>
              ▣ <b>COMPLIMENTARY</b>
              <br />
              GoPro on selected trips
            </span>
            <span>
              ◇ <b>SAFE &amp; PROFESSIONAL</b>
              <br />
              Friendly local crew
            </span>
            <span>
              ✦ <b>LOCAL EXPERTS</b>
              <br />
              Ari Atoll
            </span>
          </div>
        </div>
      </section>

      {/* ── Category quick-nav ───────────────────────────────── */}
      <section className="section categories" id="activities">
        <div className="sectionTitle">
          <h2>WHAT ARE YOU LOOKING FOR?</h2>
          <span />
        </div>
        <div className="categoryGrid">
          {categories
            .filter(
              (cat) =>
                !(cat.slug === "watersports" && watersports.length === 0),
            )
            .map((cat) => (
              <a
                className={`category ${cat.colorClass}`}
                key={cat.id}
                href={cat.slug === "watersports" ? "#watersports" : "#adventures"}
              >
                <div className="categoryImgWrap">
                  <img src={cat.image} alt={cat.title} />
                </div>
                <div className="categoryLabel">{cat.title}</div>
              </a>
            ))}
        </div>
      </section>

      {/* ── Adventures ───────────────────────────────────────── */}
      <section className="section" id="adventures">
        <div className="sectionHeading">
          <h2>ADVENTURES &amp; EXCURSIONS</h2>
          <a href={whatsapp} target="_blank" rel="noreferrer">
            Questions? WhatsApp us →
          </a>
        </div>
        <div className="adventureGrid">
          {adventures.map((item) => (
            <ActivityCard item={item} key={item.id} addons={addonPool} />
          ))}
        </div>
      </section>

      {/* ── Watersports (hidden until the CMS has watersports) ─ */}
      {watersports.length > 0 && (
        <section className="section" id="watersports">
          <div className="sectionHeading">
            <h2>WATERSPORTS</h2>
            <a href={whatsapp} target="_blank" rel="noreferrer">
              Need help choosing? WhatsApp us →
            </a>
          </div>
          <div className="adventureGrid">
            {watersports.map((item) => (
              <ActivityCard item={item} key={item.id} addons={addonPool} />
            ))}
          </div>
        </section>
      )}

      {/* ── Beach dinner (offer) ─────────────────────────────── */}
      <section className="section featureGrid">
        <article className="feature bbq">
          <div className="featureCopy">
            <h3>♨ BEACH CANDLE LIT DINNER</h3>
            <p>
              Decoration, music and dinner served on the sand — 18:30 to 19:30,
              right on Thoddoo beach.
            </p>
            <strong>{formatUsdOnly(15000, "USD")}</strong>
            <p className="info">◷ 18:30 – 19:30</p>
            <a href={whatsapp} target="_blank" rel="noreferrer">
              BOOK VIA WHATSAPP
            </a>
          </div>
          <img
            src="/images/thoddoo/beach-candle-lit-dinner.jpg"
            alt="Beach candle lit dinner"
          />
        </article>
      </section>

      {/* ── About / why us ───────────────────────────────────── */}
      <section className="section" id="about">
        <div className="sectionTitle">
          <h2>WHY THODDOO MARINE</h2>
          <span />
        </div>
        <div className="aboutIntro">
          <div className="aboutIntroText">
            <p>
              {contentFallback(
                content,
                "about_p1",
                "Thoddoo Marine Excursion Centre is a local, family-run trips centre based on Anboofannu magu in Thoddoo — your trips partner in Ari Atoll.",
              )}
            </p>
            <p>
              {contentFallback(
                content,
                "about_p2",
                "Our crew grew up on these waters and knows exactly where the mantas, reef sharks and turtles gather, and which sandbanks are quiet that day.",
              )}
            </p>
            <p>
              {contentFallback(
                content,
                "about_p3",
                "From turtle snorkeling and full-day trips to island hops and candle-lit dinners on the beach, every trip runs with safety first and a genuine love for the ocean.",
              )}
            </p>
          </div>
          <img
            className="aboutIntroImage"
            src="/images/thoddoo/reef-snorkeling.jpg"
            alt="Snorkeling with Thoddoo Marine"
          />
        </div>
      </section>

      {/* ── Explore Thoddoo ──────────────────────────────────── */}
      <section className="section" id="explore">
        <div className="sectionTitle">
          <h2>DISCOVER THODDOO</h2>
          <span />
        </div>
        <div className="exploreIntro">
          <img
            className="exploreIntroImage"
            src="/images/thoddoo/sandbank-trip.jpg"
            alt="Sandbank near Thoddoo"
          />
          <div className="exploreIntroText">
            <p>
              {contentFallback(
                content,
                "explore_p1",
                "Thoddoo is a small inhabited island in Ari Atoll, surrounded by turquoise lagoons, vibrant reefs and picture-perfect sandbanks.",
              )}
            </p>
            <p>
              {contentFallback(
                content,
                "explore_p2",
                "It is the closest island to the famous Thoddoo Madivaru reef, where hammerhead sharks and manta rays are regularly spotted.",
              )}
            </p>
            <p>
              {contentFallback(
                content,
                "explore_p3",
                "Beyond the diving, Thoddoo offers quiet beaches, local cafés and a relaxed island pace.",
              )}
            </p>
          </div>
        </div>

        {explore.length > 0 ? (
          <div className="expGrid">
            {explore.map((item) => (
              <article className="expCard" key={item.id}>
                {item.image_url && (
                  <img
                    className="expCardImg"
                    src={item.image_url}
                    alt={item.title}
                  />
                )}
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        ) : (
          <div className="expGrid">
            <article className="expCard">
              <h3>Beaches</h3>
              <p>
                Soft white sand and calm lagoon water, minutes from the centre.
              </p>
            </article>
            <article className="expCard">
              <h3>Snorkeling</h3>
              <p>
                Reefs teeming with fish, turtles and coral just off the island.
              </p>
            </article>
            <article className="expCard">
              <h3>Sandbank</h3>
              <p>A pristine strip of sand in the middle of the atoll.</p>
            </article>
            <article className="expCard">
              <h3>Island Hops</h3>
              <p>Rasdhoo, Mathiveri and Ukulhas are a short boat ride away.</p>
            </article>
            <article className="expCard">
              <h3>Fishing</h3>
              <p>Traditional sunset fishing with the local crew.</p>
            </article>
            <article className="expCard">
              <h3>Sunset</h3>
              <p>Golden-hour cruises and dolphin spotting.</p>
            </article>
          </div>
        )}
      </section>

      {/* ── Gallery ──────────────────────────────────────────── */}
      <section className="section" id="gallery">
        <div className="sectionTitle">
          <h2>THODDOO MOMENTS</h2>
          <span />
        </div>
        <GalleryGrid items={galleryItems} />
      </section>

      {/* ── Find us / contact ────────────────────────────────── */}
      <section className="section featureGrid" id="contact">
        <article className="feature find">
          <div className="featureCopy">
            <h3>⌾ FIND US IN THODDOO</h3>
            <p>
              Visit our beachside centre just steps from the sea. Our friendly
              team is here to help plan your day.
            </p>
            <p className="info">⌖ {addressLine}</p>
            <p className="info">◉ {phoneText}</p>
            <a
              href="https://maps.google.com/?q=Anboofannu+magu+Thoddoo+MV+09010"
              target="_blank"
              rel="noreferrer"
            >
              GET DIRECTIONS ↗
            </a>
          </div>
          <img
            src="/images/thoddoo/island-hopping.jpg"
            alt="Thoddoo Marine centre in Thoddoo"
          />
        </article>

        <article className="feature moments">
          <h3>▣ STAY CONNECTED</h3>
          <p>Questions or custom trips? Message us any time on WhatsApp.</p>
          <div className="miniGallery">
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
        </article>
      </section>

      <section className="cta">
        <div>
          <h2>READY FOR YOUR NEXT ADVENTURE?</h2>
          <p>Book your experience now — our team confirms on WhatsApp.</p>
        </div>
        <a href={whatsapp} target="_blank" rel="noreferrer">
          ◉ BOOK NOW VIA WHATSAPP
          <br />
          <b>{phoneText}</b>
        </a>
      </section>

      <Footer />
    </main>
  );
}
