import { useEffect, useState, type ReactNode } from "react";

// Animates its children's height via the grid-rows 0fr <-> 1fr trick. Opens on
// mount; set `open={false}` to collapse it (keep it mounted for the transition,
// then remove it — see useInlineEdit).
export function SlideDown({ open = true, children }: { open?: boolean; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    // Flip on the next frame so the transition actually runs.
    const id = requestAnimationFrame(() => setExpanded(open));
    return () => cancelAnimationFrame(id);
  }, [open]);
  return (
    <div
      className={`grid transition-[grid-template-rows] duration-300 ease-out ${
        expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
      }`}
    >
      <div className="overflow-hidden">{children}</div>
    </div>
  );
}
