import { Request, Response } from "express";
import { getActivePublishedGraph, sanitizeSnapshotForPayload } from "../../../lib/services/publish-service";
import { NavigationService } from "../services/navigation.service";

export class CampusController {
  static async getPublishedGraph(req: Request, res: Response): Promise<void> {
    try {
      const activeData = await getActivePublishedGraph(true);
      const rawData = activeData?.snapshot ?? { buildings: [], floors: [], nodes: [], edges: [], destinations: [], obstacles: [] };
      const data = sanitizeSnapshotForPayload(rawData);

      res.status(200).json({
        success: true,
        version: activeData?.version ?? 1,
        publishedAt: activeData?.publishedAt ?? new Date(),
        graph: data,
      });
    } catch (err: unknown) {
      console.error("[CampusController] getPublishedGraph error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }

  static async calculateRoute(req: Request, res: Response): Promise<void> {
    try {
      const body = req.body || {};
      const result = await NavigationService.calculateRoute({
        fromNodeId: body.fromNodeId || body.from,
        toNodeId: body.toNodeId || body.to,
        startPoint: body.startPoint,
        endPoint: body.endPoint,
        accessibleOnly: Boolean(body.accessibleOnly),
      });

      if (!result.success) {
        res.status(404).json(result);
        return;
      }

      res.status(200).json(result);
    } catch (err: unknown) {
      console.error("[CampusController] calculateRoute error:", err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
