"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Block, BlockList } from "@/generated/types.gen";
import { apiFetch } from "@/lib/api-client";
import { Sheet, SheetActions } from "@/components/sheet";

/*
 * Pick blocks from the registry, or add one that is not in it yet.
 *
 * The inline create matters on a doorstep: an admin who has to leave this
 * screen to register a block will attach the wrong one instead.
 */
export function BlockAttachSheet({
  attachedIds,
  onAttach,
  onClose,
}: {
  attachedIds: string[];
  onAttach: (blockIds: string[]) => Promise<void>;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  /*
   * A search that lands after a newer one - or after a block was registered
   * here - must not overwrite what is on screen, whether it brings rows or an
   * error. Typing "12" then "125" issues two requests, and nothing guarantees
   * they come back in that order.
   */
  const generation = useRef(0);

  const load = useCallback(async (term: string) => {
    const mine = ++generation.current;
    try {
      const query = term.trim() === "" ? "" : `&search=${encodeURIComponent(term.trim())}`;
      const page = await apiFetch<BlockList>(`/blocks?limit=50${query}`);
      if (mine === generation.current) {
        setBlocks(page.data);
      }
    } catch (error) {
      if (mine === generation.current) {
        setFailure(error instanceof Error ? error.message : "Could not load the blocks.");
      }
    }
  }, []);

  /* The debounce is for typing; opening the sheet, or clearing the search,
     loads the list without waiting for keystrokes that are not coming. */
  useEffect(() => {
    const timer = setTimeout(() => void load(search), search === "" ? 0 : 200);
    return () => {
      clearTimeout(timer);
    };
  }, [load, search]);

  async function createBlock(): Promise<void> {
    if (name.trim() === "" || street.trim() === "") {
      setFailure("A block needs a number and a street.");
      return;
    }
    setFailure(null);
    setBusy(true);
    try {
      const block = await apiFetch<Block>("/blocks", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), street: street.trim() }),
      });
      generation.current += 1;
      setBlocks((current) => [block, ...current]);
      setChosen((current) => [...current, block.id]);
      setName("");
      setStreet("");
      setCreating(false);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not add that block.");
    } finally {
      setBusy(false);
    }
  }

  async function attach(): Promise<void> {
    setFailure(null);
    setBusy(true);
    try {
      await onAttach(chosen);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not attach those blocks.");
    } finally {
      setBusy(false);
    }
  }

  const available = blocks.filter((block) => !attachedIds.includes(block.id));

  return (
    <Sheet label="Add blocks" title="Add blocks" onClose={onClose}>
      {failure === null ? null : (
        <p role="alert" className="mt-3 notice-danger">
          {failure}
        </p>
      )}

      <div className="mt-3">
        <label htmlFor="block-search" className="sr-only">
          Search the block registry
        </label>
        <input
          id="block-search"
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
          placeholder="Block number or street"
          className="min-h-12 field"
        />
      </div>

      {available.length === 0 ? (
        <p className="mt-3 text-body text-foreground-muted">
          Nothing left to attach here. Add a new block below.
        </p>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-xl border border-border bg-surface">
          {available.map((block) => {
            const picked = chosen.includes(block.id);
            return (
              <li key={block.id}>
                {/* At large text Select drops under the block rather than cut
                    its street to a few letters. */}
                <button
                  type="button"
                  aria-pressed={picked}
                  onClick={() => {
                    setChosen((current) =>
                      picked ? current.filter((id) => id !== block.id) : [...current, block.id],
                    );
                  }}
                  className="flex min-h-14 w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border press-row px-4 py-2 text-left last:border-b-0"
                >
                  <span className="min-w-0 flex-[1_1_12ch]">
                    <span className="block text-body font-semibold">Blk {block.name}</span>
                    <span className="block truncate text-caption text-foreground-muted">
                      {block.street}
                    </span>
                  </span>
                  <span className="ml-auto shrink-0 text-body font-medium text-primary">
                    {picked ? "Selected" : "Select"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {creating ? (
        <div className="mt-3 space-y-3 rounded-xl border border-border bg-surface p-4">
          <div>
            <label htmlFor="new-block-name" className="mb-1 block text-body font-medium">
              Block number
            </label>
            <input
              id="new-block-name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
              }}
              className="min-h-12 field"
            />
          </div>
          <div>
            <label htmlFor="new-block-street" className="mb-1 block text-body font-medium">
              Street
            </label>
            <input
              id="new-block-street"
              value={street}
              onChange={(event) => {
                setStreet(event.target.value);
              }}
              className="min-h-12 field"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void createBlock()}
            className="min-h-12 w-full btn-secondary rounded-xl text-body font-medium"
          >
            {busy ? "Adding…" : "Add to the registry"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setCreating(true);
          }}
          className="mt-3 min-h-11 text-body font-medium btn-text"
        >
          Block not listed?
        </button>
      )}

      <SheetActions>
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={() => void attach()}
          className="min-h-14 w-full btn-primary rounded-xl text-title font-semibold"
        >
          {chosen.length === 0
            ? "Select a block"
            : `Attach ${String(chosen.length)} ${chosen.length === 1 ? "block" : "blocks"}`}
        </button>
      </SheetActions>
    </Sheet>
  );
}
