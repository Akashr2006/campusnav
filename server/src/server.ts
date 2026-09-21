import express from "express";
import http from "http";
import cors from "cors";
import { Server as SocketIOServer } from "socket.io";
import { campusRouter } from "./routes/campus.routes";
import { gpsRouter } from "./routes/gps.routes";
import { GpsService } from "./services/gps.service";

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

app.use(cors());
app.use(express.json());

// API Route Endpoints
app.use("/api/campus", campusRouter);
app.use("/api/gps", gpsRouter);

app.get("/health", (req, res) => {
  res.status(200).json({ status: "OK", service: "CampusNav Backend Engine", timestamp: new Date().toISOString() });
});

// Socket.IO Real-time WebSocket Listeners
io.on("connection", (socket) => {
  console.log(`[WebSocket] Client connected: ${socket.id}`);

  socket.on("gps:update", async (data) => {
    try {
      const processed = await GpsService.processGpsPosition({
        userId: data.userId || socket.id,
        lat: data.lat,
        lng: data.lng,
        accuracy: data.accuracy,
        altitude: data.altitude,
        heading: data.heading,
        speed: data.speed,
        floorId: data.floorId,
      });

      socket.emit("gps:state", processed);
      socket.broadcast.emit("gps:user_moved", processed);
    } catch (err) {
      socket.emit("error", { message: "Failed to process GPS position" });
    }
  });

  socket.on("disconnect", () => {
    console.log(`[WebSocket] Client disconnected: ${socket.id}`);
  });
});

const PORT = process.env.SERVER_PORT || 3001;

server.listen(PORT, () => {
  console.log(`[CampusNav Server] Service running on http://localhost:${PORT}`);
});

export { app, server, io };
