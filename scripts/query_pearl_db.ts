import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const draft = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
  if (draft && draft.snapshot) {
    const snapshot = draft.snapshot as any;
    const pearl = snapshot.buildings.find((b: any) => b.name === "Pearl");
    if (pearl) {
      console.log(`DB DraftGraph Pearl -> centerLat: ${pearl.centerLat}, centerLng: ${pearl.centerLng}`);
    } else {
      console.log("Pearl not found in DraftGraph");
    }
  }
}
main().finally(() => prisma.$disconnect());
