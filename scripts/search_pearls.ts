import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function run() {
  console.log("--- ALL BUILDINGS IN DRAFT GRAPH ---");
  const drafts = await prisma.draftGraph.findMany();
  for (const d of drafts) {
    const snapshot = d.snapshot as any;
    const buildings = snapshot?.buildings || [];
    console.log(`DraftGraph ID: ${d.id}, Count: ${buildings.length}`);
    for (const b of buildings) {
      console.log(`ID: ${b.id}, Name: "${b.name}", centerLat: ${b.centerLat}, centerLng: ${b.centerLng}`);
    }
  }

  console.log("\n--- ALL BUILDINGS IN PUBLISHED GRAPH ---");
  const published = await prisma.publishedGraph.findMany();
  for (const p of published) {
    const snapshot = p.snapshot as any;
    const buildings = snapshot?.buildings || [];
    console.log(`PublishedGraph ID: ${p.id}, Count: ${buildings.length}`);
    for (const b of buildings) {
      console.log(`ID: ${b.id}, Name: "${b.name}", centerLat: ${b.centerLat}, centerLng: ${b.centerLng}`);
    }
  }

  await prisma.$disconnect();
}
run();
