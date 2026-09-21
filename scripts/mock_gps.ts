import { gpsToCanvas } from "../lib/geo/projection";

const lat = 11.492856055;
const lng = 77.280385820;

const computedCanvas = gpsToCanvas(lat, lng);

console.log(JSON.stringify({
  lat,
  lng,
  canvasPos: computedCanvas
}));
