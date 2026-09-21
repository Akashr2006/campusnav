import { prisma } from "../shared/lib/prisma";
import { getRelationalGraphFromDatabase, publishDraftGraph } from "../lib/services/publish-service";

async function republish() {
  console.log("Assembling full relational graph from PostgreSQL...");
  const relational = await getRelationalGraphFromDatabase();
  if (!relational) {
    console.error("Failed to build relational graph.");
    return;
  }

  console.log(`Relational graph: ${(relational.buildings || []).length} buildings, ${(relational.nodes || []).length} nodes, ${(relational.edges || []).length} edges.`);
  const pubRes = await publishDraftGraph(relational, "admin", "Republished verified graph with photos");
  console.log("Publish result:", pubRes);
}

republish().catch(console.error).finally(() => prisma?.$disconnect());
