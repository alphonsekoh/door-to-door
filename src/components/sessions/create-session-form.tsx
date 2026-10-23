"use client";

import { useState } from "react";
import type { OutingSession, SessionKind } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { SESSION_KINDS } from "@/lib/session/sessions";

const PLACEHOLDER: Record<SessionKind, string> = {
  regular: "Saturday morning, Blk 123",
  follow_up: "Follow-up visits, Saturday",
};

/*
 * Creates the session as a draft. Blocks are attached afterwards on the detail
 * screen, so the admin is not asked to decide everything before the thing
 * exists - and so a half-filled form cannot be lost. Its kind is chosen here,
 * once: a follow-up session changes who may record where, so it is never
 * switched under members mid-session.
 */
export function CreateSessionForm({ onCreated }: { onCreated: (session: OutingSession) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SessionKind>("regular");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (title.trim() === "") {
      setFailure("Give the session a name.");
      return;
    }

    setFailure(null);
    setSaving(true);
    try {
      const session = await apiFetch<OutingSession>("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), kind }),
      });
      setTitle("");
      setKind("regular");
      setOpen(false);
      onCreated(session);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not create the session.");
    } finally {
      setSaving(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
        }}
        className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
      >
        New session
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      noValidate
      className="rounded-xl border border-border bg-surface p-4"
    >
      {failure === null ? null : (
        <p role="alert" className="mb-3 notice-danger">
          {failure}
        </p>
      )}

      <fieldset>
        <legend className="mb-1 text-body font-medium">What kind of session?</legend>
        {/* Cards stack, so a long hint reflows at large text rather than
            squeezing its neighbour (D-111-25). */}
        <div className="space-y-2">
          {SESSION_KINDS.map((option) => {
            const on = option.value === kind;
            return (
              /* The words drop under the radio once they would have under
                 12ch beside it: at the largest text "Door-to-door" was set
                 a word a line (D-111-35). */
              <label
                key={option.value}
                className={`flex min-h-11 cursor-pointer flex-wrap gap-x-3 gap-y-1 rounded-lg border p-3 ${
                  on ? "border-primary bg-primary/10" : "border-border-strong"
                }`}
              >
                <input
                  type="radio"
                  name="session-kind"
                  value={option.value}
                  checked={on}
                  onChange={() => {
                    setKind(option.value);
                  }}
                  className="mt-1 size-5 shrink-0 accent-primary"
                />
                <span className="min-w-0 flex-[1_1_12ch]">
                  <span className="block text-body font-semibold">{option.label}</span>
                  <span className="block text-caption text-foreground-muted">{option.hint}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-1 text-caption text-foreground-muted">You can&apos;t change this later.</p>
      </fieldset>

      <label htmlFor="session-title" className="mt-4 mb-1 block text-body font-medium">
        Name this session
      </label>
      <input
        id="session-title"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        placeholder={PLACEHOLDER[kind]}
        className="min-h-12 field"
      />

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving}
          className="min-h-12 flex-[1_1_12ch] btn-primary rounded-xl text-body font-semibold"
        >
          {saving ? "Creating…" : "Create draft"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setFailure(null);
          }}
          className="min-h-12 btn-secondary rounded-xl px-4 text-body font-medium"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
