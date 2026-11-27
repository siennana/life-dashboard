import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { DaySearchHit } from "@life/shared";
import { searchDayLogs } from "../api";
import { SearchIcon, XIcon } from "../components/icons";

// Debounce (ms) between the last keystroke and the search request.
const DEBOUNCE_MS = 200;
// Shortest query that triggers a request — one char matches nearly every day.
const MIN_QUERY = 2;

// "Nov 27, 2026" from a YYYY-MM-DD key, built from parts so the day is not
// shifted by a UTC parse.
function hitDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// Search box over the day logs (journal) with a results dropdown: date on the
// left, then the snippet with the matched substring in bold. Choosing a row
// hands the date to `onSelect`, which the Calendar page turns into a jump to
// that month + an opened day. The query text stays so another hit can be
// picked right after; the list reopens on focus/typing.
export function JournalSearch({
  onSelect,
  className = "",
}: {
  onSelect: (date: string) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [text]);

  const enabled = debounced.length >= MIN_QUERY;
  const results = useQuery({
    queryKey: ["day-search", debounced],
    queryFn: () => searchDayLogs(debounced),
    enabled,
    placeholderData: keepPreviousData,
  });
  const hits: DaySearchHit[] = enabled ? results.data?.hits ?? [] : [];

  // Keep the keyboard cursor inside the list as results change.
  useEffect(() => {
    setActive((a) => Math.min(a, Math.max(0, hits.length - 1)));
  }, [hits.length]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  function choose(hit: DaySearchHit) {
    onSelect(hit.date);
    setOpen(false);
    inputRef.current?.blur();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (open) setOpen(false);
      else setText("");
      return;
    }
    if (!open || hits.length === 0) {
      if (e.key === "ArrowDown") setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % hits.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) choose(hit);
    }
  }

  const showList = open && text.trim().length >= MIN_QUERY;
  const listId = "journal-search-results";

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <div className="flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1 text-sm text-zinc-300 focus-within:border-zinc-600">
        <SearchIcon className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Search journal"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          placeholder="Search journal"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 bg-transparent text-zinc-100 placeholder:text-zinc-500 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {text && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setText("");
              setOpen(false);
              inputRef.current?.focus();
            }}
            className="shrink-0 text-zinc-500 hover:text-zinc-200"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-80 overflow-y-auto rounded-lg border border-zinc-700 bg-zinc-800 py-1 shadow-xl"
        >
          {hits.length === 0 ? (
            <li className="px-3 py-2 text-xs text-zinc-500">
              {results.isPending && enabled
                ? "Searching..."
                : results.isError
                  ? `Search failed - ${(results.error as Error).message}`
                  : "No journal entries match"}
            </li>
          ) : (
            hits.map((hit, i) => (
              <li
                key={hit.date}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(hit)}
                className={`flex cursor-pointer items-baseline gap-3 px-3 py-1.5 text-sm ${
                  i === active ? "bg-zinc-700/70" : ""
                }`}
              >
                <span className="w-28 shrink-0 whitespace-nowrap text-xs tabular-nums text-zinc-400">
                  {hitDate(hit.date)}
                </span>
                <span className="min-w-0 flex-1 truncate text-zinc-300" title={hit.before + hit.match + hit.after}>
                  {hit.before}
                  <b className="font-semibold text-zinc-100">{hit.match}</b>
                  {hit.after}
                </span>
                {hit.matches > 1 && (
                  <span className="shrink-0 text-[10px] text-zinc-500">x{hit.matches}</span>
                )}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
