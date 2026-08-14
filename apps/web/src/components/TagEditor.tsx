import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TAG_COLORS, type Tag } from "@life/shared";
import { createTag, deleteTag, updateTag } from "../api";
import { TAG_DOT_CLASSES, TagPill, useTags } from "../lib/tags";
import { PencilIcon, XIcon } from "./icons";

// The tag editor: add input on top, then the tag grid — each row shows the
// pill with edit (rename + recolor swatches) and delete buttons. No save
// button anywhere: every change persists as it's made. Shared by the desktop
// secondary drawer (SideNav) and the mobile /tags page.
export function TagEditor() {
  const tagsQuery = useTags();
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tags"] });
    // Rules render on the Bank page (pills, menu checkboxes) — a rename,
    // recolor, or delete changes what it shows.
    queryClient.invalidateQueries({ queryKey: ["spending"] });
  };
  const create = useMutation({
    mutationFn: createTag,
    onSuccess: () => {
      setNewName("");
      invalidate();
    },
  });
  const update = useMutation({
    mutationFn: ({ id, ...patch }: { id: number; name?: string; color?: Tag["color"] }) =>
      updateTag(id, patch),
    onSuccess: invalidate,
  });
  const remove = useMutation({ mutationFn: deleteTag, onSuccess: invalidate });
  const busy = create.isPending || update.isPending || remove.isPending;
  const error = create.error ?? update.error ?? remove.error;

  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  // Deleting is two-step: the x arms this row, an inline bar asks for the
  // actual Delete (deletion cascades the tag off every merchant — too much to
  // lose to a stray click).
  const [confirmingId, setConfirmingId] = useState<number | null>(null);

  function submitNew() {
    const name = newName.trim();
    if (name.length > 0 && !busy) create.mutate(name);
  }

  function renameTag(tag: Tag, value: string) {
    const name = value.trim();
    if (name.length > 0 && name !== tag.name) update.mutate({ id: tag.id, name });
  }

  const tags = tagsQuery.data?.tags ?? [];

  return (
    <div>
      {/* Add: Enter or the + button commits; the list refresh clears it. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submitNew();
        }}
        className="flex items-center gap-1.5"
      >
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="New tag…"
          maxLength={40}
          className="min-w-0 flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || newName.trim().length === 0}
          className="shrink-0 cursor-pointer rounded-lg border border-emerald-700/60 px-2.5 py-1.5 text-sm text-emerald-400 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Add
        </button>
      </form>

      {tagsQuery.isPending && <p className="mt-3 text-sm text-zinc-500">Loading…</p>}
      {tagsQuery.isError && (
        <p className="mt-3 text-sm text-red-400">
          Couldn't load tags — {(tagsQuery.error as Error).message}
        </p>
      )}

      <ul className="mt-3 divide-y divide-zinc-800/60">
        {tags.map((tag) => (
          <li key={tag.id} className="py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="min-w-0 flex-1">
                <TagPill tag={tag} />
              </span>
              <button
                type="button"
                onClick={() => setEditingId((cur) => (cur === tag.id ? null : tag.id))}
                aria-label={`Edit ${tag.name}`}
                aria-expanded={editingId === tag.id}
                className={`flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-zinc-800 ${
                  editingId === tag.id ? "text-zinc-200" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <PencilIcon className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setConfirmingId((cur) => (cur === tag.id ? null : tag.id))}
                disabled={busy}
                aria-label={`Delete ${tag.name}`}
                aria-expanded={confirmingId === tag.id}
                title="Delete tag (removes it from every merchant)"
                className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-zinc-500 hover:bg-red-500/10 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            </div>
            {confirmingId === tag.id && (
              <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-red-900/60 bg-red-500/5 px-2 py-1.5 text-xs">
                <span className="min-w-0 flex-1 text-zinc-300">
                  Delete <span className="font-medium text-zinc-100">#{tag.name}</span>
                  {(tag.merchants ?? 0) > 0
                    ? ` and remove it from ${tag.merchants} merchant${tag.merchants === 1 ? "" : "s"}?`
                    : "?"}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmingId(null);
                    remove.mutate(tag.id);
                  }}
                  disabled={busy}
                  className="shrink-0 cursor-pointer rounded border border-red-800/70 px-2 py-0.5 text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingId(null)}
                  className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-zinc-400 hover:bg-zinc-700/50"
                >
                  Cancel
                </button>
              </div>
            )}
            {editingId === tag.id && (
              <div className="mt-2 space-y-2 pl-1">
                <input
                  type="text"
                  autoFocus
                  defaultValue={tag.name}
                  maxLength={40}
                  onBlur={(e) => renameTag(tag, e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
                />
                <div className="flex items-center gap-1.5">
                  {TAG_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => update.mutate({ id: tag.id, color })}
                      disabled={busy}
                      aria-label={`Set ${tag.name} to ${color}`}
                      className={`flex h-5 w-5 cursor-pointer items-center justify-center rounded-full disabled:cursor-not-allowed ${
                        tag.color === color ? "ring-1 ring-zinc-300" : "hover:ring-1 hover:ring-zinc-600"
                      }`}
                    >
                      <span className={`h-3 w-3 rounded-full ${TAG_DOT_CLASSES[color]}`} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </li>
        ))}
        {tagsQuery.isSuccess && tags.length === 0 && (
          <li className="py-1.5 text-sm text-zinc-500">No tags yet — add one above.</li>
        )}
      </ul>

      {error != null && (
        <p className="mt-2 text-xs text-red-400">Couldn't save — {(error as Error).message}</p>
      )}
    </div>
  );
}
