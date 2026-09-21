import { Router } from "express";
import { CampusController } from "../controllers/campus.controller";

export const campusRouter = Router();

campusRouter.get("/graph", CampusController.getPublishedGraph);
campusRouter.post("/route", CampusController.calculateRoute);
