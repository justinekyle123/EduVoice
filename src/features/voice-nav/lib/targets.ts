// Voice Navigation Mode (feature 6.14) — turning the visible page into a spoken
// menu.
//
// A student who cannot see (or cannot easily read) the screen still needs to
// reach the buttons, links and fields on it. This module walks the DOM, keeps
// the interactive elements that are actually usable, gives each one a stable
// number and a spoken label, and can activate one on command ("click three").
//
// It is deliberately dependency-free (no React) so the provider can call it
// inside an event handler and the results can be unit-tested.

export type ClickTarget = {
  /** 1-based position in the spoken list: "click 3". */
  index: number;
  /** What the element reads as, used for "click documents". */
  label: string;
  element: HTMLElement;
};

const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "[role='button']",
  "[role='link']",
  "[role='menuitem']",
  "[role='menuitemradio']",
  "[role='tab']",
  "[contenteditable='true']",
].join(",");

/** Marks the voice nav's own console so it never lists itself. */
const SELF_ATTR = "data-voice-nav";

const GENERIC_LABELS = new Set(["a", "button", "input", "select", "textarea", "div", "span"]);

function isVisible(element: HTMLElement): boolean {
  // A file input is usually hidden but is still the thing "upload a document"
  // must trigger, so it counts as usable.
  if (element instanceof HTMLInputElement && element.type === "file") return true;

  if (
    element.hasAttribute("disabled") ||
    element.getAttribute("aria-hidden") === "true"
  ) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;

  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none";
}

/** The best human label for an element: its name, text, or placeholder. */
export function describeElement(element: HTMLElement): string {
  const aria = element.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const source = document.getElementById(labelledBy);
    const text = source?.textContent?.trim();
    if (text) return text;
  }

  const text = element.textContent?.replace(/\s+/g, " ").trim();
  if (text) return text;

  if (element instanceof HTMLInputElement) {
    const placeholder = element.placeholder?.trim();
    if (placeholder) return placeholder;
  }

  if (element instanceof HTMLSelectElement && element.options.length > 0) {
    const selected = element.options[element.selectedIndex]?.text?.trim();
    if (selected) return selected;
  }

  const title = element.getAttribute("title")?.trim();
  if (title) return title;

  const img = element.querySelector("img[alt]");
  const alt = img?.getAttribute("alt")?.trim();
  if (alt) return alt;

  const tag = element.tagName.toLowerCase();
  return GENERIC_LABELS.has(tag) ? `Unnamed ${tag}` : tag;
}

/**
 * Interactive elements currently on screen, in visual order (top-to-bottom,
 * left-to-right), numbered from 1. The voice nav's own console and anything
 * inside it are skipped so the list only contains the app being driven.
 */
export function collectClickTargets(root: ParentNode = document): ClickTarget[] {
  const nodes = Array.from(
    root.querySelectorAll<HTMLElement>(INTERACTIVE_SELECTOR)
  ).filter((element) => {
    if (element.closest(`[${SELF_ATTR}]`)) return false;
    return isVisible(element);
  });

  // Visual order: group by row (within 8px), then left-to-right.
  nodes.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    if (Math.abs(ra.top - rb.top) > 8) return ra.top - rb.top;
    return ra.left - rb.left;
  });

  return nodes.map((element, i) => ({
    index: i + 1,
    label: describeElement(element),
    element,
  }));
}

/** The nth target, or null when the number is out of range. */
export function targetAtIndex(
  targets: readonly ClickTarget[],
  index: number
): ClickTarget | null {
  return targets.find((target) => target.index === index) ?? null;
}

/**
 * The best target for a spoken name: an exact label match first, then a label
 * that contains every word the student said, then a loose substring.
 */
export function targetByName(
  targets: readonly ClickTarget[],
  name: string
): ClickTarget | null {
  const needle = name.toLowerCase().trim();
  if (!needle) return null;

  const exact = targets.find((t) => t.label.toLowerCase() === needle);
  if (exact) return exact;

  const words = needle.split(/\s+/).filter(Boolean);
  const allWords = targets.find((t) => {
    const label = t.label.toLowerCase();
    return words.every((word) => label.includes(word));
  });
  if (allWords) return allWords;

  return targets.find((t) => t.label.toLowerCase().includes(needle)) ?? null;
}

/**
 * Open, press or focus a target the way a person would. Scrolling it into view
 * first means a screen reader (and the student) lands in the right place.
 */
export function activateTarget(target: ClickTarget): void {
  const { element } = target;

  element.scrollIntoView({ block: "center", behavior: "smooth" });

  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
  ) {
    element.focus();
    // A disabled-by-default or readonly field just gets focus; everything else
    // is clicked so file pickers and select menus open.
    if (!element.disabled) element.click();
    return;
  }

  element.focus({ preventScroll: true });
  element.click();
}
