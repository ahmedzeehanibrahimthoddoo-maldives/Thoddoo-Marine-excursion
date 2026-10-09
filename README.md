# Thoddoo Marine Excursion Centre

Responsive Next.js homepage matching the approved Thoddoo Marine visual direction.

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000

## Deploy to Vercel

```bash
npm run build        # local production build
npx vercel --prod    # deploy to production
npm run test         # run unit tests (node:test via tsx)
npm run test:verify  # run non-interactive verification scripts
```

The project is linked to the `thoddoo-marine-website` project on Vercel
(https://thoddoo-marine-website.vercel.app).

## Single landing page

The public site is **one static landing page** (`app/page.tsx`) listing every
activity, with booking submitted straight from the browser into the PMS (Supabase
RPC). There are no other public marketing routes.

The landing page is `force-static`, so it is prerendered at build time and served
from Vercel's edge cache (no function execution). It cannot hit any per-request
CPU limit on the Vercel free (Hobby) tier.

Trade-offs:

- The landing page is built at deploy time. CMS edits write to Supabase and call
  `revalidatePath("/")`, but a `force-static` page cannot be revalidated —
  **redeploy (`npx vercel --prod`) to publish CMS changes**.
- Dynamic routes (`/admin/**`, `/login/**`, `/checkin/<token>`,
  `/consent/<token>`, `/rental/<token>`) run as standard Next.js server functions
  and are not subject to Cloudflare's 10 ms free-tier CPU cap.

Old URLs (`/adventures`, `/watersports`, `/about`, `/gallery`, `/contact`,
`/explore-thoddoo`) 308-redirect to the matching landing-page anchor.

Environment variables (set in the Vercel project):

- `NEXT_PUBLIC_SUPABASE_URL=<https://<project>.supabase.co>`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable key>`
- `NEXT_PUBLIC_SITE_URL=<https://...>`
- `SUPABASE_SERVICE_ROLE_KEY=<service role key>` (server-only, never exposed)
- `CRON_SECRET=<random string>` guarding `GET /api/sync/finance`
- `RESEND_API_KEY`, `RESEND_FROM`, `RESEND_REPLY_TO` for booking email

## Zoho Sheet setup (finance ledger sync)

The admin **Sync Zoho Sheet** button on Expenses / Other Income, and the daily
cron, pull the ledger from a Zoho Sheet workbook into `expenses` /
`other_income`. See `.env.example` for the full list of required variables.

Create the workbook with two tabs, each with these headers in row 1
(order-insensitive):

```
ID | Date | Title | Category | Amount | Currency | Vendor | Notes
```

Leave `ID` blank on new rows — the sync generates one and writes it back into
the cell. `Amount` is in major units (`185` or `185.50`) and `Currency` is
`USD` or `MVR` per row, with no automatic conversion.

To get credentials:

1. Register a **Server-based Application** at
   <https://api-console.zoho.com> and note the Client ID and Client Secret.
2. Build the consent URL and open it as a signed-in Zoho user:
   `https://accounts.zoho.com/oauth/v2/auth?response_type=code&client_id=<ID>&scope=ZohoSheet.dataAPI.READ,ZohoSheet.dataAPI.UPDATE&redirect_uri=<registered-uri>&access_type=offline&prompt=consent`
3. Exchange the returned `code` at
   `POST https://accounts.zoho.com/oauth/v2/token`
   (`grant_type=authorization_code`) for an `access_token` and a
   `refresh_token`. The refresh token is what the server stores; access tokens
   are refreshed from it automatically.
4. Set `FINANCE_WORKBOOK_ID` to the `resource_id` in the sheet URL, and give
   that Zoho account edit access to the workbook.

The adapter lives in `lib/sheets.ts` (`parseA1Range`, `readSheetRange`,
`writeSheetRange`) and is the only provider-specific file in the repo.

## Day-end report (23:00 Maldives time)

`GET /api/cron/day-end` emails the booking mailbox one summary every night:
today's sales by source (including per-agent totals), trips by activity, cash
collected with expenses and a profit estimate, outstanding balances, and
tomorrow's manifest with guest names, pax and outstanding waivers.

- Cron in `vercel.json` is `0 18 * * *` — Vercel schedules in UTC, and
  Maldives is UTC+5, so 18:00 UTC is 23:00 local. Day bounds are built as
  `+05:00` strings, never from the server's zone.
- It runs with **no staff session**, so it reads as service role
  (`SUPABASE_SERVICE_ROLE_KEY`). It queries the tables directly instead of
  `get_tomorrow_bookings()`, which is gated on `current_staff_role()`.
- Both cron routes answer **401** while `CRON_SECRET` is unset, and the day-end
  route returns `missing_service_key` without the service-role key.
- `?date=YYYY-MM-DD` re-renders a past day (e.g. to re-send yesterday);
  `?preview=1` returns the subject and plain-text body **without sending**:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" \
    "https://thoddoomarineexcursion.com/api/cron/day-end?preview=1"
  ```
- Recipient: `DAYEND_REPORT_TO`, else `RESEND_REPLY_TO`, else
  `booking@thoddoomarineexcursion.com`. A failed section is listed in the mail
  rather than dropping the whole report, so a bad column can't cost the office
  the night's numbers.

## Current booking contacts
- WhatsApp: +960 947 2110
- WhatsApp: +62 813 5374 8031

## Notes
Prices are based on the photographed Thoddoo Marine boards supplied as reference. Confirm the final master price list before production launch because some older/newer boards show differences for a few activities.
