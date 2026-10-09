import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { fmtDateLong } from "@/lib/format";
import RentalAgreementClient from "./RentalAgreementClient";

interface RentalData {
  id: string;
  equipment: {
    name: string;
    asset_number: string;
    category: string;
    description: string | null;
  };
  checkout_condition: string;
  checked_out_at: string;
  expected_return_at: string;
  rental_charge_cents: number;
  deposit_cents: number;
  currency: string;
  status: string;
}

interface RentalConsent {
  id: string;
  activity_name: string;
  guest_name: string;
  email: string | null;
  is_minor: boolean;
  date_of_birth: string | null;
  status: string;
  signed_at: string | null;
  consent_version: string | null;
  consent_text: string | null;
}

export const metadata: Metadata = {
  title: "Equipment Rental Agreement | Thoddoo Marine Excursion",
  description:
    "Review and sign your equipment rental agreement for Thoddoo Marine Excursion Centre in Thoddoo, Maldives.",
};

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function RentalPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_rental_by_token", {
    p_token: token,
  });

  if (error || !data || (typeof data === "object" && "error" in data)) {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: 480,
            background: "#fff",
            borderRadius: 18,
            padding: "3rem 2rem",
            boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
          }}
        >
          <h1 style={{ color: "var(--navy)", fontSize: "1.6rem" }}>
            Rental Agreement Not Found
          </h1>
          <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: "0.5rem" }}>
            This rental agreement link is invalid or has expired. Please
            contact Thoddoo Marine Excursion for assistance.
          </p>
        </div>
      </main>
    );
  }

  const rental = data as unknown as RentalData;

  // Consent & liability waiver: lazily create for legacy rentals and load.
  // New rentals get their consent at checkout, so this is a no-op there.
  let consentData: RentalConsent | null = null;
  let consentError: string | null = null;
  try {
    await supabase.rpc("ensure_rental_consent_by_token", { p_token: token });
    const { data: consent, error: consentRpcError } = await supabase.rpc(
      "get_consent_form_by_token",
      { p_token: token },
    );
    if (!consentRpcError && consent && !(typeof consent === "object" && "error" in consent)) {
      consentData = consent as unknown as RentalConsent;
    }
  } catch {
    consentError = "consent_unavailable";
  }

  if (consentData?.status === "signed") {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: 480,
            background: "#fff",
            borderRadius: 18,
            padding: "3rem 2rem",
            boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#d4edda",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.2rem",
              fontSize: "1.6rem",
            }}
          >
            &#10003;
          </div>
          <h1 style={{ color: "var(--navy)", fontSize: "1.6rem" }}>
            Consent & Agreement Already Signed
          </h1>
          <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: "0.5rem" }}>
            The consent & liability form for this rental was signed
            {consentData.signed_at
              ? ` on ${fmtDateLong(consentData.signed_at)}`
              : ""}
            . No further action is required.
          </p>
        </div>
      </main>
    );
  }

  if (consentData?.status === "voided") {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: 480,
            background: "#fff",
            borderRadius: 18,
            padding: "3rem 2rem",
            boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#f8d7da",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.2rem",
              fontSize: "1.6rem",
            }}
          >
            &#10007;
          </div>
          <h1 style={{ color: "var(--navy)", fontSize: "1.6rem" }}>
            Consent Form Voided
          </h1>
          <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: "0.5rem" }}>
            This consent form has been voided. Please contact Thoddoo Marine
            Watersports to obtain a new form.
          </p>
        </div>
      </main>
    );
  }

  if (rental.status === "returned") {
    return (
      <main
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        <div
          style={{
            textAlign: "center",
            maxWidth: 480,
            background: "#fff",
            borderRadius: 18,
            padding: "3rem 2rem",
            boxShadow: "0 4px 24px rgba(7,57,111,0.08)",
          }}
        >
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "#d4edda",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 1.2rem",
              fontSize: "1.6rem",
            }}
          >
            &#10003;
          </div>
          <h1 style={{ color: "var(--navy)", fontSize: "1.6rem" }}>
            Equipment Returned
          </h1>
          <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: "0.5rem" }}>
            This equipment has been returned. Thank you for using Thoddoo Marine
            Watersports.
          </p>
        </div>
      </main>
    );
  }

  // Check if current session user is staff
  let isStaff = false;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase
        .from("staff_profiles")
        .select("id")
        .eq("user_id", user.id)
        .single();
      isStaff = !!profile;
    }
  } catch {
    isStaff = false;
  }

  return (
    <RentalAgreementClient
      rental={rental}
      isStaff={isStaff}
      rentalId={rental.id}
      token={token}
      consent={consentData}
      consentError={consentError}
    />
  );
}
