"use client";

import { useEffect, useState, useTransition, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { EMAIL_REQUIRED_MESSAGE, isValidEmail } from "@/lib/email";
import SignCanvas from "@/app/rental/[token]/SignCanvas";

interface CatalogItem {
  name: string;
  category?: string | null;
  description?: string | null;
  total_units?: number | null;
  free_units?: number | null;
}

interface BasketLine {
  name: string;
  qty: number;
}

interface SavedDraft {
  token: string;
  request_id: string;
  guest_name: string;
  date_of_birth?: string | null;
  items: BasketLine[];
}

const STORAGE_KEY = "ob_walkin_rental";

const stepperBtn: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 999,
  border: "1.5px solid #c8ddf0",
  background: "#f0f7ff",
  color: "#0b2f5c",
  fontSize: 18,
  lineHeight: 1,
  fontWeight: 700,
  cursor: "pointer",
  fontFamily: "inherit",
};

const stepperBtnDisabled: React.CSSProperties = { ...stepperBtn, opacity: 0.4, cursor: "default" };

export default function WalkinRentalClient() {
  const [phase, setPhase] = useState<"details" | "waiver" | "done">("details");
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dob, setDob] = useState("");
  const [nationality, setNationality] = useState("");
  const [hotel, setHotel] = useState("");
  const [room, setRoom] = useState("");
  const [emName, setEmName] = useState("");
  const [emPhone, setEmPhone] = useState("");

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [draft, setDraft] = useState<SavedDraft | null>(null);
  const [consentText, setConsentText] = useState("");
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  const [ackRead, setAckRead] = useState(false);
  const [ackBriefing, setAckBriefing] = useState(false);
  const [ackLifeJacket, setAckLifeJacket] = useState(false);
  const [ackRisk, setAckRisk] = useState(false);
  const [ackPhoto, setAckPhoto] = useState(false);
  const [guardianName, setGuardianName] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [guardianSignature, setGuardianSignature] = useState<string | null>(null);

  const isMinor = useCallback(() => {
    if (!dob) return false;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    return new Date(dob) > cutoff;
  }, [dob]);

  const basket: BasketLine[] = Object.entries(qtys)
    .filter(([, qty]) => qty > 0)
    .map(([itemName, qty]) => ({ name: itemName, qty }));

  const totalUnits = basket.reduce((s, l) => s + l.qty, 0);

  const loadTemplate = useCallback(() => {
    const supabase = createClient();
    const request = supabase.rpc("get_active_consent_template", { p_consent_type: "equipment_rental" });
    return Promise.resolve(request)
      .then(({ data }) => {
        const t = data as { consent_text?: string; version?: string } | null;
        if (t?.consent_text) {
          setConsentText(t.consent_text);
          setConsentVersion(t.version || null);
        } else {
          setFormError("The rental waiver is unavailable right now. Please ask our team.");
        }
      })
      .catch(() => setFormError("We couldn't load the rental waiver. Please refresh."));
  }, []);

  useEffect(() => {
    const supabase = createClient();
    Promise.resolve(supabase.rpc("get_rental_catalog"))
      .then(({ data, error }) => {
        if (error) {
          setCatalogError("We couldn't load the equipment list. Please refresh or ask our team.");
          return;
        }
        setCatalog((data as CatalogItem[]) || []);
      })
      .catch(() => setCatalogError("We couldn't load the equipment list. Please refresh or ask our team."));

    // Resume an abandoned signing session (guest closed the tab after sending details).
    try {
      const raw = window.sessionStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as SavedDraft;
        if (saved?.token && saved?.request_id) {
          setDraft(saved);
          setPhase("waiver");
          setName(saved.guest_name);
          setDob(saved.date_of_birth || "");
          loadTemplate();
        }
      }
    } catch {
      /* ignore unreadable drafts */
    }
  }, [loadTemplate]);

  function setQty(itemName: string, next: number) {
    const item = catalog.find((c) => c.name === itemName);
    const max = Math.max(Number(item?.free_units) || 0, 0);
    setQtys((prev) => ({ ...prev, [itemName]: Math.max(0, Math.min(next, max)) }));
  }

  function validateDetails(): boolean {
    const errors: Record<string, string> = {};
    if (name.trim().length < 2) errors.name = "Please enter your full name.";
    if (!isValidEmail(email.trim())) errors.email = EMAIL_REQUIRED_MESSAGE;
    if (phone.replace(/[^0-9+]/g, "").length < 7) {
      errors.phone = "Please enter a valid contact number with country code.";
    }
    // Migration 070 will not let a rental waiver be signed without these, so
    // ask for them up front instead of failing the guest at the signature step.
    if (!nationality.trim()) errors.nationality = "Nationality is required.";
    if (!dob) errors.dob = "Date of birth is required.";
    if (!hotel.trim()) errors.hotel = "Resort / hotel is required.";
    if (emName.trim().length < 2) errors.emName = "Emergency contact name is required.";
    if (emPhone.replace(/[^0-9+]/g, "").length < 7) {
      errors.emPhone = "Enter a valid emergency contact number.";
    }
    if (totalUnits < 1) errors.items = "Choose at least one item to rent.";
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmitDetails(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!validateDetails()) return;

    startTransition(async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("submit_rental_request", {
          p_guest_name: name.trim(),
          p_email: email.trim().toLowerCase(),
          p_phone: phone.trim(),
          p_nationality: nationality.trim() || null,
          p_date_of_birth: dob || null,
          p_hotel: hotel.trim() || null,
          p_room_number: room.trim() || null,
          p_emergency_contact_name: emName.trim() || null,
          p_emergency_contact_phone: emPhone.trim() || null,
          p_items: basket,
          p_notes: notes.trim() || null,
        });
        if (error) {
          setFormError(error.message || "We couldn't save your request. Please try again.");
          return;
        }
        const res = data as {
          error?: string;
          message?: string;
          success?: boolean;
          request_id?: string;
          token?: string;
        };
        if (res && typeof res === "object" && "error" in res && res.error) {
          setFormError(res.message || "We couldn't save your request. Please try again.");
          return;
        }
        const saved: SavedDraft = {
          token: String(res.token || ""),
          request_id: String(res.request_id || ""),
          guest_name: name.trim(),
          date_of_birth: dob || null,
          items: basket,
        };
        if (!saved.token) {
          setFormError("We couldn't start your waiver. Please ask our team.");
          return;
        }
        try {
          window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        } catch {
          /* storage disabled — signing still works in this session */
        }
        setDraft(saved);
        setPhase("waiver");
        setFormError(null);
        await loadTemplate();
      } catch {
        setFormError("Something went wrong. Please try again.");
      }
    });
  }

  function validateWaiver(): boolean {
    const errors: Record<string, string> = {};
    if (!ackRead) errors.ackRead = "You must read and agree to the waiver.";
    if (!ackBriefing || !ackLifeJacket || !ackRisk) {
      errors.acks = "All safety acknowledgements are required.";
    }
    if (!signature) errors.signature = "Please sign the waiver.";
    if (isMinor()) {
      if (guardianName.trim().length < 2) errors.guardianName = "A parent/guardian must sign for a renter under 18.";
      if (!guardianSignature) errors.guardianSignature = "Parent/guardian signature is required.";
    }
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  function handleSubmitSignature(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!draft?.token) {
      setFormError("Your session expired. Please start again.");
      return;
    }
    if (!validateWaiver()) return;

    startTransition(async () => {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("sign_consent_form", {
          p_token: draft.token,
          p_safety_briefing_confirmed: ackBriefing,
          p_life_jacket_confirmed: ackLifeJacket,
          p_risk_acknowledged: ackRisk,
          p_photo_consent: ackPhoto,
          p_signature_data_url: signature,
          p_parent_guardian_name: isMinor() ? guardianName.trim() || null : null,
          p_parent_guardian_signature_data_url: isMinor() ? guardianSignature : null,
          p_expected_consent_version: consentVersion,
        });
        if (error) {
          setFormError(error.message || "We couldn't save your signature. Please try again.");
          return;
        }
        const res = data as { error?: string; message?: string; success?: boolean };
        if (res && typeof res === "object" && "error" in res && res.error) {
          if (res.error === "terms_updated_refresh_required") {
            window.location.reload();
            return;
          }
          setFormError(res.message || "We couldn't save your signature. Please try again.");
          return;
        }
        try {
          window.sessionStorage.removeItem(STORAGE_KEY);
        } catch {
          /* ignore */
        }
        setPhase("done");
      } catch {
        setFormError("Something went wrong. Please try again.");
      }
    });
  }

  function startOver() {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    setDraft(null);
    setQtys({});
    setNotes("");
    setSignature(null);
    setGuardianSignature(null);
    setGuardianName("");
    setAckRead(false);
    setAckBriefing(false);
    setAckLifeJacket(false);
    setAckRisk(false);
    setAckPhoto(false);
    setFormError(null);
    setFieldErrors({});
    setPhase("details");
  }

  if (phase === "done") {
    return (
      <div className="walkinCard">
        <div className="walkinSuccess">
          <div className="walkinSuccessIcon">✓</div>
          <h2>You&apos;re all set{draft?.guest_name ? `, ${draft.guest_name.split(" ")[0]}` : ""}!</h2>
          <p className="walkinSuccessMsg">
            Your rental request and liability waiver are signed. Show this screen to our team — we&apos;ll
            hand over your gear, take payment at the counter and note your deposit.
          </p>
          <p className="walkinRef">
            Your request: <strong>{(draft?.items || basket).map((l) => `${l.qty} × ${l.name}`).join(", ")}</strong>
          </p>
          <div className="walkinMockButtons" style={{ justifyContent: "center" }}>
            <button className="walkinSubmit" style={{ maxWidth: 260 }} onClick={startOver}>
              Rent something else
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (phase === "waiver") {
    return (
      <div className="walkinCard">
        <div className="walkinCardHead">
          <h2>Consent &amp; liability waiver</h2>
          <p>One last step, {draft?.guest_name || name.split(" ")[0] || "there"} — read, tick and sign.</p>
        </div>

        <div className="walkinConsentDoc">
          <pre className="walkinConsentText">{consentText || "Loading the waiver…"}</pre>
        </div>

        <form onSubmit={handleSubmitSignature}>
          <div className="walkinConsentChecks" style={{ marginTop: 14 }}>
            <label>
              <input type="checkbox" checked={ackRead} onChange={(e) => setAckRead(e.target.checked)} />
              <span>I have read and agree to the waiver above.</span>
            </label>
            <label>
              <input type="checkbox" checked={ackBriefing} onChange={(e) => setAckBriefing(e.target.checked)} />
              <span>I have received and understood the safety briefing for this equipment.</span>
            </label>
            <label>
              <input type="checkbox" checked={ackLifeJacket} onChange={(e) => setAckLifeJacket(e.target.checked)} />
              <span>I will use the life jacket / buoyancy aid as instructed.</span>
            </label>
            <label>
              <input type="checkbox" checked={ackRisk} onChange={(e) => setAckRisk(e.target.checked)} />
              <span>I understand and accept the risks involved in using this equipment.</span>
            </label>
            <label>
              <input type="checkbox" checked={ackPhoto} onChange={(e) => setAckPhoto(e.target.checked)} />
              <span>Optional: Thoddoo Marine may use my photo for social media.</span>
            </label>
          </div>
          {fieldErrors.acks && <p className="walkinFieldError">{fieldErrors.acks}</p>}
          {fieldErrors.ackRead && <p className="walkinFieldError">{fieldErrors.ackRead}</p>}

          <div className="walkinField" style={{ marginTop: 12 }}>
            <span>
              Your signature <em>*</em>
            </span>
            <div className="walkinSigBox">
              <SignCanvas onSign={(d) => setSignature(d)} label="Sign inside the box" />
              {fieldErrors.signature && <p className="walkinFieldError">{fieldErrors.signature}</p>}
            </div>
          </div>

          {isMinor() && (
            <>
              <div className="walkinField">
                <span>
                  Parent / guardian name <em>*</em>
                </span>
                <input
                  type="text"
                  value={guardianName}
                  onChange={(e) => setGuardianName(e.target.value)}
                  placeholder="Full name of the accompanying adult"
                />
                {fieldErrors.guardianName && <p className="walkinFieldError">{fieldErrors.guardianName}</p>}
              </div>
              <div className="walkinField">
                <span>
                  Parent / guardian signature <em>*</em>
                </span>
                <div className="walkinSigBox">
                  <SignCanvas onSign={(d) => setGuardianSignature(d)} label="Guardian signs here" />
                  {fieldErrors.guardianSignature && (
                    <p className="walkinFieldError">{fieldErrors.guardianSignature}</p>
                  )}
                </div>
              </div>
            </>
          )}

          {formError && <div className="walkinError">{formError}</div>}

          <button className="walkinSubmit" type="submit" disabled={isPending} style={{ marginTop: 16 }}>
            {isPending ? "Saving…" : "Sign & finish"}
          </button>
          <p className="walkinTerms" style={{ marginTop: 10 }}>
            Our team will check your request, hand over the gear and take payment at the counter.
          </p>
          <button
            type="button"
            onClick={startOver}
            style={{
              marginTop: 12,
              background: "none",
              border: "none",
              color: "#647993",
              fontSize: "0.8rem",
              textDecoration: "underline",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            ← Change my details or gear
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="walkinCard">
      <div className="walkinCardHead">
        <h2>What would you like to rent?</h2>
        <p>Pick your gear, add your details, then sign the waiver on the next step.</p>
      </div>

      {catalogError ? (
        <div className="walkinError">{catalogError}</div>
      ) : catalog.length === 0 ? (
        <p className="walkinMock">Loading equipment…</p>
      ) : (
        <>
          <div className="walkinParty">
            <div className="walkinPartyTitle">
              <strong>Available now</strong>
              <em>free units only — our team assigns the specific item at handover</em>
            </div>
            {catalog.map((item) => {
              const free = Math.max(Number(item.free_units) || 0, 0);
              const qty = qtys[item.name] || 0;
              const unavailable = free <= 0;
              return (
                <div
                  key={item.name}
                  className="walkinParticipant"
                  style={unavailable ? { opacity: 0.55 } : undefined}
                >
                  <div className="walkinParticipantHead">
                    <span className="walkinParticipantTitle">
                      {item.name}
                      <em>
                        {unavailable
                          ? "none available right now"
                          : `${free} available now${qty > 0 ? ` · you chose ${qty}` : ""}`}
                      </em>
                    </span>
                  </div>
                  {item.description && (
                    <p style={{ fontSize: "0.82rem", color: "#6b7c8d", margin: "4px 0 0" }}>
                      {item.description}
                    </p>
                  )}
                  {!unavailable && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                      <button
                        type="button"
                        style={qty <= 0 ? stepperBtnDisabled : stepperBtn}
                        onClick={() => setQty(item.name, qty - 1)}
                        disabled={qty <= 0}
                        aria-label={`Remove ${item.name}`}
                      >
                        −
                      </button>
                      <strong style={{ minWidth: 24, textAlign: "center" }}>{qty}</strong>
                      <button
                        type="button"
                        style={qty >= free ? stepperBtnDisabled : stepperBtn}
                        onClick={() => setQty(item.name, qty + 1)}
                        disabled={qty >= free}
                        aria-label={`Add ${item.name}`}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {fieldErrors.items && <p className="walkinFieldError">{fieldErrors.items}</p>}
        </>
      )}

      <form onSubmit={handleSubmitDetails} style={{ marginTop: 16 }}>
        <div className="walkinRow">
          <div className="walkinField">
            <span>
              Full name <em>*</em>
            </span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="As on your passport"
              autoComplete="name"
            />
            {fieldErrors.name && <p className="walkinFieldError">{fieldErrors.name}</p>}
          </div>
          <div className="walkinField">
            <span>
              Email <em>*</em>
            </span>
            <input
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
            {fieldErrors.email && <p className="walkinFieldError">{fieldErrors.email}</p>}
          </div>
        </div>

        <div className="walkinRow">
          <div className="walkinField">
            <span>
              Contact number <em>*</em>
            </span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+960 …"
              autoComplete="tel"
            />
            {fieldErrors.phone && <p className="walkinFieldError">{fieldErrors.phone}</p>}
          </div>
          <div className="walkinField">
            <span>
              Date of birth <em>*</em>
            </span>
            <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            {fieldErrors.dob && <p className="walkinFieldError">{fieldErrors.dob}</p>}
          </div>
        </div>

        <div className="walkinRow">
          <div className="walkinField">
            <span>
              Nationality <em>*</em>
            </span>
            <input type="text" value={nationality} onChange={(e) => setNationality(e.target.value)} />
            {fieldErrors.nationality && <p className="walkinFieldError">{fieldErrors.nationality}</p>}
          </div>
          <div className="walkinField">
            <span>
              Resort / hotel <em>*</em>
            </span>
            <input type="text" value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="e.g. Thoddoo" />
            {fieldErrors.hotel && <p className="walkinFieldError">{fieldErrors.hotel}</p>}
          </div>
        </div>

        <div className="walkinRow">
          <div className="walkinField">
            <span>Room / villa</span>
            <input type="text" value={room} onChange={(e) => setRoom(e.target.value)} />
          </div>
          <div className="walkinField">
            <span>
              Emergency contact (name) <em>*</em>
            </span>
            <input type="text" value={emName} onChange={(e) => setEmName(e.target.value)} />
            {fieldErrors.emName && <p className="walkinFieldError">{fieldErrors.emName}</p>}
          </div>
        </div>

        <div className="walkinRow">
          <div className="walkinField">
            <span>
              Emergency contact (number) <em>*</em>
            </span>
            <input type="tel" value={emPhone} onChange={(e) => setEmPhone(e.target.value)} />
            {fieldErrors.emPhone && <p className="walkinFieldError">{fieldErrors.emPhone}</p>}
          </div>
          <div className="walkinField">
            <span>Notes for our team</span>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. need a short fin fitting"
            />
          </div>
        </div>

        {totalUnits > 0 && (
          <div className="walkinTotal">
            <span>Your basket</span>
            <strong>
              {totalUnits} item{totalUnits === 1 ? "" : "s"} — {basket.map((l) => `${l.qty} × ${l.name}`).join(", ")}
            </strong>
          </div>
        )}

        {formError && <div className="walkinError">{formError}</div>}

        <button className="walkinSubmit" type="submit" disabled={isPending}>
          {isPending ? "Saving…" : totalUnits > 0 ? `Continue — ${totalUnits} item${totalUnits === 1 ? "" : "s"}` : "Continue"}
        </button>
        <p className="walkinTerms">
          <strong>How it works:</strong> your details and gear choice go straight to our team. You then sign
          the liability waiver, we hand over the gear and take payment (and any deposit) at the counter.
        </p>
      </form>
    </div>
  );
}
