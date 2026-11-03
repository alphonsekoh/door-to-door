/*
 * Unit-number helpers.
 *
 * Recording a corridor means typing #05-123, #05-124, #05-125 in sequence. The
 * form suggests the next one so a member advances with one tap instead of
 * retyping a near-identical string at every door.
 */

const DIGITS = /^\d+$/;

/* The contract's unitNumber.maxLength: a form stops the typing there, rather
   than send a unit the server will refuse. */
export const MAX_UNIT_NUMBER_LENGTH = 32;

export type ParsedUnit = { floor: string; unit: string; unitWidth: number };

/*
 * Split rather than captured, so every guard here is one a real input can
 * trip: "#05" has no unit, "05/123" has no dash, "#1-2-3" has too many parts.
 * Capture groups would have needed fallbacks no test could reach.
 */
export function parseUnitNumber(value: string): ParsedUnit | null {
  const [floorPart, unitPart, extra] = value.trim().replace(/^#/, "").split("-");
  if (floorPart === undefined || unitPart === undefined || extra !== undefined) {
    return null;
  }
  const floor = floorPart.trim();
  const unit = unitPart.trim();
  if (!DIGITS.test(floor) || !DIGITS.test(unit)) {
    return null;
  }
  return { floor, unit, unitWidth: unit.length };
}

/*
 * Returns null for anything that is not a recognisable floor-unit pair rather
 * than guessing. A wrong suggestion is worse than none: it would be accepted
 * without thought and record the wrong door.
 */
export function nextUnitNumber(value: string): string | null {
  const parsed = parseUnitNumber(value);
  if (!parsed) {
    return null;
  }
  const next = String(Number(parsed.unit) + 1).padStart(parsed.unitWidth, "0");
  return `#${parsed.floor}-${next}`;
}

/* Normalises what a member types into the form the household key uses. */
export function normaliseUnitNumber(value: string): string {
  const trimmed = value.trim();
  const parsed = parseUnitNumber(trimmed);
  if (!parsed) {
    return trimmed;
  }
  return `#${parsed.floor}-${parsed.unit}`;
}
