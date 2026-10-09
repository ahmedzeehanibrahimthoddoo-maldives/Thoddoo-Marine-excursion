export interface ActivityBriefing {
  slug: string;
  name: string;
  category: string;
  duration: string;
  overview: string;
  included: string[];
  bring: string[];
  safety: string[];
  requirements: string[];
}

export const GENERAL_SAFETY: string[] = [
  "Listen to your guide and follow all instructions for the full duration of the activity.",
  "Wear the provided life jacket / buoyancy aid at all times — no exceptions.",
  "Stay within the activity area and with the group; never drift away from your guide.",
  "Tell staff immediately if you feel unwell, tired, cold or unsure at any point.",
  "Do not remove or tamper with any equipment, safety lines or engine parts.",
  "Protective sunscreen, re-application and hydration are your responsibility.",
  "Follow the exact meeting point and time given; late arrival may shorten the session.",
  "Phones and valuables stay on the shore or in a waterproof case — at your own risk.",
];

export const CONSENT_LIABILITY_ACK: string[] = [
  "The guest confirms they have been personally briefed on this safety card before the activity begins.",
  "The guest acknowledges having read and signed the Thoddoo Marine Activity Consent & Liability form for this activity.",
  "The guest understands that damages caused to vessels, engines or equipment during the session are chargeable, including jet-ski engine damage from ignoring warning alarms.",
  "The guest accepts responsibility for personal belongings and for following the safety rules above.",
];

const BRIEFINGS: Record<string, ActivityBriefing> = {
  "banana-ride": {
    slug: "banana-ride",
    name: "Banana Ride",
    category: "Towed Watersport",
    duration: "15 minutes",
    overview:
      "A fun, bumpy ride behind our speedboat on an inflated banana. Bounce and splash across the lagoon as the captain powers through the waves.",
    included: ["Life jacket", "Banana tow tube", "Speedboat + safety crew"],
    bring: ["Swimwear", "Towel", "Sunscreen", "GoPro (waterproofed)"],
    safety: [
      "Hold the banana handles securely at all times and keep your feet inside the tube.",
      "The ride accelerates and jumps on waves — do not stand up or switch seats during the tow.",
      "Look forward; do not grip the person in front of you.",
      "If you fall off, raise one hand and stay still — the boat will circle back to collect you.",
      "Minimum age 6; children ride seated between adults under direct guidance.",
    ],
    requirements: [
      "Comfortable swimming and confidence in open water.",
      "No recent neck/back injuries, pregnancy, seizures or heart conditions.",
    ],
  },
  "dolphin-cruise": {
    slug: "dolphin-cruise",
    name: "Dolphin Cruise",
    category: "Excursion",
    duration: "2 hours",
    overview:
      "Cruise through Ari Atoll in search of wild spinner dolphins at sunset. Dolphins are wild animals and sightings are seasonal — not guaranteed.",
    included: ["Speedboat / dhoni", "Captain + guide", "Water & soft drinks", "Dry cover for bags"],
    bring: ["Comfortable clothes", "Jacket or light layer (breeze)", "Camera", "Sunscreen"],
    safety: [
      "Remain seated while the boat is moving; keep hands and arms inside at all times.",
      "Hold the rails when moving around the boat for a different view.",
      "Never enter the water during the cruise unless the captain says it is safe and stops the boat.",
      "Do not chase or approach dolphins — the captain approaches respectfully and legally.",
      "Children must be supervised by a parent/guardian at all times on board.",
    ],
    requirements: [
      "Suitable for all ages — no swimming skill required.",
      "Advise staff of seasickness susceptibility for a better seat.",
    ],
  },
  funtube: {
    slug: "funtube",
    name: "Funtube",
    category: "Towed Watersport",
    duration: "15 minutes",
    overview:
      "Ride a fast, inflated towable behind our boat — hold on tight while it bounces and banks across the wake.",
    included: ["Life jacket", "Funtube", "Speedboat + safety crew"],
    bring: ["Swimwear", "Towel", "Sunscreen", "Secure strap for glasses"],
    safety: [
      "Grip the side handles firmly and keep knees bent and body loose to absorb bumps.",
      "The tube can bounce high off waves — always keep your teeth away from the tube.",
      "Stay seated on the tube; never stand up or swap positions mid-ride.",
      "On a fall, release the handles, stay calm and float; the crew will retrieve you within seconds.",
      "One rider recommended for speed rides; two riders must be similar weight and size.",
    ],
    requirements: [
      "Strong swimmer and comfortable with high-speed towing.",
      "No neck/back injuries, pregnancy, seizures or heart conditions.",
    ],
  },
  "jet-ski": {
    slug: "jet-ski",
    name: "Jet Ski",
    category: "Watersport",
    duration: "30 minutes",
    overview:
      "Ride a jet ski across the turquoise Thoddoo Lagoon. Solo driving or free-ride with a guide leading the way.",
    included: ["Jet ski", "Life jacket", "Safety briefing", "Guide escort"],
    bring: ["Swimwear", "Towel", "Sunscreen", "Waterproof phone pouch"],
    safety: [
      "Important — engine alarm: if the warning alarm lights or sounds, STOP immediately and notify staff. Continuing to ride with an active alarm causes engine damage which is charged to the guest.",
      "Do not exceed the briefing area or speed limits; always follow the leading guide.",
      "Keep a safe distance (minimum 30 m) from swimmers, boats, and reef.",
      "Two-up riding only if both riders can swim and the driver is experienced.",
      "Always leave the engine off and clear the craft when falling off — never attempt to restart while in the water.",
      "If the jet ski capsizes, it must be flipped back over clockwise only — never rotate it anti-clockwise or flip it onto its other side, or the engine will take on water and be damaged.",
      "Reckless riding, jumping waves or abusing the machine stops the session immediately and risks damage charges.",
      "A USD 50 capsize / rescue fee applies if staff must recover you or the jet ski during the session.",
      "If the jet ski is damaged or damaged beyond repair in an incident, the repair cost (or replacement value) is charged based on the damage assessment.",
    ],
    requirements: [
      "Strong swimmer; confident in open water.",
      "Minimum driver weight ~45 kg; minimum age 16 to drive solo (8+ as passenger).",
      "No pregnancy, seizures, heart conditions or recent surgery.",
    ],
  },
  kayak: {
    slug: "kayak",
    name: "Kayak",
    category: "Watersport",
    duration: "1 hour",
    overview:
      "Paddle at your own pace through the calm lagoon of Thoddoo. Single or double kayaks, with a guided option.",
    included: ["Kayak + paddle", "Life jacket", "Dry bag (small)"],
    bring: ["Swimwear", "Towel", "Sunscreen", "Hat", "Water"],
    safety: [
      "Always carry the paddle on board and never point it at other paddlers.",
      "Stay upright and sit centred; sudden leaning or standing capsizes the kayak.",
      "Stay within the marked lagoon area and away from the channel and boat traffic.",
      "If you capsize, stay with the kayak and raise one hand — the guide will come to you.",
      "A USD 50 capsize / rescue fee applies if staff must recover you or the kayak during the session.",
      "If the kayak or paddle is damaged in an incident, the repair cost (or replacement value) is charged based on the damage assessment, including for glass / transparent kayaks.",
      "Do not paddle into current against boats, and always point the bow into oncoming waves.",
      "Children under 12 ride in a double kayak with an adult.",
    ],
    requirements: [
      "Basic swimming ability preferred.",
      "Some upper-body fitness helps; kayaks can be heavy to steer in wind.",
    ],
  },
  "manta-nurse-shark-combo": {
    slug: "manta-nurse-shark-combo",
    name: "Manta + Nurse Shark Combo",
    category: "Snorkeling",
    duration: "3 hours",
    overview:
      "The ultimate atoll combo — snorkel with majestic manta rays and encounter nurse sharks at Gangehi Reef.",
    included: ["Boat + crew", "Mask, snorkel & fins", "Life jacket / float", "Guided snorkel"],
    bring: ["Swimwear", "Towel", "Sunscreen (reef-safe)", "GoPro"],
    safety: [
      "Snorkel near the surface; never dive below without the guide pointing out that it is safe.",
      "Look but do not touch — avoid contact with mantas and sharks; keep a respectful distance.",
      "Follow the surface marker and stay close to the guide in a tight group.",
      "Wear the float or life jacket if you are not a confident swimmer.",
      "Conserve energy in current — rest on the rope/float and signal the guide if tired.",
    ],
    requirements: [
      "Confident snorkeler/swimmer; moderate fitness.",
      "No heart conditions or respiratory issues; advise of any medical conditions to crew.",
    ],
  },
  "manta-ray-snorkeling": {
    slug: "manta-ray-snorkeling",
    name: "Manta Ray Snorkeling",
    category: "Snorkeling",
    duration: "2 hours",
    overview:
      "Snorkel in the crystal-clear waters of Ari Atoll where gentle manta rays glide by. Sightings are seasonal and guided by local knowledge.",
    included: ["Boat + crew", "Mask, snorkel & fins", "Float / life jacket", "Guided snorkel"],
    bring: ["Swimwear", "Towel", "Reef-safe sunscreen", "GoPro"],
    safety: [
      "Enter the water from the boat only at the guide's signal — mantas may be feeding nearby.",
      "Stay at the surface and do not chase, ride or touch the mantas.",
      "Keep a group distance of ~3 m between snorkellers to avoid fins touching others.",
      "If the manta approaches you, stay perfectly still and let it pass.",
      "Never snorkel alone or drift from the group and the marker buoy.",
    ],
    requirements: [
      "Confident snorkeler/swimmer.",
      "Advise crew of any respiratory or cardiac conditions before the trip.",
    ],
  },
  "nurse-shark-adventure": {
    slug: "nurse-shark-adventure",
    name: "Nurse Shark Adventure",
    category: "Snorkeling",
    duration: "2 hours",
    overview:
      "Encounter harmless nurse sharks up close at Gangehi Reef with our expert local guides.",
    included: ["Boat + crew", "Mask, snorkel & fins", "Life jacket / float", "Guided snorkel"],
    bring: ["Swimwear", "Towel", "Reef-safe sunscreen"],
    safety: [
      "Remain calm and slow in the water; do not make sudden movements around the sharks.",
      "Never feed, chase, corner or attempt to touch the sharks.",
      "Keep hands to your chest and legs in a gentle flutter — nurse sharks are curious but docile.",
      "If a shark approaches too closely, stop moving and let it pass.",
      "Exit the water on the guide's signal; the area is a protected reef.",
    ],
    requirements: [
      "Comfortable in open water around marine life.",
      "Basic swimming ability; float provided for non-swimmers.",
    ],
  },
  "private-boat-hire": {
    slug: "private-boat-hire",
    name: "Private Boat Hire",
    category: "Private Trip",
    duration: "Custom / charter",
    overview:
      "Private speedboat or dhoni charter between islands, sandbanks and reefs, with a captain and itinerary agreed with you.",
    included: ["Boat + captain", "Crew", "Fuel for agreed itinerary"],
    bring: ["Personal items", "Sun protection", "Water", "Dry bag for luggage"],
    safety: [
      "Remain seated while the boat is underway; retrieve items only when stopped.",
      "Life jackets are on board — wear one when requested by the captain or during rough sea, children always on deck.",
      "Board and alight only at moorings and jetties the captain chooses; never disembark onto reef or sandbars without instruction.",
      "Stay with the boat; do not leave the group on land or reef for longer than agreed.",
      "Advise the captain of any swim stops so the crew can anchor safely away from current.",
    ],
    requirements: [
      "Suitable for all ages; no swimming required for riding, but supervision rules apply.",
      "Weather can change — the captain reserves the right to adjust the route for safety.",
    ],
  },
  "sandbank-trip": {
    slug: "sandbank-trip",
    name: "Sandbank Trip",
    category: "Excursion",
    duration: "2 hours",
    overview:
      "Escape to a pristine sandbank surrounded by turquoise water and white sand — swim, relax and photograph the Maldives.",
    included: ["Boat transfer", "Sandbank stop", "Water & soft drinks"],
    bring: ["Swimwear", "Towel", "Sunscreen", "Hat", "Camera"],
    safety: [
      "Swim only within the area closest to the sandbank where the crew stays; the drop-off deepens quickly.",
      "Currents near sandbanks can be stronger than they look — stay in waist-deep water unless guided.",
      "Keep an eye on children at all times near the waterline.",
      "Return to the boat when called; departures are timed to the tide.",
      "Take all belongings back to the boat with you — sand is not private.",
    ],
    requirements: [
      "Suitable for all ages.",
      "Basic swimming sense for in-water time.",
    ],
  },
  "stand-up-paddleboard": {
    slug: "stand-up-paddleboard",
    name: "SUP / Stand-Up Paddleboard",
    category: "Watersport",
    duration: "1 hour",
    overview:
      "Stand up and paddle across the glassy lagoon at your own pace — quiet, scenic and full-body.",
    included: ["SUP board + paddle", "Life jacket", "Leash", "Briefing"],
    bring: ["Swimwear", "Towel", "Sunscreen", "Water"],
    safety: [
      "Always wear the ankle leash — it keeps the board attached if you fall.",
      "Start kneeling; stand with feet shoulder-width and knees slightly bent.",
      "Look where you want to go, paddle symmetrically on both sides to stay straight.",
      "Fall away from the board to avoid hits; hold the paddle flat on the water to stay balanced.",
      "Stay in the lagoon and away from boat channels and jet-skis.",
    ],
    requirements: [
      "Basic balance and swimming water comfort.",
      "No recent ankle/knee injuries — leash forces on ankles.",
    ],
  },
  "sup-with-scooter": {
    slug: "sup-with-scooter",
    name: "SUP with Scooter",
    category: "Watersport",
    duration: "1.5 hours",
    overview:
      "Combine stand-up paddleboarding with an underwater scooter — paddle across the lagoon, then glide beneath the surface.",
    included: ["SUP board", "Underwater scooter", "Mask/snorkel", "Life jackets + briefing"],
    bring: ["Swimwear", "Towel", "Sunscreen", "Waterproof camera"],
    safety: [
      "Use the scooter only in the guided area with the staff member present.",
      "Never ride the scooter toward swimmers, reef or shallows.",
      "Follow the SUP rules while paddling; mount the scooter from the board only.",
      "Keep the scooter's propeller clear of loose straps, hair and body.",
      "End the session if you feel cold, tired or breathless.",
    ],
    requirements: [
      "Comfortable swimming and previous SUP basic skill preferred.",
      "No respiratory or cardiac conditions — scooter use adds exertion.",
    ],
  },
  "turtle-reef-snorkeling": {
    slug: "turtle-reef-snorkeling",
    name: "Turtle Reef Snorkeling",
    category: "Snorkeling",
    duration: "2 hours",
    overview:
      "Snorkel over vibrant reefs where green sea turtles are commonly spotted, guided by local crew.",
    included: ["Boat + crew", "Mask, snorkel & fins", "Life jacket / float", "Guided snorkel"],
    bring: ["Swimwear", "Towel", "Reef-safe sunscreen", "GoPro"],
    safety: [
      "Stay on the surface of the reef and never stand on or touch the coral.",
      "Observe turtles and reef life from a distance without chasing or touching.",
      "Keep a gentle, relaxed fin kick to protect the reef and avoid stirring sand.",
      "Wear the float if not a strong swimmer; the guide keeps a close group.",
      "Conserve air — breathe steadily through the snorkel and lift your head to check position.",
    ],
    requirements: [
      "Confident snorkeler/swimmer.",
      "Advise crew of any respiratory or cardiac conditions.",
    ],
  },
  wakeboarding: {
    slug: "wakeboarding",
    name: "Wakeboarding",
    category: "Towed Watersport",
    duration: "15–20 minutes (per session)",
    overview:
      "Ride the wake on a wakeboard behind our boat — learn the deep-water start with a trained driver and spotter.",
    included: ["Wakeboard + bindings", "Life jacket", "Boat + driver + spotter", "Coaching"],
    bring: ["Swimwear", "Towel", "Sunscreen", "Secure glasses strap"],
    safety: [
      "The driver and spotter control the boat — obey hand signals exactly.",
      "Start in the water with the board between your legs; let the boat pull you up slowly.",
      "Relax your arms and bend your knees; do not hold the handle with locked arms.",
      "Signal the driver by tapping off; never wrap the rope around any body part.",
      "Fall backwards into the water, release the handle, and do not re-ride the wake area alone.",
    ],
    requirements: [
      "Strong swimmer; moderate strength and fitness.",
      "No neck/back injuries, pregnancy, seizures or heart conditions.",
    ],
  },
  "water-skiing": {
    slug: "water-skiing",
    name: "Water Skiing",
    category: "Towed Watersport",
    duration: "15–20 minutes (per session)",
    overview:
      "Glide across the lagoon on water skis behind one of our boats — a classic towed watersport for all levels.",
    included: ["Water skis", "Life jacket", "Boat + driver + spotter", "Coaching"],
    bring: ["Swimwear", "Towel", "Sunscreen"],
    safety: [
      "Skis are worn loose; let them fall off on a tumble — never resist.",
      "Keep the tips of the skis up when starting; stay in the crouch until you plane out.",
      "Do not look down or lean back — lean slightly forward as you rise.",
      "Signal falling by releasing the rope; get clear of the rope after falling.",
      "Only the handler touches the rope on the dock; swimmers stay clear of the prop.",
    ],
    requirements: [
      "Strong swimmer; average fitness and leg strength.",
      "No neck/back injuries, pregnancy, seizures or heart conditions.",
    ],
  },
};

export function getBriefing(slug?: string | null): ActivityBriefing | null {
  if (!slug) return null;
  return BRIEFINGS[slug] || null;
}

/** A sensible generic card for trips that do not map to a specific briefing. */
export const GENERIC_BRIEFING: ActivityBriefing = {
  slug: "generic",
  name: "Activity / Trip",
  category: "Guided Trip",
  duration: "As scheduled",
  overview:
    "A guided Thoddoo Marine trip. The exact itinerary is confirmed by your guide at the meeting point before departure.",
  included: ["Life jacket / buoyancy aid", "Briefing, guide & safety crew"],
  bring: ["Swimwear", "Towel", "Sunscreen", "Water"],
  safety: GENERAL_SAFETY,
  requirements: [
    "Follow your guide's instructions throughout the trip.",
    "Advise staff of any medical condition, pregnancy or reduced mobility before departure.",
  ],
};

export function allBriefings(): ActivityBriefing[] {
  return Object.values(BRIEFINGS);
}

export { BRIEFINGS };