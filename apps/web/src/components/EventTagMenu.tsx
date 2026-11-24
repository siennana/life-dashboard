import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CalendarEvent } from "@life/shared";
import { getCalendarEvents, toggleTagEvent } from "../api";
import { TAG_DOT_CLASSES, useTags } from "../lib/tags";

// Right-click menu for a calendar event, replicating the Bank transaction
// menu's Tags section: a checkbox per tag, checking applies the tag to this
// one event (keyed on its CalDAV externalId — per occurrence, not per
// series). The menu stays open so several tags can be toggled in a row.
//
// Hosts use the useEventTagMenu() hook: spread `openEventMenu` onto whatever
// renders events (chips, schedule blocks) and render `eventTagMenu` once.

type MenuState = { event: CalendarEvent; x: number; y: number };

const MENU_W = 208; // w-52

export function useEventTagMenu() {
  const [menu, setMenu] = useState<MenuState | null>(null);

  function openEventMenu(e: React.MouseEvent, event: CalendarEvent) {
    e.preventDefault();
    // Don't also trigger the day cell's own context menu (period toggle).
    e.stopPropagation();
    setMenu({
      event,
      x: Math.min(e.clientX, window.innerWidth - MENU_W - 8),
      y: Math.min(e.clientY, window.innerHeight - 300),
    });
  }

  const eventTagMenu = menu ? <EventTagMenu menu={menu} onClose={() => setMenu(null)} /> : null;
  return { openEventMenu, eventTagMenu, eventMenuOpen: menu !== null };
}

function EventTagMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const tagsQuery = useTags();
  const queryClient = useQueryClient();
  // Checked state reads the live query (not the captured event), so the boxes
  // update as soon as the toggle's invalidation refetches.
  const events = useQuery({ queryKey: ["calendar-events"], queryFn: getCalendarEvents });
  const live =
    events.data?.events.find((ev) => ev.externalId === menu.event.externalId) ?? menu.event;

  const toggle = useMutation({
    mutationFn: (tagId: number) => toggleTagEvent(tagId, menu.event.externalId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["calendar-events"] }),
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Click-away / right-click-away overlay to dismiss the menu. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        className="fixed z-50 w-52 overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800 py-1 text-sm shadow-xl"
        style={{ top: menu.y, left: menu.x }}
      >
        <div className="truncate px-2 pb-1 pt-0.5 text-xs text-zinc-400" title={menu.event.title}>
          {menu.event.title}
        </div>
        <div className="border-t border-zinc-700/60 px-2 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Tags
        </div>
        <div className="max-h-48 overflow-y-auto">
          {(tagsQuery.data?.tags ?? []).map((tag) => {
            const applied = live.tags.some((t) => t.id === tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle.mutate(tag.id)}
                disabled={toggle.isPending}
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-zinc-200 hover:bg-zinc-700/60 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <input
                  type="checkbox"
                  checked={applied}
                  readOnly
                  tabIndex={-1}
                  className="pointer-events-none h-3.5 w-3.5 shrink-0 rounded border-zinc-600 bg-zinc-900 text-blue-500 focus:ring-0"
                />
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${TAG_DOT_CLASSES[tag.color]}`}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              </button>
            );
          })}
          {tagsQuery.isSuccess && (tagsQuery.data?.tags.length ?? 0) === 0 && (
            <p className="px-2 py-1.5 text-xs text-zinc-500">
              No tags yet — Edit Tags in the sidebar.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
