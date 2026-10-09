import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import Header from "../../components/Header";
import Footer from "../../components/Footer";
import AgentBookingClient from "./AgentBookingClient";

interface AgentLink {
  agent_name: string;
  expires_at: string;
  activities: Array<{
    id: string;
    name: string;
    category: string | null;
    location: string | null;
    duration_minutes: number | null;
    image: string | null;
  }>;
}

// Unguessable tokens only; nothing here is worth indexing.
export const metadata: Metadata = {
  title: "Confirm Your Trip | Thoddoo Marine Thoddoo",
  description:
    "Confirm your Thoddoo Marine trip, add each participant and sign the consent & liability waiver.",
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ token: string }>;
}

export default async function AgentBookingPage({ params }: Props) {
  const { token } = await params;
  const supabase = await createClient();

  // get_agent_booking_link is the ONLY guest-facing read for this flow and it
  // selects no price column — see migration 076. Do not "helpfully" add
  // getPublicActivityBySlug here: any price that reaches this page reaches the
  // guest, which is exactly what an agent-quoted rate must never do.
  const { data, error } = await supabase.rpc("get_agent_booking_link", {
    p_token: token,
  });

  const failure =
    error || !data || typeof data !== "object" || "error" in data
      ? ((data as { message?: string } | null)?.message ||
          "This booking link is not valid.") as string
      : null;

  if (failure) {
    return (
      <main>
        <Header />
        <section className="walkinHero">
          <div className="walkinHeroTitle">
            <span className="walkinBadge">BOOKING LINK</span>
            <h1>Link unavailable</h1>
          </div>
        </section>
        <section className="walkinBody">
          <div className="walkinCard">
            <div className="walkinCardHead">
              <h2>This link can&apos;t be used</h2>
              <p>{failure}</p>
            </div>
            <div className="walkinMockButtons">
              <a
                href="https://wa.me/9609472110?text=Hi!%20I%20have%20an%20agent%20booking%20link%20that%20is%20not%20working."
                target="_blank"
                rel="noreferrer"
                className="walkinSubmit"
              >
                Message us on WhatsApp
              </a>
            </div>
          </div>
        </section>
        <Footer />
      </main>
    );
  }

  const link = data as unknown as AgentLink;

  return (
    <main>
      <Header />

      <section className="walkinHero">
        <div className="walkinHeroTitle">
          <span className="walkinBadge">YOUR AGENT BOOKING</span>
          <h1>{link.activities.length === 1 ? link.activities[0].name : "Your trip"}</h1>
          <p className="walkinLocation">
            Booked through {link.agent_name}
            {link.activities.length === 1 && link.activities[0].location
              ? ` · ${link.activities[0].location}`
              : ""}
          </p>
        </div>
        {/* No price block here on purpose — see the note on the RPC above. */}
        <div className="walkinHeroPrice agentRateNote">
          <strong>Rate confirmed</strong>
          <span>Your agent has already quoted this trip</span>
        </div>
      </section>

      <section className="walkinBody">
        <AgentBookingClient
          token={token}
          agentName={link.agent_name}
          activities={link.activities.map((a) => ({
            id: String(a.id),
            name: String(a.name || ""),
            category: a.category ? String(a.category) : "",
            location: a.location ? String(a.location) : "",
            durationMinutes: Number(a.duration_minutes) || 0,
            image: a.image ? String(a.image) : "",
          }))}
        />
      </section>

      <Footer />
    </main>
  );
}