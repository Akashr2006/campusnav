const corners = [
  { lat: 11.492856055, lng: 77.280385820 },
  { lat: 11.492330570, lng: 77.280423489 },
  { lat: 11.492372561, lng: 77.281263366 },
  { lat: 11.492890599, lng: 77.281224536 }
];

const avgLat = corners.reduce((sum, c) => sum + c.lat, 0) / corners.length;
const avgLng = corners.reduce((sum, c) => sum + c.lng, 0) / corners.length;
console.log({ lat: avgLat, lng: avgLng });
