import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    const draft = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
    console.log("Draft found:", !!draft);
  } catch (e) {
    console.error(e);
  } finally {
    await prisma.$disconnect();
  }
}

main();
