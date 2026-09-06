export type TextDirection = "rtl" | "ltr";
export interface InlineFragment { text: string; ltr: boolean }

/** Display-only segmentation. Joining the fragments reproduces the exact input. */
export function inlineDirectionFragments(text: string, dir: TextDirection): InlineFragment[] {
  if (dir === "ltr" || !text) return [{ text, ltr: false }];
  // URLs have their own grammar: query separators belong inside the isolate. Ordinary
  // words join across spaces, but not sentence punctuation (RTK, SLAM stays two runs).
  const tokens = /(?:https?:\/\/|www\.|mailto:)[^\s<>"'\u0590-\u08ff]+|[+−-]?[\p{Script=Latin}\d][\p{Script=Latin}\p{M}\d²³°%]*(?:[._+@:/’'-][\p{Script=Latin}\p{M}\d²³°%]+)*/gu;
  const runs: { start: number; end: number; url: boolean }[] = [];
  for (const match of text.matchAll(tokens)) {
    const start = match.index;
    let value = match[0];
    const url = /^(?:https?:\/\/|www\.|mailto:)/i.test(value);
    if (url) {
      // Keep balanced URL parentheses; detach closing prose brackets and punctuation.
      while (value) {
        const last = value.at(-1)!;
        const opening = ({ ")": "(", "]": "[", "}": "{" } as Record<string, string>)[last];
        if (/[.,;:!?…’”]/.test(last) || (opening && value.split(last).length > value.split(opening).length)) value = value.slice(0, -1);
        else break;
      }
    }
    const previous = runs.at(-1);
    if (previous && !url && !previous.url && /^[ \t\u00a0]+$/.test(text.slice(previous.end, start))) previous.end = start + value.length;
    else runs.push({ start, end: start + value.length, url });
  }
  const fragments: InlineFragment[] = [];
  let offset = 0;
  for (const run of runs) {
    const value = text.slice(run.start, run.end);
    if (!/\p{Script=Latin}/u.test(value)) continue;
    if (run.start > offset) fragments.push({ text: text.slice(offset, run.start), ltr: false });
    fragments.push({ text: value, ltr: true });
    offset = run.end;
  }
  if (offset < text.length) fragments.push({ text: text.slice(offset), ltr: false });
  return fragments;
}

/** Known HE/AR stays RTL even when its headline starts with a Latin product name. */
export function articleDirection(language?: string | null, text = ""): TextDirection {
  return language === "HE" || language === "AR" || (!language && /[\u0590-\u08ff]/u.test(text)) ? "rtl" : "ltr";
}
