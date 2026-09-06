import { inlineDirectionFragments, type TextDirection } from "../domain/content/inlineDirection";

/** Text nodes only. React escapes source text; attributes and saved values are untouched. */
export function BidiText({ text, dir }: { text: string; dir: TextDirection }) {
  return <>{inlineDirectionFragments(text, dir).map((part, index) => part.ltr ? <bdi dir="ltr" key={index}>{part.text}</bdi> : part.text)}</>;
}
