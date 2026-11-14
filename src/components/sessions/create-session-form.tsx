"use client";

import Link from "next/link";
import { startTransition, useRef, useState } from "react";
import { HouseholdPicker } from "@/components/sessions/household-picker";
import type { FollowUp, OutingSession, SessionKind } from "@/generated/types.gen";
import { ApiRequestError, apiFetch } from "@/lib/api-client";
import { loadAllListed } from "@/lib/follow-ups/listed";
import {
  type ListLoad,
  createBlocker,
  groupForPicking,
  householdIdsOf,
} from "@/lib/follow-ups/pick";
import { SESSION_KINDS } from "@/lib/session/sessions";

const PLACEHOLDER: Record<SessionKind, string> = {
  regular: "Saturday morning, Blk 123",
  follow_up: "Follow-up visits, Saturday",
};

const EMPTY_LIST = "Add households to the follow-up list first.";

type Listed = { load: Exclude<ListLoad, "ready"> } | { load: "ready"; notes: FollowUp[] };

/*
 * Creates the session as a draft. A door-to-door session's blocks are
 * attached afterwards on the detail screen, so the admin is not asked to
 * decide everything before the thing exists. A follow-up session is created
 * with the households it goes back to, at least one: everything on the
 * follow-up list starts ticked, and the admin unticks what this session will
 * not visit. Its kind is chosen here, once: a follow-up session changes who
 * may record where, so it is never switched under members mid-session.
 */
export function CreateSessionForm({ onCreated }: { onCreated: (session: OutingSession) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<SessionKind>("regular");
  const [listed, setListed] = useState<Listed>({ load: "loading" });
  /* What the admin unticked, so a household newly on the list, or read
     again after a refusal, starts ticked like the rest. */
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  /* A retry and a reload after a refusal can overlap; the newest answer wins. */
  const generation = useRef(0);

  /* The answer lands as a transition, as the block screen's do (#155): WebKit
     can run it inside the input event of text landing in the name, and set
     urgently it drew the form again with the name still empty, over what was
     typed (#171). A transition is drawn after the event. */
  async function loadList(): Promise<void> {
    const mine = ++generation.current;
    setListed({ load: "loading" });
    let answer: Listed;
    try {
      answer = { load: "ready", notes: await loadAllListed() };
    } catch {
      answer = { load: "error" };
    }
    if (mine !== generation.current) return;
    startTransition(() => {
      setListed(answer);
    });
  }

  const groups = listed.load === "ready" ? groupForPicking(listed.notes) : [];
  const available = householdIdsOf(groups);
  const ticked = new Set(available.filter((id) => !unticked.has(id)));
  const listEmpty = listed.load === "ready" && available.length === 0;
  const blocker = createBlocker(kind, listed.load, available.length, ticked.size);

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
        body: JSON.stringify(
          kind === "follow_up"
            ? { title: title.trim(), kind, householdIds: [...ticked] }
            : { title: title.trim(), kind },
        ),
      });
      setTitle("");
      setKind("regular");
      setUnticked(new Set());
      setOpen(false);
      onCreated(session);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not create the session.");
      /* A household left the list since it was read: read it again, keeping
         what was unticked. */
      if (error instanceof ApiRequestError && error.code === "not_on_follow_up_list") {
        void loadList();
      }
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
          void loadList();
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
                  <span className="block text-caption text-foreground-muted">
                    {option.value === "follow_up" && listEmpty ? EMPTY_LIST : option.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {/* Outside the card, so a tap on it opens the list rather than
            choosing the kind. */}
        {listEmpty ? (
          <Link
            href="/admin/follow-ups?tab=list"
            className="mt-1 inline-flex min-h-11 items-center text-body font-medium btn-text"
          >
            Open the follow-up list
          </Link>
        ) : null}
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

      {kind === "follow_up" && listed.load === "ready" && !listEmpty ? (
        <fieldset className="mt-4">
          <legend className="mb-1 text-body font-medium">Households to visit</legend>
          <p className="mb-2 text-caption text-foreground-muted">
            Everything on the follow-up list is ticked. Untick any you won&apos;t visit in this
            session.
          </p>
          <HouseholdPicker
            groups={groups}
            ticked={ticked}
            onChange={(next) => {
              setUnticked(new Set(available.filter((id) => !next.has(id))));
            }}
          />
        </fieldset>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={saving || blocker !== null}
          aria-describedby={blocker === null ? undefined : "create-blocker"}
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
      {/* Why Create draft waits, beside it; a failed read is retried here. */}
      {blocker === null ? null : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3">
          <p id="create-blocker" className="text-caption text-foreground-muted">
            {blocker}
          </p>
          {listed.load === "error" ? (
            <button
              type="button"
              onClick={() => void loadList()}
              className="min-h-11 text-body font-medium btn-text"
            >
              Try again
            </button>
          ) : null}
        </div>
      )}
    </form>
  );
}
