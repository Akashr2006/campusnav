import { PrismaClient, NodeType, EdgeType, MapStatus, FloorType } from "@prisma/client";

const prisma = new PrismaClient();

const PERMISSIONS = [
  "campus.read", "campus.create", "campus.update", "campus.delete",
  "building.read", "building.create", "building.update", "building.delete",
  "floor.read", "floor.create", "floor.update", "floor.delete",
  "room.read", "room.create", "room.update", "room.delete",
  "node.read", "node.create", "node.update", "node.delete",
  "edge.read", "edge.create", "edge.update", "edge.delete",
  "map.publish", "map.rollback",
  "navigation.read", "analytics.read",
];

const ROLES: Record<string, string[]> = {
  guest: ["navigation.read"],
  student: ["navigation.read"],
  faculty: ["navigation.read"],
  admin: PERMISSIONS.filter((p) => !p.startsWith("map.")),
  super_admin: PERMISSIONS,
};

async function main() {
  for (const key of PERMISSIONS) {
    const [resource, action] = key.split(".");
    await prisma.permission.upsert({
      where: { key },
      create: { key, resource, action },
      update: {},
    });
  }

  for (const [name, perms] of Object.entries(ROLES)) {
    const role = await prisma.role.upsert({
      where: { name },
      create: { name, isSystem: true },
      update: {},
    });
    const permissions = await prisma.permission.findMany({
      where: { key: { in: perms } },
    });
    for (const p of permissions) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: p.id } },
        create: { roleId: role.id, permissionId: p.id },
        update: {},
      });
    }
  }

  const campus = await prisma.campus.upsert({
    where: { slug: "main" },
    create: {
      name: "Main Campus",
      slug: "main",
      latitude: 12.9716,
      longitude: 77.5946,
      status: MapStatus.PUBLISHED,
    },
    update: {},
  });

  const building = await prisma.building.upsert({
    where: { campusId_shortCode: { campusId: campus.id, shortCode: "AB1" } },
    create: {
      campusId: campus.id,
      name: "Admin Block",
      shortCode: "AB1",
      status: MapStatus.PUBLISHED,
    },
    update: {},
  });

  const floor = await prisma.floor.upsert({
    where: { buildingId_ordinal: { buildingId: building.id, ordinal: 0 } },
    create: {
      buildingId: building.id,
      name: "Ground Floor",
      ordinal: 0,
      type: FloorType.GROUND,
    },
    update: {},
  });

  const entrance = await prisma.node.create({
    data: {
      campusId: campus.id,
      floorId: floor.id,
      type: NodeType.ENTRANCE,
      name: "Admin Block Entrance",
      latitude: 12.9716,
      longitude: 77.5946,
    },
  });

  const reception = await prisma.node.create({
    data: {
      campusId: campus.id,
      floorId: floor.id,
      type: NodeType.RECEPTION,
      name: "Reception",
      latitude: 12.97165,
      longitude: 77.5946,
    },
  });

  await prisma.edge.create({
    data: {
      fromNodeId: entrance.id,
      toNodeId: reception.id,
      type: EdgeType.WALK,
      distance: 8,
      status: MapStatus.PUBLISHED,
    },
  });

  await prisma.destination.create({
    data: {
      campusId: campus.id,
      nodeId: reception.id,
      name: "Reception",
      category: "Facility",
      aliases: {
        create: [{ alias: "Front Desk" }, { alias: "Help Desk" }],
      },
    },
  });

  console.log("Seed complete.");
}

main().finally(() => prisma.$disconnect());
