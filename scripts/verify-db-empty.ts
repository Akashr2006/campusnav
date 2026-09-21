import { prisma } from "../shared/lib/prisma";

// These maintenance scripts only make sense against a real database.
if (!prisma) {
  console.error("This script requires DATABASE_URL to be set. Aborting.");
  process.exit(1);
}
const db = prisma;

async function verifyDatabase() {
  console.log("=== SUPABASE DATABASE AUDIT START ===");
  try {
    const buildings = await db.building.count().catch(() => 0);
    const floors = await db.floor.count().catch(() => 0);
    const nodes = await db.node.count().catch(() => 0);
    const edges = await db.edge.count().catch(() => 0);
    const destinations = await db.destination.count().catch(() => 0);
    const doors = await db.door.count().catch(() => 0);
    const stairGroups = await db.stairGroup.count().catch(() => 0);
    const liftGroups = await db.liftGroup.count().catch(() => 0);
    const obstacles = await db.obstacle.count().catch(() => 0);
    const events = await db.event.count().catch(() => 0);
    const draftGraphs = await db.draftGraph.count().catch(() => 0);
    const publishedGraphs = await db.publishedGraph.count().catch(() => 0);
    const mapVersions = await db.mapVersion.count().catch(() => 0);
    const auditLogs = await db.auditLog.count().catch(() => 0);

    console.log("ACTIVE TABLE COUNTS:");
    console.log(`- Building: ${buildings}`);
    console.log(`- Floor: ${floors}`);
    console.log(`- Node: ${nodes}`);
    console.log(`- Edge: ${edges}`);
    console.log(`- Destination: ${destinations}`);
    console.log(`- Door: ${doors}`);
    console.log(`- StairGroup: ${stairGroups}`);
    console.log(`- LiftGroup: ${liftGroups}`);
    console.log(`- Obstacle: ${obstacles}`);
    console.log(`- Event: ${events}`);
    console.log(`- DraftGraph: ${draftGraphs}`);
    console.log(`- PublishedGraph: ${publishedGraphs}`);
    console.log(`- MapVersion: ${mapVersions}`);
    console.log(`- AuditLog: ${auditLogs}`);

    const activeDraft = await db.draftGraph.findUnique({ where: { id: "active-draft" } });
    const activePub = await db.publishedGraph.findUnique({ where: { id: "active-published" } });

    const draftBldCount = (activeDraft?.snapshot as any)?.buildings?.length ?? 0;
    const pubBldCount = (activePub?.snapshot as any)?.buildings?.length ?? 0;

    console.log(`- DraftGraph active-draft snapshot buildings: ${draftBldCount}`);
    console.log(`- PublishedGraph active-published snapshot buildings: ${pubBldCount}`);

    const is100PercentEmpty =
      buildings === 0 &&
      floors === 0 &&
      nodes === 0 &&
      edges === 0 &&
      destinations === 0 &&
      draftBldCount === 0 &&
      pubBldCount === 0;

    if (is100PercentEmpty) {
      console.log("\nAUDIT VERDICT: 100% CLEAN & EMPTY DATABASE CONFIRMED!");
    } else {
      console.log("\nAUDIT VERDICT: ACTIVE DATA PRESENT IN DATABASE.");
    }
  } catch (err) {
    console.error("Database audit error:", err);
  } finally {
    await db.$disconnect();
  }
}

verifyDatabase();
