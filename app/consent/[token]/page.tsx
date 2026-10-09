import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { fmtDateLong } from "@/lib/format";
import ConsentFormClient from "./ConsentFormClient";

export const metadata: Metadata = {
  title: "Activity Consent Form | Thoddoo Marine Excursion",
  description:
    "Complete your activity participation consent form for Thoddoo Marine Excursion Centre in Thoddoo, Maldives.",
};

interface ConsentFormData {
  id: string;
  activity_name: string;
  booking_ref: string | null;
  guest_name: string;
  email: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  passport_number: string | null;
  phone: string | null;
  hotel: string | null;
  room_number: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  swimming_ability: string | null;
  medical_conditions: string | null;
  allergies: string | null;
  medications: string | null;
  recent_injuries: string | null;
  is_pregnant: boolean;
  safety_briefing_confirmed: boolean;
  life_jacket_confirmed: boolean;
  risk_acknowledged: boolean;
  photo_consent: boolean;
  signature_data_url: string | null;
  witness_name: string | null;
  witness_signature_data_url: string | null;
  parent_guardian_name: string | null;
  parent_guardian_signature_data_url: string | null;
  is_minor: boolean;
  status: string;
  signed_at: string | null;
  consent_version: string | null;
  consent_text: string | null;
}

interface PageProps {
  params: Promise<{ token: string }>;
}

export default async function ConsentPage({ params }: PageProps) {
  const { token } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_consent_form_by_token", {
    p_token: token,
  });

  if (error || !data || typeof data === "object" && "error" in data) {
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
            Form Not Found
          </h1>
          <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: "0.5rem" }}>
            This consent form link is invalid or has expired. Please contact
            Thoddoo Marine Excursion for assistance.
          </p>
        </div>
      </main>
    );
  }

  const form = data as unknown as ConsentFormData;

  if (form.status === "signed") {
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
            Consent Form Already Signed
          </h1>
          <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: "0.5rem" }}>
            This consent form was signed on{" "}
            {fmtDateLong(form.signed_at)}
            . No further action is required.
          </p>
          <p style={{ color: "var(--ink)", opacity: 0.6, marginTop: "0.8rem", fontSize: "0.85rem" }}>
            Please ask Thoddoo Marine staff if you require a PDF copy.
          </p>
        </div>
      </main>
    );
  }

  if (form.status === "voided") {
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
            Form Voided
          </h1>
          <p style={{ color: "var(--ink)", opacity: 0.7, marginTop: "0.5rem" }}>
            This consent form has been voided. Please contact Thoddoo Marine
            Watersports to obtain a new form.
          </p>
        </div>
      </main>
    );
  }

  return <ConsentFormClient consentForm={form} token={token} />;
}
