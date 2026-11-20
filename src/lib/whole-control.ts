/*
 * What a control taking focus is, as a member sees it: a checkbox or radio
 * drawn as a tile is the label round it, not the box inside. Brought into
 * view by its input, at large text the tile ran on under a sheet's docked
 * Send. A field with a label of its own elsewhere is itself.
 */
export function wholeControl(element: Element): Element {
  const label = element instanceof HTMLInputElement ? element.labels?.[0] : undefined;
  return label?.contains(element) === true ? label : element;
}

/*
 * A field a member types or picks in. A tile or a button is where the thumb
 * already is, so it is never scrolled to.
 */
export function isEntryField(
  target: EventTarget | null,
): target is HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement {
  if (target instanceof HTMLInputElement) {
    return target.type !== "radio" && target.type !== "checkbox";
  }
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}
