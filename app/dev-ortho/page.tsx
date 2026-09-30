import { notFound } from "next/navigation";
import { DevOrthoCapture } from "./capture";

// Only the local dev server captures; production has no mesh on disk to read
// and no endpoint to write to.
export default function DevOrthoPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DevOrthoCapture />;
}
