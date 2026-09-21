/**
 * Optimistic concurrency for the shared campus draft.
 *
 * Every admin tab keeps the whole graph in memory and autosaves it, so a tab
 * holding an older copy used to silently overwrite newer work — and because the
 * next page load reads back what that tab just wrote, the stale copy would stick.
 * Writers now declare the revision they last read; the server rejects anything
 * that is not based on the current one.
 */

export type RevisionCheck =
  | { ok: true }
  | { ok: false; reason: "stale" | "unversioned"; currentRevision: string };

export function checkDraftRevision(
  currentRevision: string | null,
  baseRevision: unknown,
  { force = false }: { force?: boolean } = {}
): RevisionCheck {
  // Nothing stored yet, or the caller deliberately overrides: accept.
  if (!currentRevision || force) return { ok: true };

  if (typeof baseRevision !== "string" || !baseRevision) {
    // A writer that never read the draft cannot know what it is replacing.
    return { ok: false, reason: "unversioned", currentRevision };
  }
  if (baseRevision !== currentRevision) {
    return { ok: false, reason: "stale", currentRevision };
  }
  return { ok: true };
}

export const STALE_DRAFT_MESSAGE =
  "This draft was changed elsewhere. Reload the admin panel to continue from the latest version.";
