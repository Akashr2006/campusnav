import { getCenterFromCorners } from "../lib/geo/projection";

const corners = [
  { lat: 11.492856055, lng: 77.280385820 },
  { lat: 11.492330570, lng: 77.280423489 },
  { lat: 11.492372561, lng: 77.281263366 },
  { lat: 11.492890599, lng: 77.281224536 }
];

console.log(getCenterFromCorners(corners));
