"use client";

import { EXCHANGE_RATE_MVR_PER_USD as MVR_PER_USD } from "@/lib/money";
import { useState, useTransition, useEffect } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import { checkoutEquipment, createCustomer, getEquipmentForSelect, getCustomersForSelect, getBookingsForSelect, type EquipmentSelectOption } from "@/lib/supabase/actions";
import { formatMoney, toMajorInput, parseMajorInput, currencyForDisplay } from "@/lib/money";

interface SelectOption {
  id: string;
  label: string;
  sub?: string;
}

interface RentalCheckoutFormProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function rateHint(rateCents: number | null | undefined, currency: string): string {
  const c = currencyForDisplay(currency);
  const v = Number(rateCents) || 0;
  if (v <= 0) return "";
  const main = formatMoney(v, c);
  return c === "USD" ? `${main}/day ≈ MVR ${(v / 100 * MVR_PER_USD).toFixed(2)}` : `${main}/day ≈ USD ${(v / 100 / MVR_PER_USD).toFixed(2)}`;
}

export default function RentalCheckoutForm({ open, onClose, onSaved }: RentalCheckoutFormProps) {
  const [equipmentId, setEquipmentId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [bookingId, setBookingId] = useState("");
  const [checkoutCondition, setCheckoutCondition] = useState("excellent");
  const [expectedReturnAt, setExpectedReturnAt] = useState("");
  const [rentalChargeCents, setRentalChargeCents] = useState("");
  const [depositCents, setDepositCents] = useState("");
  const [currency, setCurrency] = useState("USD");

  const [equipmentList, setEquipmentList] = useState<EquipmentSelectOption[]>([]);

  const selectedEquipment = equipmentList.find((e) => e.id === equipmentId) || null;

  const handleEquipmentChange = (id: string) => {
    setEquipmentId(id);
    const eq = equipmentList.find((e) => e.id === id);
    if (!eq) return;
    setCurrency(currencyForDisplay(eq.currency));
    if (eq.dailyRateCents) setRentalChargeCents(toMajorInput(Number(eq.dailyRateCents)));
    if (eq.depositCents) setDepositCents(toMajorInput(Number(eq.depositCents)));
  };
  const [customerList, setCustomerList] = useState<SelectOption[]>([]);
  const [bookingList, setBookingList] = useState<SelectOption[]>([]);

  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [chargeTouched, setChargeTouched] = useState(false);
  const [depositTouched, setDepositTouched] = useState(false);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncEmail, setNcEmail] = useState("");
  const [ncPhone, setNcPhone] = useState("");

  const convertCents = (cents: number, from: string, to: string): number => {
    if (from === to) return cents;
    return from === "USD" ? Math.round((cents * MVR_PER_USD)) : Math.round((cents / MVR_PER_USD));
  };

  const applyCurrency = (to: string) => {
    const from = currency;
    if (!to || to === from) return;
    setCurrency(to as "USD" | "MVR");
    if (chargeTouched || !selectedEquipment) return;
    const newCharge = convertCents(parseMajorInput(rentalChargeCents), from, to);
    setRentalChargeCents(toMajorInput(newCharge));
    if (!depositTouched) {
      const newDeposit = convertCents(parseMajorInput(depositCents), from, to);
      setDepositCents(toMajorInput(newDeposit));
    }
  };

  useEffect(() => {
    if (!open) return;
    setEquipmentId("");
    setCustomerId("");
    setBookingId("");
    setCheckoutCondition("excellent");
    setExpectedReturnAt("");
    setRentalChargeCents("");
    setDepositCents("");
    setCurrency("USD");
    setToast(null);
    setNewCustomerMode(false);
    setNcName("");
    setNcEmail("");
    setNcPhone("");

    Promise.all([getEquipmentForSelect(), getCustomersForSelect(), getBookingsForSelect()])
      .then(([eq, cust, bookings]) => {
        setEquipmentList(eq);
        setCustomerList(cust);
        setBookingList(bookings);
      })
      .catch(() => setToast({ type: "error", message: "Failed to load select options" }));
  }, [open]);

  const handleSubmit = () => {
    if (!equipmentId) {
      setToast({ type: "error", message: "Equipment is required" });
      return;
    }
    if (!newCustomerMode && !customerId) {
      setToast({ type: "error", message: "Customer is required" });
      return;
    }
    if (newCustomerMode && ncName.trim().length < 2) {
      setToast({ type: "error", message: "Customer name is required" });
      return;
    }
    if (newCustomerMode && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ncEmail.trim())) {
      setToast({ type: "error", message: "A valid email is required for the new customer" });
      return;
    }
    if (!expectedReturnAt) {
      setToast({ type: "error", message: "Expected return date is required" });
      return;
    }

    startTransition(async () => {
      try {
        let resolvedCustomerId = customerId;
        if (newCustomerMode) {
          const created = (await createCustomer({
            full_name: ncName.trim(),
            email: ncEmail.trim().toLowerCase(),
            phone: ncPhone.trim() || undefined,
          })) as { id?: string };
          if (!created?.id) throw new Error("Could not create the customer");
          resolvedCustomerId = created.id;
        }
        await checkoutEquipment({
          equipment_id: equipmentId,
          customer_id: resolvedCustomerId,
          booking_id: bookingId || undefined,
          checkout_condition: checkoutCondition,
          expected_return_at: new Date(expectedReturnAt).toISOString(),
          rental_charge_cents: parseMajorInput(rentalChargeCents),
          deposit_cents: parseMajorInput(depositCents),
          currency,
        });
        setToast({ type: "success", message: "Equipment checked out" });
        setTimeout(() => {
          onSaved();
          onClose();
        }, 600);
      } catch (err) {
        setToast({ type: "error", message: err instanceof Error ? err.message : "Checkout failed" });
      }
    });
  };

  return (
    <AdminModal
      open={open}
      onClose={onClose}
      title="Checkout Equipment"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Processing..." : "Checkout"}
          </button>
        </>
      }
    >
      <FormRow cols={2}>
        <FormField label="Equipment" htmlFor="rental_equip" required>
          <select id="rental_equip" value={equipmentId} onChange={(e) => handleEquipmentChange(e.target.value)}>
            <option value="">Select equipment...</option>
            {equipmentList.map((eq) => (
              <option key={eq.id} value={eq.id}>{eq.label}{eq.sub ? ` (${eq.sub})` : ""}{eq.dailyRateCents ? ` — ${formatMoney(Number(eq.dailyRateCents), currencyForDisplay(eq.currency))}/day` : ""}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Customer" htmlFor="rental_cust" required>
          {newCustomerMode ? (
            <input
              id="rental_cust"
              type="text"
              value={ncName}
              onChange={(e) => setNcName(e.target.value)}
              placeholder="New guest full name"
              autoFocus
            />
          ) : (
            <select id="rental_cust" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">Select customer...</option>
              {customerList.map((c) => (
                <option key={c.id} value={c.id}>{c.label}{c.sub ? ` (${c.sub})` : ""}</option>
              ))}
            </select>
          )}
        </FormField>
      </FormRow>
      {newCustomerMode ? (
        <FormRow cols={2}>
          <FormField label="Email" htmlFor="rental_nc_email" required>
            <input
              id="rental_nc_email"
              type="text"
              value={ncEmail}
              onChange={(e) => setNcEmail(e.target.value)}
              placeholder="guest@example.com"
            />
          </FormField>
          <FormField label="Phone (optional)" htmlFor="rental_nc_phone">
            <input
              id="rental_nc_phone"
              type="tel"
              value={ncPhone}
              onChange={(e) => setNcPhone(e.target.value)}
              placeholder="+960 …"
            />
          </FormField>
        </FormRow>
      ) : null}
      <p style={{ margin: "6px 2px 10px", fontSize: 12.5 }}>
        <button
          type="button"
          onClick={() => {
            setNewCustomerMode((v) => !v);
            setCustomerId("");
          }}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            fontFamily: "inherit",
            fontSize: 12.5,
            fontWeight: 700,
            color: "#0a5fb0",
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          {newCustomerMode ? "← Choose an existing customer instead" : "+ New customer (no account needed)"}
        </button>
      </p>
      <FormField label="Booking (optional)" htmlFor="rental_booking">
        <select id="rental_booking" value={bookingId} onChange={(e) => setBookingId(e.target.value)}>
          <option value="">No linked booking</option>
          {bookingList.map((b) => (
            <option key={b.id} value={b.id}>{b.label}{b.sub ? ` — ${b.sub}` : ""}</option>
          ))}
        </select>
      </FormField>
      <FormRow cols={2}>
        <FormField label="Checkout Condition" htmlFor="rental_condition">
          <select id="rental_condition" value={checkoutCondition} onChange={(e) => setCheckoutCondition(e.target.value)}>
            <option value="excellent">Excellent</option>
            <option value="good">Good</option>
            <option value="fair">Fair</option>
            <option value="poor">Poor</option>
          </select>
        </FormField>
        <FormField label="Expected Return" htmlFor="rental_return" required>
          <input
            id="rental_return"
            type="datetime-local"
            value={expectedReturnAt}
            onChange={(e) => setExpectedReturnAt(e.target.value)}
          />
        </FormField>
      </FormRow>
      <FormRow cols={3}>
        <FormField label="Rental Charge" htmlFor="rental_charge">
          <input
            id="rental_charge"
            type="number"
            step="0.01"
            min="0"
            value={rentalChargeCents}
            onChange={(e) => { setRentalChargeCents(e.target.value); setChargeTouched(true); }}
            placeholder="0"
          />
        </FormField>
        <FormField label="Deposit" htmlFor="rental_deposit">
          <input
            id="rental_deposit"
            type="number"
            step="0.01"
            min="0"
            value={depositCents}
            onChange={(e) => { setDepositCents(e.target.value); setDepositTouched(true); }}
            placeholder="0"
          />
        </FormField>
        <FormField label="Currency" htmlFor="rental_currency">
          <select id="rental_currency" value={currency} onChange={(e) => applyCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="MVR">MVR</option>
          </select>
        </FormField>
      </FormRow>
      {(selectedEquipment?.dailyRateCents || selectedEquipment?.depositCents) && (
        <p style={{ fontSize: 12.5, color: "#647993", margin: "8px 2px 0", lineHeight: 1.5 }}>
          {selectedEquipment?.dailyRateCents ? rateHint(selectedEquipment.dailyRateCents, currency) : ""}
          {selectedEquipment?.depositCents
            ? ` · Deposit ${formatMoney(Number(selectedEquipment.depositCents), currencyForDisplay(String(selectedEquipment.currency)))} ≈ ${formatMoney(convertCents(Number(selectedEquipment.depositCents), String(selectedEquipment.currency), currency), currencyForDisplay(currency))}`
            : ""}
        </p>
      )}
      {toast && <Toast type={toast.type} message={toast.message} />}
    </AdminModal>
  );
}
