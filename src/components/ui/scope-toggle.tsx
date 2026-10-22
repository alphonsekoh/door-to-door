"use client";

import type { RecordScope } from "@/lib/team-view";

const OPTIONS: { value: RecordScope; label: string }[] = [
  { value: "me", label: "Me" },
  { value: "team", label: "My team" },
];

/* Two pressed-state buttons rather than a switch: the words say which view
   is on, so it never rests on colour alone. */
export function ScopeToggle({
  scope,
  onChange,
}: {
  scope: RecordScope;
  onChange: (scope: RecordScope) => void;
}) {
  return (
    <div role="group" aria-label="Whose records" className="flex gap-2">
      {OPTIONS.map((option) => {
        const on = option.value === scope;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={on}
            onClick={() => {
              if (!on) onChange(option.value);
            }}
            className={`min-h-11 flex-1 press rounded-lg border text-body font-medium ${
              on ? "border-primary bg-primary text-primary-foreground" : "border-border-strong"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
