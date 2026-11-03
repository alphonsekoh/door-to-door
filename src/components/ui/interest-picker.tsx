"use client";

import { useCallback, useId, useRef, type RefObject } from "react";
import type { InterestLevel } from "@/generated/types.gen";
import { useEarlyInput } from "@/lib/hooks/use-early-input";

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
 *
 * Native radios, each laid over its whole tile, and filled from `:checked`:
 * on a slow connection the recording form is on screen before its script, and
 * a pick made then must show, and be kept once the page is live (#113).
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
  firstRef?: RefObject<HTMLInputElement | null>;
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
  /* Its own group, so a picker in a sheet over the form is not one with it. */
  const name = useId();
  const group = useRef<HTMLDivElement>(null);
  const picked = useCallback((): InterestLevel | undefined => {
    const checked = group.current?.querySelector<HTMLInputElement>("input:checked");
    return OPTIONS.find((option) => option.value === checked?.value)?.value;
  }, []);
  useEarlyInput(picked, value, onChange);

  return (
    <div
      ref={group}
      role="radiogroup"
      aria-label="Interest level"
      aria-describedby={describedBy}
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,--spacing(24)),1fr))] gap-2"
    >
      {OPTIONS.map((option, index) => (
        <label
          key={option.value}
          className={`relative flex min-h-14 press items-center justify-center rounded-xl border-2 bg-surface px-2 text-center text-body font-medium break-words has-checked:bg-primary has-checked:text-primary-foreground ${
            option.value === "no_response" ? "col-span-full" : ""
          } ${option.className}`}
        >
          {/* Over the tile inside its border, so a tap on it lands on the
              radio (one on the border reaches it through the label) and
              its focus ring goes round the tile. Not past the border: the
              tile would then overflow its own box. */}
          <input
            ref={index === 0 ? firstRef : undefined}
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => {
              onChange(option.value);
            }}
            className={`absolute inset-0 appearance-none rounded-xl ${optionClassName}`}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
