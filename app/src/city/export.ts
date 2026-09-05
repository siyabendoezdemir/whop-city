/**
 * Getting the plan out of the browser.
 *
 * The copy button used to call `navigator.clipboard.writeText`, ignore whether
 * it worked, and say "Copied" either way. That API is unavailable on an
 * insecure origin, can be refused by permissions policy, and throws outside a
 * user gesture in some browsers — so the one moment the product had to be
 * reliable was the one place it was claiming success it had not earned.
 *
 * Two routes now, and neither of them lies:
 *
 *   copy      the async API, then a selection-based fallback, then failure
 *   download  a Blob and an object URL, which needs no permission at all
 *
 * `copyPlan` reports what actually happened so the interface can offer the
 * text for manual selection when both routes fail.
 */

export type CopyResult = "copied" | "unavailable";

async function viaClipboardApi(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * The old route, for insecure origins and browsers that refuse the new one.
 *
 * Deprecated, and still the only thing that works in several real situations a
 * deployment cannot control.
 */
function viaSelection(text: string): boolean {
  if (typeof document === "undefined") return false;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.setAttribute("aria-hidden", "true");
  field.style.cssText = "position:fixed;top:0;left:-9999px;opacity:0";
  document.body.appendChild(field);
  try {
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

export async function copyPlan(text: string): Promise<CopyResult> {
  if (await viaClipboardApi(text)) return "copied";
  return viaSelection(text) ? "copied" : "unavailable";
}

/**
 * Save the plan as a file.
 *
 * Markdown, because the plan is a checklist someone is going to paste into
 * whatever they already use, and because a `.md` opens as readable text
 * everywhere even if nothing renders it.
 */
export function downloadPlan(text: string, name: string): boolean {
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") return false;
  try {
    const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Revoked on the next turn so the download has taken the handle first.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** A filename that sorts, and says what it is without being opened. */
export function planFilename(title: string, now: Date = new Date()): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `whop-city-${now.toISOString().slice(0, 10)}-${slug || "round"}.md`;
}
