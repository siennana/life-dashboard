import { useQuery } from "@tanstack/react-query";
import type { Tag, TagColor } from "@life/shared";
import { getTags } from "../api";

// Tag color tokens → static Tailwind classes (dynamic class names can't be
// generated at runtime — Tailwind only ships what it can see). text-*-300
// steps flip to their dark counterparts in the light theme via index.css.
export const TAG_PILL_CLASSES: Record<TagColor, string> = {
  zinc: "bg-zinc-500/15 text-zinc-300",
  red: "bg-red-500/15 text-red-300",
  amber: "bg-amber-500/15 text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  sky: "bg-sky-500/15 text-sky-300",
  blue: "bg-blue-500/15 text-blue-300",
  violet: "bg-violet-500/15 text-violet-300",
  pink: "bg-pink-500/15 text-pink-300",
};

// Icon/text tint per color — the compact hashtag marks in grid tag columns.
export const TAG_TEXT_CLASSES: Record<TagColor, string> = {
  zinc: "text-zinc-400",
  red: "text-red-400",
  amber: "text-amber-400",
  emerald: "text-emerald-400",
  sky: "text-sky-400",
  blue: "text-blue-400",
  violet: "text-violet-400",
  pink: "text-pink-400",
};

// Solid swatch dots for the color picker.
export const TAG_DOT_CLASSES: Record<TagColor, string> = {
  zinc: "bg-zinc-400",
  red: "bg-red-400",
  amber: "bg-amber-400",
  emerald: "bg-emerald-400",
  sky: "bg-sky-400",
  blue: "bg-blue-400",
  violet: "bg-violet-400",
  pink: "bg-pink-400",
};

export function TagPill({ tag }: { tag: Tag }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-xs ${TAG_PILL_CLASSES[tag.color]}`}
    >
      #{tag.name}
    </span>
  );
}

// The full tag list, shared by the editor drawer and the Bank row menus.
export const useTags = () => useQuery({ queryKey: ["tags"], queryFn: getTags });
