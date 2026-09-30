import { NavigateView } from "@/features/navigation/components/navigate-view";

export const metadata = { title: "Navigate · CampusNav" };

// A self-contained navigator page with its own header: a 2D floor-plan style
// map plus the /navigate-3d scene (unchanged). The previous NavigateShell is
// kept in the codebase but no longer mounted here.
export default function NavigatePage() {
  return <NavigateView />;
}
