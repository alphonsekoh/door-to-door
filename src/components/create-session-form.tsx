"use client";

import { useState } from "react";
import type { OutingSession } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";

/*
 * Creates the outing as a draft. Blocks are attached afterwards on the detail
 * screen, so the admin is not asked to decide everything before the thing
 * exists - and so a half-filled form cannot be lost.
 */
export function CreateSessionForm({ onCreated }: { onCreated: (session: OutingSession) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  async function save(): Promise<void> {
    if (title.trim() === "") {
      setFailure("Give the outing a name.");
      return;
    }

    setFailure(null);
    setSaving(true);
    try {
      const session = await apiFetch<OutingSession>("/sessions", {
        method: "POST",
        body: JSON.stringify({ title: title.trim() }),
      });
      setTitle("");
      setOpen(false);
      onCreated(session);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not create the outing.");
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
        New outing
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

      <label htmlFor="session-title" className="mb-1 block text-body font-medium">
        Name this outing
      </label>
      <input
        id="session-title"
        value={title}
        onChange={(event) => {
          setTitle(event.target.value);
        }}
        placeholder="Saturday morning, Blk 123"
        className="min-h-12 field"
      />

      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="min-h-12 flex-1 btn-primary rounded-xl text-body font-semibold"
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
