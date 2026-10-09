"use client";

import { useState } from "react";
import BookingForm, { type AddonActivity } from "./BookingForm";

interface PricingOption {
  label: string;
  price: string;
  priceCents: number;
  pricingUnit?: "per_person" | "per_unit" | "per_hour";
  note?: string;
}

interface BookingButtonProps {
  activityId: string;
  activityName: string;
  category: string;
  basePriceCents: number;
  priceNote?: string;
  pricingOptions?: PricingOption[];
  currency?: string;
  className?: string;
  children?: React.ReactNode;
  addonActivities?: AddonActivity[];
}

export default function BookingButton({
  activityId,
  activityName,
  category,
  basePriceCents,
  pricingOptions,
  currency,
  className,
  children,
  addonActivities,
}: BookingButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {children || "BOOK NOW"}
      </button>
      <BookingForm
        activityId={activityId}
        activityName={activityName}
        category={category}
        basePriceCents={basePriceCents}
        pricingOptions={pricingOptions}
        currency={currency}
        open={open}
        onClose={() => setOpen(false)}
        addonActivities={addonActivities}
      />
    </>
  );
}
