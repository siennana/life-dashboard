import { TagEditor } from "../components/TagEditor";

// Full-page tag editor — the mobile form of the sidebar's Edit Tags drawer
// (the MobileHeader supplies the back link). Works on desktop too if visited
// directly.
export function TagsPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Edit Tags</h1>
      <div className="mt-4 max-w-sm">
        <TagEditor />
      </div>
    </>
  );
}
