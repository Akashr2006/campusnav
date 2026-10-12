import { NavigateView } from "@/features/navigation/components/navigate-view";
import { isDatabaseConfigured } from "@/lib/db-status";
import { readLocalPublished } from "@/lib/local-graph-store";
import { sanitizeSnapshotForPayload } from "@/lib/services/publish-service";

export const metadata = { title: "Navigate · CampusNav" };

// The page is served from the CDN with the campus already in it, and rebuilt in
// the background at most once a minute. It used to load empty and ask
// /api/published-graph, a server function that took ~2.8 s to answer from cold
// (measured from the owner's network), before anything could be drawn.
export const revalidate = 60;

/** The published campus, as /api/published-graph returns it, when it is a local file. */
function publishedGraph(): Record<string, unknown> | null {
  // With a database the page stays light and the client asks the API as before.
  if (isDatabaseConfigured()) return null;
  try {
    const local = readLocalPublished();
    return local ? (sanitizeSnapshotForPayload(local.snapshot, true) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// A self-contained navigator page with its own header: a 2D map plus the drone
// 3D view. The previous NavigateShell is kept in the codebase but no longer mounted here.
export default function NavigatePage() {
  return <NavigateView initialGraph={publishedGraph()} />;
}
