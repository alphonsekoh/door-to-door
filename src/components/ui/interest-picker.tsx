"use client";

import type { RefObject } from "react";
import type { InterestLevel } from "@/generated/types.gen";

/*
 * Interest level as four large targets, not a dropdown.
 *
 * It is the most-used control in the app and gets tapped one-handed, often in
 * a dim corridor. A select would mean tap, wait for the sheet, scroll, tap.
 *
 * "No response" sits first and spans the row because most knocks go
 * unanswered: that is the two-tap path - pick the unit, tap this, done.
 *
 * The other three share a row while they fit and wrap at large text sizes.
 * The selection fills at once: a fade would leave the thumb unsure it took.
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
  /* "No response", for a form to send focus to when none is chosen. */
  firstRef?: RefObject<HTMLButtonElement | null>;
  /* Added to every option: scroll margins clearing a form's pinned chrome. */
  optionClassName?: string;
};

export function InterestPicker({
  value,
  onChange,
  describedBy,
  firstRef,
  optionClassName = "",
}: Props) {
  return (
    <div
      role="radiogroup"
      aria-label="Interest level"
      aria-describedby={describedBy}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,--spacing(24)),1fr))] gap-2"
    >
      {OPTIONS.map((option, index) => {
        const selected = value === option.value;
        return (
          <button
            key={option.value}
            ref={index === 0 ? firstRef : undefined}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => {
              onChange(option.value);
            }}
            className={`min-h-14 press rounded-xl border-2 px-2 text-body font-medium break-words ${optionClassName} ${
              option.value === "no_response" ? "col-span-full" : ""
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
