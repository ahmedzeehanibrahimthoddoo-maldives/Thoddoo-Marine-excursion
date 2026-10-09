"use client";

import { DENOMINATIONS, countTotal, type CashCurrency } from "@/lib/cashreg";
import { formatMoney3 } from "@/lib/money";

interface Props {
  currency: CashCurrency;
  counts: Record<string, number>;
  onChange: (counts: Record<string, number>) => void;
}

/** Per-currency note & coin counting grid: enter how many of each, total auto-calculated. */
export default function DenominationCounter({ currency, counts, onChange }: Props) {
  const denominations = DENOMINATIONS[currency];

  function setCount(id: string, value: string) {
    const n = Math.max(Math.floor(Number(value) || 0), 0);
    const next = { ...counts };
    if (n > 0) next[id] = n;
    else delete next[id];
    onChange(next);
  }

  return (
    <div className="denomCounter">
      <div className="denomCounterHead">
        <strong>{currency}</strong>
        <span className="badge badge-category">Count notes &amp; coins</span>
      </div>
      <div className="tableWrap">
        <table className="adminTable denomTable">
          <thead>
            <tr>
              <th>Value</th>
              <th>Type</th>
              <th>Qty</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {denominations.map((d) => {
              const qty = Number(counts[d.id]) || 0;
              const subtotal = qty * d.minor;
              return (
                <tr key={d.id}>
                  <td className="denomValue">{currency} {d.label}</td>
                  <td><span className={`badge ${d.kind === "note" ? "badge-confirmed" : "badge-pending"}`}>{d.kind}</span></td>
                  <td>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      className="denomQty"
                      value={qty === 0 ? "" : qty}
                      placeholder="0"
                      onChange={(e) => setCount(d.id, e.target.value)}
                    />
                  </td>
                  <td className="denomSubtotal">
                    {subtotal > 0 ? formatMoney3(subtotal, currency) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="denomCounterFoot">
        Estimated counted: <strong>{formatMoney3(countTotal(currency, counts), currency)}</strong>
      </div>
    </div>
  );
}