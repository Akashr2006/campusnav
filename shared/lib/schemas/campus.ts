import { z } from "zod";

export const NodeTypeEnum = z.enum([
  "ENTRANCE",
  "EXIT",
  "RECEPTION",
  "CORRIDOR",
  "JUNCTION",
  "ROOM",
  "LABORATORY",
  "OFFICE",
  "LIFT",
  "STAIR",
  "RAMP",
  "WASHROOM",
  "PARKING",
  "EMERGENCY_EXIT",
  "WATER_POINT",
  "BUS_STOP",
  "OUTDOOR",
  "CUSTOM",
]);

export const EdgeTypeEnum = z.enum([
  "WALK",
  "ROAD",
  "RAMP",
  "STAIRS",
  "LIFT",
  "BRIDGE",
  "SERVICE",
  "RESTRICTED",
  "EMERGENCY",
]);

export const NodeSchema = z.object({
  id: z.string().optional(),
  campusId: z.string().default("c1"),
  floorId: z.string().default("f-out"),
  type: NodeTypeEnum,
  name: z.string().optional(),
  description: z.string().optional(),
  x: z.number(),
  y: z.number(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  searchable: z.boolean().default(false),
  navigable: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

export const EdgeSchema = z.object({
  id: z.string().optional(),
  fromNodeId: z.string(),
  toNodeId: z.string(),
  type: EdgeTypeEnum.default("WALK"),
  distance: z.number().positive(),
  bidirectional: z.boolean().default(true),
  speedModifier: z.number().default(1.0),
  closed: z.boolean().default(false),
  closedReason: z.string().optional(),
  closedUntil: z.string().datetime().optional().nullable(),
});

export const BuildingSchema = z.object({
  id: z.string().optional(),
  campusId: z.string().default("c1"),
  name: z.string().min(1, "Building name is required"),
  shortCode: z.string().min(1, "Short code is required"),
  description: z.string().optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  rotation: z.number().default(0),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  lat: z.number(),
  lng: z.number(),
});

export const FloorSchema = z.object({
  id: z.string().optional(),
  buildingId: z.string(),
  name: z.string().min(1, "Floor name is required"),
  ordinal: z.number().int(),
  isVisible: z.boolean().default(true),
});

export const DestinationSchema = z.object({
  id: z.string().optional(),
  campusId: z.string().default("c1"),
  nodeId: z.string(),
  name: z.string().min(1, "Destination name is required"),
  category: z.string().default("Facility"),
  description: z.string().optional(),
  aliases: z.array(z.string()).default([]),
});

export const ObstacleSchema = z.object({
  id: z.string().optional(),
  campusId: z.string().default("c1"),
  floorId: z.string().optional(),
  x: z.number(),
  y: z.number(),
  radius: z.number().positive().default(15.0),
  edgeIds: z.array(z.string()).default([]),
  reason: z.string().optional(),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const EventSchema = z.object({
  id: z.string().optional(),
  campusId: z.string().default("c1"),
  title: z.string().min(1, "Event title is required"),
  nodeId: z.string().optional(),
  buildingId: z.string().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  description: z.string().optional(),
});

export const GeoCalibrationSchema = z.object({
  id: z.string().optional(),
  campusId: z.string().default("c1"),
  floorId: z.string().optional(),
  canvasX: z.number(),
  canvasY: z.number(),
  lat: z.number(),
  lng: z.number(),
});

export type NodeInput = z.infer<typeof NodeSchema>;
export type EdgeInput = z.infer<typeof EdgeSchema>;
export type BuildingInput = z.infer<typeof BuildingSchema>;
export type FloorInput = z.infer<typeof FloorSchema>;
export type DestinationInput = z.infer<typeof DestinationSchema>;
export type ObstacleInput = z.infer<typeof ObstacleSchema>;
export type EventInput = z.infer<typeof EventSchema>;
export type GeoCalibrationInput = z.infer<typeof GeoCalibrationSchema>;
