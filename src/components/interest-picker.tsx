"use client";

import type { InterestLevel } from "@/generated/types.gen";

/*
 * Interest level as four large targets, not a dropdown.
 *
 * It is the most-used control in the app and gets tapped one-handed, often in
 * a dim corridor. A select would mean tap, wait for the sheet, scroll, tap.
 *
 * "No response" sits first and spans the row because most knocks go
 * unanswered: that is the two-tap path - pick the unit, tap this, done.
 */

const OPTIONS: { value: InterestLevel; label: string; className: string }[] = [
  { value: "no_response", label: "No response", className: "border-interest-none" },
  { value: "low", label: "Low", className: "border-interest-low" },
  { value: "medium", label: "Medium", className: "border-interest-medium" },
  { value: "high", label: "High", className: "border-interest-high" },
];

type Props = {
  value: InterestLevel | null;
  onChange: (value: InterestLevel) => void;
  describedBy?: string | undefined;
};

export function InterestPicker({ value, onChange, describedBy }: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Interest level"
      aria-describedby={describedBy}
      className="grid grid-cols-3 gap-2"
    >
      {OPTIONS.map((option) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              onChange(option.value);
            }}
            className={`min-h-14 rounded-xl border-2 px-2 text-body font-medium transition-colors ${
              option.value === "no_response" ? "col-span-3" : ""
            } ${option.className} ${
              selected ? "bg-primary text-primary-foreground" : "bg-surface"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
