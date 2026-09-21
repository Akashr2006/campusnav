import { Router } from "express";
import { GpsController } from "../controllers/gps.controller";

export const gpsRouter = Router();

gpsRouter.post("/position", GpsController.processPosition);
gpsRouter.get("/state/:userId", GpsController.getState);
