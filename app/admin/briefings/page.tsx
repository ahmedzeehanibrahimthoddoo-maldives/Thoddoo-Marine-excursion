import Link from "next/link";
import { allBriefings } from "@/lib/briefings";

export const metadata = { title: "Safety Briefing Cards | Thoddoo Marine Admin" };

export default function BriefingsPage() {
  const cards = allBriefings();
  return (
    <div className="adminPage">
      <div className="adminPageHeader">
        <h1>Safety Briefing Cards</h1>
        <p className="adminPageSub">
          Printable, letterheaded briefing cards for all activities. Print one and go through it with the guest — it
          covers the activity rules plus general safety and the consent &amp; liability acknowledgment.
        </p>
      </div>

      <div className="statsGrid opsStats" style={{ marginBottom: 18 }}>
        <div className="statCard"><span className="statValue">{cards.length}</span><span className="statLabel">Activities</span></div>
        <div className="statCard"><span className="statValue">% 100</span><span className="statLabel">All activities covered</span></div>
      </div>

      <div className="briefingGrid">
        {cards.map((c) => (
          <Link key={c.slug} href={`/admin/briefings/${c.slug}`} className="briefingCard">
            <div className="briefingCardHead">
              <h2>{c.name}</h2>
              <span className="badge badge-trip-ready">{c.category}</span>
            </div>
            <p>{c.overview}</p>
            <div className="briefingCardMeta">
              <span>⏱ {c.duration}</span>
              <span>📋 {c.safety.length + 8} safety points</span>
            </div>
            <div className="briefingCardAction">Open &amp; print →</div>
          </Link>
        ))}
      </div>
    </div>
  );
}