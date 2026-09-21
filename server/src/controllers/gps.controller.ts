import { Request, Response } from "express";
import { GpsService } from "../services/gps.service";

export class GpsController {
  static async processPosition(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      if (typeof body.lat !== "number" || typeof body.lng !== "number") {
        res.status(400).json({ success: false, error: "Valid latitude and longitude coordinates are required." });
        return;
      }

      const state = await GpsService.processGpsPosition({
        userId: body.userId,
        lat: body.lat,
        lng: body.lng,
        accuracy: body.accuracy,
        altitude: body.altitude,
        heading: body.heading,
        speed: body.speed,
        floorId: body.floorId,
      });

      res.status(200).json({ success: true, state });
    } catch (err: unknown) {
      console.error("[GpsController] processPosition error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  static getState(req: Request, res: Response): void {
    const rawUserId = req.params.userId;
    const userId = (Array.isArray(rawUserId) ? rawUserId[0] : rawUserId) || "anonymous-visitor";
    const state = GpsService.getUserState(userId);
    if (!state) {
      res.status(404).json({ success: false, error: `No GPS state found for user ID '${userId}'.` });
      return;
    }
    res.status(200).json({ success: true, state });
  }
}
