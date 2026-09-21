import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

interface QueryResult {
  buildings: Array<{ name: string; [key: string]: unknown }>;
}

async function run() {
  const result = await prisma.$queryRaw<QueryResult[]>`SELECT snapshot->'buildings' as buildings FROM "DraftGraph" WHERE id = 'active-draft'`;
  if (Array.isArray(result) && result.length > 0) {
    const buildings = result[0].buildings;
    const pearl = buildings.find((b: { name: string }) => b.name === "Pearl");
    console.log(JSON.stringify(pearl, null, 2));
  } else {
    console.log("Not found");
  }
  await prisma.$disconnect();
}
run();

