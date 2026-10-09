"use client";

import { useEffect, useState, useTransition } from "react";
import AdminModal, { FormField, FormRow, Toast } from "@/app/admin/components/AdminModal";
import {
  getFreeEquipmentForIssue,
  issueRentalRequest,
  type FreeEquipmentUnit,
  type RentalRequestRow,
} from "@/lib/supabase/actions";
import {
  EXCHANGE_RATE_MVR_PER_USD as MVR_PER_USD,
  formatMoney,
  parseMajorInput,
  toMajorInput,
  currencyForDisplay,
} from "@/lib/money";

interface IssueRentalRequestModalProps {
  request: RentalRequestRow;
  onClose: () => void;
  onIssued: () => void;
  showToast: (type: "success" | "error", message: string) => void;
}

interface Slot {
  equipment_id: string;
  charge: string;
  deposit: string;
}

interface Group {
  name: string;
  slots: Slot[];
}

const requestConsent = (r: RentalRequestRow) => {
  const raw = r.consent_forms;
  if (!raw) return null;
  return (Array.isArray(raw) ? raw[0] : raw) || null;
};

const defaultReturnAt = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export default function IssueRentalRequestModal({
  request,
  onClose,
  onIssued,
  showToast,
}: IssueRentalRequestModalProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [freeUnits, setFreeUnits] = useState<FreeEquipmentUnit[]>([]);
  const [currency, setCurrency] = useState("USD");
  const [expectedReturnAt, setExpectedReturnAt] = useState(defaultReturnAt);
  const [takePayment, setTakePayment] = useState(true);
  const [payAmount, setPayAmount] = useState("");
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const consent = requestConsent(request);

  useEffect(() => {
    getFreeEquipmentForIssue()
      .then((units) => {
        setFreeUnits(units);
        const wanted: Array<{ name: string; qty: number }> = (request.items || []).map((it) => ({
          name: String(it.name),
          qty: Math.max(1, Math.round(Number(it.qty) || 0)),
        }));

        const available = new Map<string, FreeEquipmentUnit[]>();
        for (const u of units) {
          const list = available.get(u.name) || [];
          list.push(u);
          available.set(u.name, list);
        }

        const picked: Group[] = wanted.map((w) => {
          const pool = [...(available.get(w.name) || [])];
          const slots: Slot[] = [];
          for (let i = 0; i < w.qty; i++) {
            const unit = pool.shift();
            slots.push({
              equipment_id: unit ? unit.id : "",
              charge: unit ? toMajorInput(unit.daily_rate_cents) : "",
              deposit: unit ? toMajorInput(unit.deposit_cents) : "",
            });
          }
          return { name: w.name, slots };
        });
        setGroups(picked);

        const firstUnit = picked.flatMap((g) => g.slots).map((s) => units.find((u) => u.id === s.equipment_id))[0];
        const cur = currencyForDisplay(firstUnit?.currency || "USD");
        setCurrency(cur);
        const totalCents = picked
          .flatMap((g) => g.slots)
          .reduce((sum, s) => {
            try {
              return sum + parseMajorInput(s.charge);
            } catch {
              return sum;
            }
          }, 0);
        setPayAmount(totalCents > 0 ? toMajorInput(totalCents) : "");
        setTakePayment(totalCents > 0);
      })
      .catch(() => showToast("error", "Failed to load available equipment."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.id]);

  const totalChargeCents = groups
    .flatMap((g) => g.slots)
    .reduce((sum, s) => {
      try {
        return sum + parseMajorInput(s.charge);
      } catch {
        return sum;
      }
    }, 0);

  const selectedIds = groups.flatMap((g) => g.slots.map((s) => s.equipment_id)).filter(Boolean);
  const duplicates = new Set(selectedIds).size !== selectedIds.length;
  const unfilled = groups.some((g) => g.slots.some((s) => !s.equipment_id));

  // Units already chosen in ANOTHER slot of the same group must be hidden.
  function optionsFor(groupIdx: number, slotIdx: number): FreeEquipmentUnit[] {
    const group = groups[groupIdx];
    const takenElsewhere = new Set(
      group.slots.filter((_, i) => i !== slotIdx).map((s) => s.equipment_id).filter(Boolean)
    );
    return freeUnits.filter((u) => u.name === group.name && !takenElsewhere.has(u.id));
  }

  function setSlot(groupIdx: number, slotIdx: number, patch: Partial<Slot>) {
    setGroups((prev) =>
      prev.map((g, gi) =>
        gi !== groupIdx
          ? g
          : {
              ...g,
              slots: g.slots.map((s, si) => {
                if (si !== slotIdx) return s;
                const next = { ...s, ...patch };
                if (patch.equipment_id) {
                  const unit = freeUnits.find((u) => u.id === patch.equipment_id);
                  if (unit) {
                    next.charge = toMajorInput(unit.daily_rate_cents);
                    next.deposit = toMajorInput(unit.deposit_cents);
                  }
                }
                return next;
              }),
            }
      )
    );
  }

  const convertCents = (cents: number, from: string, to: string): number => {
    if (from === to) return cents;
    return from === "USD" ? Math.round(cents * MVR_PER_USD) : Math.round(cents / MVR_PER_USD);
  };

  function applyCurrency(to: string) {
    const from = currency;
    if (!to || to === from) return;
    setCurrency(to);
    setGroups((prev) =>
      prev.map((g) => ({
        ...g,
        slots: g.slots.map((s) => {
          const charge = (() => {
            try {
              return convertCents(parseMajorInput(s.charge), from, to);
            } catch {
              return 0;
            }
          })();
          const deposit = (() => {
            try {
              return convertCents(parseMajorInput(s.deposit), from, to);
            } catch {
              return 0;
            }
          })();
          return {
            ...s,
            charge: charge > 0 ? toMajorInput(charge) : s.charge,
            deposit: deposit > 0 ? toMajorInput(deposit) : s.deposit,
          };
        }),
      }))
    );
    // Keep the prefaced payment amount in the new currency too.
    setPayAmount((prev) => {
      try {
        const cents = convertCents(parseMajorInput(prev), from, to);
        return cents > 0 ? toMajorInput(cents) : prev;
      } catch {
        return prev;
      }
    });
  }

  const handleSubmit = () => {
    setLocalError(null);
    if (unfilled) {
      setLocalError("Every requested item needs a specific unit selected.");
      return;
    }
    if (duplicates) {
      setLocalError("The same unit is selected twice — pick a different one.");
      return;
    }
    if (!expectedReturnAt) {
      setLocalError("Expected return date & time is required.");
      return;
    }

    let units;
    let payCents = 0;
    try {
      units = groups.flatMap((g) =>
        g.slots.map((s) => ({
          equipment_id: s.equipment_id,
          charge_cents: parseMajorInput(s.charge),
          deposit_cents: parseMajorInput(s.deposit),
        }))
      );
      payCents = takePayment ? parseMajorInput(payAmount) : 0;
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Check the amounts.");
      return;
    }
    if (payCents > totalChargeCents) {
      setLocalError(
        `Payment (${formatMoney(payCents, currencyForDisplay(currency))}) is more than the total charges (${formatMoney(totalChargeCents, currencyForDisplay(currency))}). Deposits are held separately.`
      );
      return;
    }

    startTransition(async () => {
      try {
        const result = await issueRentalRequest(request.id, {
          units,
          expected_return_at: new Date(expectedReturnAt).toISOString(),
          currency,
          payment_amount_cents: payCents,
          payment_method: method,
          payment_reference: reference.trim() || undefined,
        });
        showToast("success", `${result.issued} unit${result.issued === 1 ? "" : "s"} handed over.`);
        onIssued();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Issue failed";
        setLocalError(message);
        showToast("error", message);
      }
    });
  };

  return (
    <AdminModal
      open
      onClose={onClose}
      title="Issue walk-in rental"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? "Issuing…" : "Issue equipment"}
          </button>
        </>
      }
    >
      <div style={styles.guestBox}>
        <strong>{request.guest_name}</strong>
        <span>
          {request.phone || "no phone"}
          {request.email ? ` · ${request.email}` : ""}
          {request.hotel ? ` · ${request.hotel}${request.room_number ? ` ${request.room_number}` : ""}` : ""}
        </span>
        <span>
          {consent?.status === "signed"
            ? `Waiver signed ${consent.signed_at ? new Date(consent.signed_at).toLocaleString() : ""}`
            : "⚠ Waiver not signed yet — the guest must sign before the gear goes out."}
        </span>
        {request.notes ? <span style={{ color: "#647993" }}>“{request.notes}”</span> : null}
      </div>

      {groups.map((group, gi) => (
        <div key={group.name} style={styles.group}>
          <div style={styles.groupHead}>
            <strong>{group.name}</strong>
            <span>
              {group.slots.length} × to hand over ·{" "}
              {freeUnits.filter((u) => u.name === group.name).length} free right now
            </span>
          </div>
          {group.slots.map((slot, si) => {
            const unit = freeUnits.find((u) => u.id === slot.equipment_id);
            const options = optionsFor(gi, si);
            return (
              <div key={si} style={styles.slotRow}>
                <select
                  value={slot.equipment_id}
                  onChange={(e) => setSlot(gi, si, { equipment_id: e.target.value })}
                  style={{ ...styles.slotSelect, flex: 2 }}
                >
                  <option value="">Select unit…</option>
                  {slot.equipment_id && !options.some((o) => o.id === slot.equipment_id) && (
                    <option value={slot.equipment_id}>
                      {unit ? `${unit.name} — ${unit.asset_number}` : slot.equipment_id}
                    </option>
                  )}
                  {options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name} — {o.asset_number}
                    </option>
                  ))}
                </select>
                <label style={styles.miniField}>
                  Charge
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={slot.charge}
                    onChange={(e) => setSlot(gi, si, { charge: e.target.value })}
                  />
                </label>
                <label style={styles.miniField}>
                  Deposit
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={slot.deposit}
                    onChange={(e) => setSlot(gi, si, { deposit: e.target.value })}
                  />
                </label>
              </div>
            );
          })}
        </div>
      ))}

      <FormRow cols={2}>
        <FormField label="Expected Return" htmlFor="issue_return" required>
          <input
            id="issue_return"
            type="datetime-local"
            value={expectedReturnAt}
            onChange={(e) => setExpectedReturnAt(e.target.value)}
          />
        </FormField>
        <FormField label="Currency" htmlFor="issue_currency">
          <select id="issue_currency" value={currency} onChange={(e) => applyCurrency(e.target.value)}>
            <option value="USD">USD</option>
            <option value="MVR">MVR</option>
          </select>
        </FormField>
      </FormRow>

      <div style={styles.payBox}>
        <label style={styles.payToggle}>
          <input type="checkbox" checked={takePayment} onChange={(e) => setTakePayment(e.target.checked)} />
          <span>Take payment now ({formatMoney(totalChargeCents, currencyForDisplay(currency))} charges)</span>
        </label>
        {takePayment && (
          <FormRow cols={3}>
            <FormField label="Amount" htmlFor="issue_amount">
              <input
                id="issue_amount"
                type="number"
                step="0.01"
                min="0"
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                placeholder="0"
              />
            </FormField>
            <FormField label="Method" htmlFor="issue_method">
              <select id="issue_method" value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="online">Online</option>
                <option value="other">Other</option>
              </select>
            </FormField>
            <FormField label="Reference (optional)" htmlFor="issue_ref">
              <input id="issue_ref" value={reference} onChange={(e) => setReference(e.target.value)} />
            </FormField>
          </FormRow>
        )}
        <p style={styles.payHint}>
          Deposits ({formatMoney(
            groups.flatMap((g) => g.slots).reduce((sum, s) => {
              try {
                return sum + parseMajorInput(s.deposit);
              } catch {
                return sum;
              }
            }, 0),
            currencyForDisplay(currency)
          )}) are held separately and are not part of this payment.
        </p>
      </div>

      {localError && <Toast type="error" message={localError} />}
    </AdminModal>
  );
}

const styles = {
  guestBox: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    background: "#f0f7ff",
    border: "1.5px solid #cfe3f5",
    borderRadius: 12,
    padding: "10px 14px",
    fontSize: 13,
    marginBottom: 14,
  },
  group: {
    marginBottom: 12,
  },
  groupHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    fontSize: 13,
    color: "#475569",
    marginBottom: 6,
  },
  slotRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
    marginBottom: 6,
  },
  slotSelect: {
    fontSize: 13,
    padding: "6px 8px",
    borderRadius: 8,
    border: "1.5px solid #dde6ef",
    background: "#fff",
    fontFamily: "inherit" as const,
  },
  miniField: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    fontSize: 11,
    fontWeight: 700,
    color: "#647993",
    width: 86,
  },
  payBox: {
    borderTop: "1px solid #e8eef4",
    marginTop: 8,
    paddingTop: 10,
  },
  payToggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    fontWeight: 700,
    color: "var(--ink)",
    marginBottom: 6,
    cursor: "pointer",
  },
  payHint: {
    fontSize: 11.5,
    color: "#647993",
    margin: "6px 2px 0",
    lineHeight: 1.5,
  },
};
