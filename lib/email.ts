/**
 * Email validation, mirrored from the database.
 *
 * public.is_valid_email() (migration 072) is the rule that actually decides
 * whether a booking can be saved: require_customer_email_before_booking calls it
 * on every booking INSERT, and submit_public_booking_group_v2 calls it on
 * p_guest_email. The forms therefore check the guest's address BEFORE submitting,
 * because a mismatch between this regex and the SQL one only shows up as a
 * database error the guest cannot act on — "A valid email is required for every
 * booking" is exactly the message that made the walk-in flow look broken.
 *
 * tests/features.test.ts pins this regex against the SQL in the same commit that
 * can change either side.
 */

export const EMAIL_RE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function isValidEmail(value: string | null | undefined): boolean {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed.length > 254) return false;
  return EMAIL_RE.test(trimmed.toLowerCase());
}

/** The message the guest sees. Says why, not just "invalid". */
export const EMAIL_REQUIRED_MESSAGE =
  "Please enter a valid email address so we can send your invoice and safety waiver.";