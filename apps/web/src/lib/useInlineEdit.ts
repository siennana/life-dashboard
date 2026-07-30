import { useEffect, useRef, useState } from "react";

// Inline row editing with an exit animation. `editing` stays set during a brief
// `closing` window after close() so the form can animate out (SlideDown
// open={!closing}) before it unmounts. Shared by Reading and Exercise.
export function useInlineEdit<T>(durationMs = 300) {
  const [editing, setEditing] = useState<T | null>(null);
  const [closing, setClosing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function open(row: T) {
    clearTimeout(timer.current);
    setClosing(false);
    setEditing(row);
  }

  function close() {
    clearTimeout(timer.current);
    setClosing(true);
    timer.current = setTimeout(() => {
      setEditing(null);
      setClosing(false);
    }, durationMs);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  return { editing, closing, open, close };
}
