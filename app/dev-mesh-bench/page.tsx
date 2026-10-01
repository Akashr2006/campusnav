import { notFound } from "next/navigation";
import { MeshBench } from "./bench";

// Dev-only load benchmark for the drone mesh (driven by tools/drone/bench-mesh.mjs).
export default function DevMeshBenchPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <MeshBench />;
}
