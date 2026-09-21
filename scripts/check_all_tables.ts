import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  const draftGraphs = await prisma.draftGraph.findMany();
  console.log("DraftGraphs count:", draftGraphs.length);
  for (const dg of draftGraphs) {
    console.log("DraftGraph ID:", dg.id, "Snapshot:", JSON.stringify(dg.snapshot));
  }

  const publishedGraphs = await prisma.publishedGraph.findMany();
  console.log("PublishedGraphs count:", publishedGraphs.length);
  for (const pg of publishedGraphs) {
    console.log("PublishedGraph ID:", pg.id, "Snapshot:", JSON.stringify(pg.snapshot));
  }

  const relationalBuildings = await prisma.building.findMany();
  console.log("Relational Building table count:", relationalBuildings.length);
  for (const b of relationalBuildings) {
    console.log("Relational Building:", JSON.stringify(b));
  }

  await prisma.$disconnect();
}
run();
