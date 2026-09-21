import { prisma } from "../lib/db";
import { getActivePublishedGraph, publishDraftGraph } from "../lib/services/publish-service";
import { GET as getPublishedGraphRoute } from "../app/api/published-graph/route";

async function runVerification() {
  console.log("============================================================");
  console.log("PERSISTENCE PIPELINE END-TO-END AUDIT & VERIFICATION");
  console.log("============================================================");

  if (!prisma) {
    throw new Error("Prisma client is not available.");
  }

  // 1. Read Current State directly from Database
  const initialPub = await getActivePublishedGraph(true);
  console.log("1. Initial DB Published Graph Version:", initialPub?.version);
  console.log("   - Buildings in DB:", initialPub?.snapshot?.buildings?.length);
  console.log("   - Nodes in DB:", initialPub?.snapshot?.nodes?.length);
  console.log("   - Edges in DB:", initialPub?.snapshot?.edges?.length);

  const initialVersion = initialPub?.version ?? 1;
  const currentSnapshot = initialPub?.snapshot ?? {
    buildings: [],
    floors: [],
    nodes: [],
    edges: [],
    destinations: [],
    obstacles: [],
  };

  // 2. Perform a non-destructive publish test with existing snapshot
  console.log("\n2. Executing publishDraftGraph transaction...");
  const publishResult = await publishDraftGraph(
    currentSnapshot,
    "system-audit-admin",
    "Automated persistence pipeline verification"
  );

  console.log("   - Publish result success:", publishResult.success);
  console.log("   - New Version Number:", publishResult.version);
  console.log("   - Validation health score:", publishResult.validationReport.healthScore);

  if (!publishResult.success) {
    throw new Error(`Publish failed: ${publishResult.error}`);
  }

  // 3. Direct PostgreSQL Verification
  console.log("\n3. Querying PostgreSQL tables directly to verify persistence...");
  const dbPubRecord = await prisma.publishedGraph.findUnique({ where: { id: "active-published" } });
  const dbDraftRecord = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
  const dbMapVersion = await prisma.mapVersion.findFirst({ where: { version: publishResult.version } });
  const dbBuildings = await prisma.building.findMany();
  const dbNodes = await prisma.node.findMany();
  const dbEdges = await prisma.edge.findMany();

  console.log("   - PublishedGraph table record exists:", Boolean(dbPubRecord));
  console.log("   - PublishedGraph version in DB:", dbPubRecord?.version);
  console.log("   - DraftGraph table record exists:", Boolean(dbDraftRecord));
  console.log("   - MapVersion row exists for version:", dbMapVersion?.version);
  console.log("   - Relational Buildings count in DB:", dbBuildings.length);
  console.log("   - Relational Nodes count in DB:", dbNodes.length);
  console.log("   - Relational Edges count in DB:", dbEdges.length);

  if (dbPubRecord?.version !== publishResult.version) {
    throw new Error(`DB version mismatch! Expected ${publishResult.version}, got ${dbPubRecord?.version}`);
  }

  // 4. API Route Verification (GET /api/published-graph)
  console.log("\n4. Calling GET /api/published-graph endpoint...");
  const res = await getPublishedGraphRoute();
  const json = await res.json();

  console.log("   - API response status:", res.status);
  console.log("   - API returned version:", json.version);
  console.log("   - API returned buildings count:", json.graph?.buildings?.length);
  console.log("   - API returned nodes count:", json.graph?.nodes?.length);
  console.log("   - API returned edges count:", json.graph?.edges?.length);

  if (json.version !== publishResult.version) {
    throw new Error(`API version mismatch! Expected ${publishResult.version}, got ${json.version}`);
  }

  console.log("\n============================================================");
  console.log("ALL PIPELINE CHECKS PASSED: DATA PERSISTED & SYNC CONFIRMED");
  console.log("============================================================");
}

runVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Verification failed:", err);
    process.exit(1);
  });
