# Walk-in Multi-Activity Wizard — Build Spec (for the NEXT session)

Target the LIVE walk-in page without breaking the current single-activity flow.
All work = tested increments. Every increment ends with: tests pass + `npx tsc --noEmit` clean + commit + push.

## Final UX (what we're building)

A guest who scans the walk-in QR goes through a **wizard** (not the current 1-form page):

1. **Pick activities** — up to 8. Each activity line also carries its OWN `booking_date` + `preferred_time` (different dates allowed per activity).
2. **Party + per-participant details** — total pax ≤ 50.
   - If total pax = 1 → lead is the only participant (name + phone).
   - If total pax > 1 → EVERY participant gets a row: `full_name`, `participant_type` (adult|child), `guardian_name` + `guardian_relationship` (required for children).
3. **Per-participant consent + signature** — CONSENT IS PER PARTICIPANT, not once per booking. Each participant individually signs the liability/consent form (children sign via guardian). This is THE core difference from v1.
4. **Success** — booking refs, "pay at counter" message.

## Backend contract to call (already shipped, do NOT modify backend)

### RPC: `submit_public_booking_group_v2` (anon, migration 060)
Params (all text/uuid/jsonb):
```
p_items                 JSONB   -- REQUIRED, array, 1..8 items
p_guest_name            TEXT    -- lead name
p_guest_phone           TEXT    -- lead phone
p_booking_date          TEXT    -- fallback date (per-item overrides)
p_preferred_time        TEXT    -- fallback time (per-item overrides)
p_adults                INT
p_children              INT
p_hotel_name            TEXT
p_room_number           TEXT
p_pickup_location       TEXT
p_special_requests      TEXT
p_guest_agreed          BOOLEAN
p_source                TEXT    -- 'walk_in'
```
Each item in `p_items`:
```
{
  "activity_id": "<uuid>",
  "pricing_option_label": "...",        // optional
  "booking_date": "YYYY-MM-DD",          // REQUIRED per item
  "preferred_time": "HH:MM" | "anytime", // optional per item
  "participants": [                       // required when party > 1
    {
      "full_name": "...",
      "participant_type": "adult"|"child",
      "guardian_name": "...",             // required if child
      "guardian_relationship": "..."      // required if child
    }
  ]
}
```
Returns JSON with `{ success, group_id, group_ref, guest_name, items:[{...booking...}], needs_per_participant_details, has_participants, source }`.

### RPC: `get_walkin_group_participants` (anon, migration 060)
Params: `(p_group_ref TEXT)` → returns participants list (each with `full_name`, `participant_type`, `guardian_name`, `guardian_relationship`, `choice_token`, `consent_status`).
- `choice_token` is a per-participant server-generated opaque key (the consent step uses it — NOT the booking ref).

### RPC: consent signing (existing, migration 036 chain)
Per-participant signing. Exact signature to confirm in the migration before building; the consent step currently in `WalkinConsentStep.tsx` calls the consent RPC — REUSE the same signing RPC but iterate per participant (one call per `choice_token`), not once per group.

## Sanitizer to reuse (already shipped, `lib/sanitize.ts`)
`sanitizeWalkinItemsV2(data)` — validates items array + per-participant rows + caps (8 items/50 pax). USE IT on the client before submitting.

## Wizard steps (client, files to create/rewrite)
Rewrite `app/walkin/[activitySlug]/WalkinBookingClient.tsx` (462 lines) →
- Step 1: activity(s) + per-item date/time.
- Step 2: party builder + per-participant rows.
- Step 3: per-participant consent + signature.
- Step 4: success.
Reuse `WalkinConsentStep.tsx`'s signature canvas, restyle to per-participant.

## Increments (each = tests + tsc + commit)
- **INCR-1**: Extend `WalkinBookingClient.tsx` to collect multiple activities w/ per-item date/time in state; add conformance test asserting the client calls `submit_public_booking_group_v2` with `p_items`.
- **INCR-2**: Party builder + per-participant row editor; conformance test that `sanitizeWalkinItemsV2` is invoked client-side.
- **INCR-3**: Per-participant consent step (iterate `choice_token`s); conformance test mirroring the existing consent-step file's `choice_token` usage.
- **INCR-4**: Success screen w/ group_ref + "pay at counter"; test asserts group_ref/needs_per_participant_details rendering.
- **INCR-5**: Full integration conformance + `npm test` + `npx tsc --noEmit` + manual `npx vercel --prod`.

## Conformance test conventions (mirror `tests/features.test.ts`)
- `readMigration("<filename>.sql")` for migration checks.
- `fs.readFileSync(path.resolve(__dirname, "../app/walkin/[activitySlug]/WalkinBookingClient.tsx"), "utf-8")` + `assert.match(client, /submit_public_booking_group_v2/)`.

## Done = fully usable gate
Green suite + tsc + the walk-in QR page lets a guest book multiple activities in one go, each participant signs individually, group_ref shown, "pay at counter" message. Then `npx vercel --prod`.

## Do NOT
- Modify migrations 059/060/036/010 backend.
- Regress the single-activity walk-in fallback path (keep v1 RPC call working as fallback).
