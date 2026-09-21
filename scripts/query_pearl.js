const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const pearl = await prisma.building.findFirst({
    where: { name: { contains: "Pearl", mode: "insensitive" } }
  });

  if (pearl) {
    console.log("From PostgreSQL Building table:");
    console.log(JSON.stringify({
      id: pearl.id,
      name: pearl.name,
      centerLat: pearl.centerLat,
      centerLng: pearl.centerLng,
      x: pearl.x,
      y: pearl.y,
      width: pearl.width,
      height: pearl.height
    }, null, 2));
  } else {
    console.log("No building named 'Pearl' found in PostgreSQL Building table.");
  }

  const draft = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
  if (draft && draft.snapshot && draft.snapshot.buildings) {
    const draftPearl = draft.snapshot.buildings.find(b => b.name.toLowerCase().includes("pearl"));
    if (draftPearl) {
      console.log("From DraftGraph snapshot:");
      console.log(JSON.stringify({
        id: draftPearl.id,
        name: draftPearl.name,
        centerLat: draftPearl.centerLat,
        centerLng: draftPearl.centerLng,
        x: draftPearl.x,
        y: draftPearl.y,
        width: draftPearl.width,
        height: draftPearl.height
      }, null, 2));
    } else {
      console.log("No Pearl in DraftGraph.");
    }
  } else {
    console.log("No active-draft found or empty buildings.");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
