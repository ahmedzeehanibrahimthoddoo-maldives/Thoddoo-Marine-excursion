"use client";

import { useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { createActivity, updateActivity, replaceActivityPricing } from "@/lib/supabase/actions";
import { formatMoney, toMajorInput, parseMajorInput, validCurrency } from "@/lib/money";
import { MAX_COMMISSION_PERCENT, commissionMode, type CommissionMode } from "@/lib/commission";

interface PricingRow {
  label: string;
  price_cents: number;
  pricing_unit: "per_person" | "per_unit" | "per_hour";
  note: string;
  sort_order: number;
  currency: "USD" | "MVR";
}

interface ActivityFormProps {
  open: boolean;
  onClose: () => void;
  activity?: Record<string, unknown>;
  onSaved: () => void;
}

export default function ActivityForm({ open, onClose, activity, onSaved }: ActivityFormProps) {
  const a = activity as Record<string, unknown> | undefined;
  const existingPricing = (a?.activity_pricing as Array<Record<string, unknown>> | undefined) || [];
  const isNew = !a;

  const [name, setName] = useState((a?.name as string) || "");
  const [slug, setSlug] = useState((a?.slug as string) || "");
  const [category, setCategory] = useState((a?.category as string) || "");
  const [location, setLocation] = useState((a?.location as string) || "");
  const [description, setDescription] = useState((a?.description as string) || "");
  const [shortDescription, setShortDescription] = useState((a?.short_description as string) || "");
  const [durationMinutes, setDurationMinutes] = useState(a?.duration_minutes ? String(a.duration_minutes) : "");
  const [maxGuests, setMaxGuests] = useState(a?.max_guests ? String(a.max_guests) : "");
  const [currency, setCurrency] = useState(validCurrency(a?.currency));
  const [basePriceCents, setBasePriceCents] = useState(toMajorInput(Number(a?.base_price_cents ?? 0)));
  const [priceNote, setPriceNote] = useState((a?.price_note as string) || "");
  const [image, setImage] = useState((a?.image as string) || "");
  const [gopro, setGopro] = useState(Boolean(a?.gopro));
  const [active, setActive] = useState(a ? Boolean(a.active) : true);
  const [partner, setPartner] = useState((a?.partner as string) || "");
  const [commissionPerGuest, setCommissionPerGuest] = useState(toMajorInput(Number(a?.commission_cents ?? 0)));
  // 077: a partner cut can be a per-guest fixed amount (the old behaviour) or a
  // percentage of the booking total, which the activity level could never store.
  const [commissionKind, setCommissionKind] = useState<CommissionMode>(commissionMode(a?.commission_mode));
  const [commissionPercent, setCommissionPercent] = useState(
    a?.commission_percent === null || a?.commission_percent === undefined
      ? ""
      : String(a.commission_percent)
  );
  const [netPerGuest, setNetPerGuest] = useState(toMajorInput(Number(a?.net_cents ?? 0)));

  const [pricing, setPricing] = useState<PricingRow[]>(
    existingPricing.map((p, i) => ({
      label: (p.label as string) || "",
      price_cents: (p.price_cents as number) || 0,
      pricing_unit: (p.pricing_unit as "per_person" | "per_unit" | "per_hour") || "per_person",
      note: (p.note as string) || "",
      sort_order: (p.sort_order as number) ?? i,
      currency: validCurrency(p.currency),
    }))
  );

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  const updatePricingRow = (index: number, field: keyof PricingRow, value: string | number) => {
    setPricing((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [field]: value } : row))
    );
  };

  const addPricingRow = () => {
    setPricing((prev) => [
      ...prev,
      { label: "", price_cents: 0, pricing_unit: "per_person", note: "", sort_order: prev.length, currency: "USD" },
    ]);
  };

  const removePricingRow = (index: number) => {
    setPricing((prev) => prev.filter((_, i) => i !== index).map((row, i) => ({ ...row, sort_order: i })));
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      setToast({ type: "error", message: "Activity name is required" });
      return;
    }

    const invalidPricing = pricing.find(
      (p) => p.label.trim() && !["per_person", "per_unit", "per_hour"].includes(p.pricing_unit)
    );
    if (invalidPricing) {
      setToast({ type: "error", message: `Pricing option "${invalidPricing.label}" requires a valid unit (per person, per unit, or per hour).` });
      return;
    }

    startTransition(async () => {
      try {
        if (isNew) {
          await createActivity({
            name: name.trim(),
            slug: slug.trim() || null,
            category: category.trim() || null,
            location: location.trim() || null,
            description: description.trim() || null,
            short_description: shortDescription.trim() || null,
            duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
            max_guests: maxGuests ? parseInt(maxGuests, 10) : null,
            base_price_cents: parseMajorInput(basePriceCents),
            currency,
            price_note: priceNote.trim() || null,
            image: image.trim() || null,
            gopro,
            active,
            partner: partner.trim() || null,
            commission_cents: parseMajorInput(commissionPerGuest),
            commission_mode: commissionKind,
            commission_percent: commissionKind === "percent" ? commissionPercent : null,
            net_cents: parseMajorInput(netPerGuest),
            pricing: pricing.map((p) => ({
              label: p.label,
              price_cents: p.price_cents,
              pricing_unit: p.pricing_unit,
              note: p.note || undefined,
              sort_order: p.sort_order,
              currency: p.currency,
            })),
          });
        } else {
          await updateActivity(a.id as string, {
            name: name.trim(),
            slug: slug.trim() || null,
            category: category.trim() || null,
            location: location.trim() || null,
            description: description.trim() || null,
            short_description: shortDescription.trim() || null,
            duration_minutes: durationMinutes ? parseInt(durationMinutes, 10) : null,
            max_guests: maxGuests ? parseInt(maxGuests, 10) : null,
            base_price_cents: parseMajorInput(basePriceCents),
            currency,
            price_note: priceNote.trim() || null,
            image: image.trim() || null,
            gopro,
            active,
            partner: partner.trim() || null,
            commission_cents: parseMajorInput(commissionPerGuest),
            commission_mode: commissionKind,
            commission_percent: commissionKind === "percent" ? commissionPercent : null,
            net_cents: parseMajorInput(netPerGuest),
          });

          await replaceActivityPricing(
            a.id as string,
            pricing.map((p) => ({
              label: p.label,
              price_cents: p.price_cents,
              pricing_unit: p.pricing_unit,
              note: p.note || undefined,
              sort_order: p.sort_order,
              currency: p.currency,
            }))
          );
        }

        setToast({ type: "success", message: isNew ? "Activity created" : "Activity updated" });
        setTimeout(() => {
          onSaved();
          onClose();
        }, 600);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Failed to save" });
      }
    });
  };

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title={isNew ? "Add Activity" : "Edit Activity"}
      wide
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Saving..." : isNew ? "Create Activity" : "Update Activity"}
          </button>
        </>
      }
    >
      <FormRow cols={2}>
        <FormField label="Name" htmlFor="act_name" required>
          <input id="act_name" type="text" value={name} onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Slug" htmlFor="act_slug" hint="Auto-generated if blank">
          <input id="act_slug" type="text" value={slug} onChange={(e) => setSlug(e.target.value)} />
        </FormField>
      </FormRow>
      <FormRow cols={3}>
        <FormField label="Category" htmlFor="act_category">
          <input id="act_category" type="text" value={category} onChange={(e) => setCategory(e.target.value)} list="activity-category-suggestions" placeholder="e.g. excursions, snorkeling, watersports" />
          <datalist id="activity-category-suggestions">
            <option value="watersports" />
            <option value="snorkeling" />
            <option value="excursions" />
            <option value="cruises" />
            <option value="fishing" />
            <option value="island-trips" />
            <option value="resort-trips" />
            <option value="charters" />
            <option value="dining" />
            <option value="add-ons" />
          </datalist>
        </FormField>
        <FormField label="Location" htmlFor="act_location">
          <input id="act_location" type="text" value={location} onChange={(e) => setLocation(e.target.value)} />
        </FormField>
        <FormField label="Image URL" htmlFor="act_image">
          <input id="act_image" type="text" value={image} onChange={(e) => setImage(e.target.value)} />
        </FormField>
      </FormRow>
      <FormField label="Description" htmlFor="act_description">
        <textarea id="act_description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
      </FormField>
      <FormField label="Short Description" htmlFor="act_short_desc">
        <input id="act_short_desc" type="text" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} />
      </FormField>
      <FormRow cols={3}>
        <FormField label="Duration (min)" htmlFor="act_duration">
          <input id="act_duration" type="number" value={durationMinutes} onChange={(e) => setDurationMinutes(e.target.value)} />
        </FormField>
        <FormField label="Max Guests" htmlFor="act_max_guests">
          <input id="act_max_guests" type="number" value={maxGuests} onChange={(e) => setMaxGuests(e.target.value)} />
        </FormField>
        <FormField label="Base Price" htmlFor="act_price">
          <input id="act_price" type="number" step="0.01" min="0" value={basePriceCents} onChange={(e) => setBasePriceCents(e.target.value)} />
        </FormField>
        <FormField label="Currency" htmlFor="act_currency">
          <select id="act_currency" value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "MVR")}>
            <option value="USD">USD</option>
            <option value="MVR">MVR</option>
          </select>
        </FormField>
      </FormRow>
      <FormRow cols={3}>
        <FormField label="Price Note" htmlFor="act_price_note">
          <input id="act_price_note" type="text" value={priceNote} onChange={(e) => setPriceNote(e.target.value)} />
        </FormField>
        <FormField label="Partner (resort/partner)" htmlFor="act_partner">
          <input id="act_partner" type="text" value={partner} onChange={(e) => setPartner(e.target.value)} placeholder="e.g. Cinnamon Ellaidhoo Resort" />
        </FormField>
        <FormField label="Commission type" htmlFor="act_commission_mode">
          <select
            id="act_commission_mode"
            value={commissionKind}
            onChange={(e) => setCommissionKind(e.target.value as CommissionMode)}
          >
            <option value="fixed">Fixed amount</option>
            <option value="percent">Percent of booking</option>
          </select>
        </FormField>
        {commissionKind === "percent" ? (
          <FormField label="Commission %" htmlFor="act_commission_percent" hint="Taken from each booking's total.">
            <input
              id="act_commission_percent"
              type="number"
              step="0.01"
              min="0"
              max={MAX_COMMISSION_PERCENT}
              value={commissionPercent}
              onChange={(e) => setCommissionPercent(e.target.value)}
              placeholder="10"
            />
          </FormField>
        ) : (
          <FormField label="Commission / guest" htmlFor="act_commission" hint={`Fixed amount per guest, in ${currency}.`}>
            <input id="act_commission" type="number" step="0.01" min="0" value={commissionPerGuest} onChange={(e) => setCommissionPerGuest(e.target.value)} />
          </FormField>
        )}
        <FormField label="Net / guest" htmlFor="act_net">
          <input id="act_net" type="number" step="0.01" min="0" value={netPerGuest} onChange={(e) => setNetPerGuest(e.target.value)} />
        </FormField>
        <FormField label="GoPro" htmlFor="act_gopro">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, paddingTop: 6 }}>
            <input id="act_gopro" type="checkbox" checked={gopro} onChange={(e) => setGopro(e.target.checked)} style={{ width: 18, height: 18 }} />
            GoPro available
          </label>
        </FormField>
        <FormField label="Active" htmlFor="act_active">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13, fontWeight: 600, paddingTop: 6 }}>
            <input id="act_active" type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} style={{ width: 18, height: 18 }} />
            Active
          </label>
        </FormField>
      </FormRow>

      <div className="adminSection" style={{ marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <h2 style={{ fontSize: 15, margin: 0 }}>Pricing Options</h2>
          <button type="button" className="btn btn-secondary" onClick={addPricingRow} style={{ fontSize: 12, padding: "5px 12px" }}>
            + Add Row
          </button>
        </div>

        {pricing.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {pricing.map((row, idx) => (
              <div key={idx} style={{ display: "grid", gridTemplateColumns: "1fr 100px 80px 130px 1fr 40px 40px", gap: 8, alignItems: "end" }}>
                <FormField label={idx === 0 ? "Label" : ""} htmlFor={`price_label_${idx}`}>
                  <input
                    id={`price_label_${idx}`}
                    type="text"
                    value={row.label}
                    onChange={(e) => updatePricingRow(idx, "label", e.target.value)}
                    placeholder="e.g. Single, Double"
                  />
                </FormField>
                <FormField label={idx === 0 ? "Price" : ""} htmlFor={`price_cents_${idx}`}>
                  <input
                    id={`price_cents_${idx}`}
                    type="number"
                    step="0.01"
                    min="0"
                    value={toMajorInput(row.price_cents)}
                    onChange={(e) => updatePricingRow(idx, "price_cents", parseMajorInput(e.target.value))}
                  />
                </FormField>
                <FormField label={idx === 0 ? "Currency" : ""} htmlFor={`price_currency_${idx}`}>
                  <select
                    id={`price_currency_${idx}`}
                    value={row.currency}
                    onChange={(e) => updatePricingRow(idx, "currency", e.target.value)}
                  >
                    <option value="USD">USD</option>
                    <option value="MVR">MVR</option>
                  </select>
                </FormField>
                <FormField label={idx === 0 ? "Unit" : ""} htmlFor={`price_unit_${idx}`}>
                  <select
                    id={`price_unit_${idx}`}
                    value={row.pricing_unit}
                    onChange={(e) => updatePricingRow(idx, "pricing_unit", e.target.value)}
                  >
                    <option value="per_person">Per person</option>
                    <option value="per_unit">Per unit / session</option>
                    <option value="per_hour">Per hour</option>
                  </select>
                </FormField>
                <FormField label={idx === 0 ? "Note" : ""} htmlFor={`price_note_${idx}`}>
                  <input
                    id={`price_note_${idx}`}
                    type="text"
                    value={row.note}
                    onChange={(e) => updatePricingRow(idx, "note", e.target.value)}
                  />
                </FormField>
                <FormField label={idx === 0 ? "Order" : ""} htmlFor={`price_order_${idx}`}>
                  <input
                    id={`price_order_${idx}`}
                    type="number"
                    value={row.sort_order}
                    onChange={(e) => updatePricingRow(idx, "sort_order", parseInt(e.target.value, 10) || 0)}
                  />
                </FormField>
                <div style={{ paddingBottom: 2 }}>
                  <button
                    type="button"
                    className="actionBtn actionBtn-cancelled"
                    onClick={() => removePricingRow(idx)}
                    title="Remove row"
                    style={{ width: 28, height: 28 }}
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && <Toast type={toast.type} message={toast.message} />}
    </AdminModal>
  );
}
