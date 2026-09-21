/**
 * Catalogue of the BIT Sathyamangalam 360 virtual tour
 * (https://campustour.bitsathy.ac.in), read from the tour player itself.
 *
 * The tour is embedded by deep link rather than copied, so the panoramas stay
 * hosted and maintained at source.
 */

export const TOUR_BASE_URL = "https://campustour.bitsathy.ac.in";

export type TourScene = { index: number; label: string };

/** Deep link to one panorama; the player reads `media-index` on load. */
export function tourSceneUrl(index: number) {
  return `${TOUR_BASE_URL}/?media-index=${index}`;
}

export const TOUR_SCENES: TourScene[] = [
  { index: 0, label: "BIT Main Gate" },
  { index: 1, label: "Training Academy" },
  { index: 2, label: "Vehicle Parking" },
  { index: 3, label: "Parking Entry" },
  { index: 4, label: "Parking" },
  { index: 5, label: "Parking Exit" },
  { index: 6, label: "ATM Centres" },
  { index: 7, label: "Road Junction" },
  { index: 8, label: "Aero Block" },
  { index: 9, label: "Road Junction" },
  { index: 10, label: "Spl Lab Block" },
  { index: 11, label: "BT Block" },
  { index: 12, label: "Athletic Track" },
  { index: 13, label: "Way to Mech" },
  { index: 14, label: "Mech Block" },
  { index: 15, label: "Road Junction" },
  { index: 16, label: "Boys Mess" },
  { index: 17, label: "Cafeteria" },
  { index: 18, label: "Learning Centre" },
  { index: 19, label: "First Coridoor" },
  { index: 20, label: "Community Radio" },
  { index: 21, label: "Reception" },
  { index: 22, label: "Studio Path Way" },
  { index: 23, label: "On Air Studio" },
  { index: 24, label: "Recording Studio" },
  { index: 25, label: "Girls Hostel" },
  { index: 26, label: "Parking Shed" },
  { index: 27, label: "South Gate" },
  { index: 28, label: "Shed Entry" },
  { index: 29, label: "Hut" },
  { index: 30, label: "Shed Exit" },
  { index: 31, label: "Basketball Court" },
  { index: 32, label: "Girls Mess" },
  { index: 33, label: "Medical Centre" },
  { index: 34, label: "Medical Centre" },
  { index: 35, label: "Reception" },
  { index: 36, label: "Doctor Consultation" },
  { index: 37, label: "Doctor Consultation" },
  { index: 38, label: "Injection & Dressing" },
  { index: 39, label: "Pharmacy" },
  { index: 40, label: "Ward-Male" },
  { index: 41, label: "Ward-Female" },
  { index: 42, label: "Emergency" },
  { index: 43, label: "ME Block Entry" },
  { index: 44, label: "Dept. of Auto" },
  { index: 45, label: "Auto-Library" },
  { index: 46, label: "Dept. of Mech" },
  { index: 47, label: "Dept. Office" },
  { index: 48, label: "Conference Hall" },
  { index: 49, label: "Mech-Library" },
  { index: 50, label: "Smart Class" },
  { index: 51, label: "Seminar Hall" },
  { index: 52, label: "Lab Path Way" },
  { index: 53, label: "Open Area" },
  { index: 54, label: "Lab Path Way" },
  { index: 55, label: "Thermal Engg Lab" },
  { index: 56, label: "FM Lab" },
  { index: 57, label: "Lab Path Way" },
  { index: 58, label: "SM Lab" },
  { index: 59, label: "ND Testing Lab" },
  { index: 60, label: "Lab Path Way" },
  { index: 61, label: "Spl Machine Lab" },
  { index: 62, label: "Spl Machine Lab" },
  { index: 63, label: "Lathe Shop" },
  { index: 64, label: "Lab Path Way" },
  { index: 65, label: "Basic Workshop" },
  { index: 66, label: "Basic Workshop" },
  { index: 67, label: "Basic Workshop" },
  { index: 68, label: "Lab Path Way" },
  { index: 69, label: "3D Printing Lab" },
  { index: 70, label: "Lab Path Way" },
  { index: 71, label: "CAM Lab" },
  { index: 72, label: "CAM CC" },
  { index: 73, label: "CAD Lab" },
  { index: 74, label: "Lab Path Way" },
  { index: 75, label: "Dynamics Lab" },
  { index: 76, label: "HARITA Lab" },
  { index: 77, label: "Metallurgy Lab" },
  { index: 78, label: "Metrology Lab" },
  { index: 79, label: "Lab Path Way" },
  { index: 80, label: "Automotive EE Lab" },
  { index: 81, label: "Lab Path Way" },
  { index: 82, label: "Ind Safety Lab" },
  { index: 83, label: "Heat Transfer Lab" },
  { index: 84, label: "Auto-Comp Lab" },
  { index: 85, label: "Power House" },
  { index: 86, label: "Power Genrators" },
  { index: 87, label: "Sports Complex" },
  { index: 88, label: "Tennies Court I" },
  { index: 89, label: "Tennies Court II" },
  { index: 90, label: "Basket Ball Court" },
  { index: 91, label: "Volleyball Court" },
  { index: 92, label: "Agri Field" },
  { index: 93, label: "Second Corridor" },
  { index: 94, label: "Fashion Tech" },
  { index: 95, label: "FRC Gallery" },
  { index: 96, label: "FRC Display" },
  { index: 97, label: "FRC Lab Path Way" },
  { index: 98, label: "Pattern Making Lab" },
  { index: 99, label: "Green Room for Male" },
  { index: 100, label: "Green Room for Female" },
  { index: 101, label: "Photoshoot Room" },
  { index: 102, label: "FRC First Floor" },
  { index: 103, label: "Garment Construction Lab II" },
  { index: 104, label: "Garment Construction Lab I" },
  { index: 105, label: "Conference Hall" },
  { index: 106, label: "First Corridor Entry" },
  { index: 107, label: "Netcafe Corridor" },
  { index: 108, label: "Netcafe" },
  { index: 109, label: "Netcafe Inside" },
  { index: 110, label: "T & P" },
  { index: 111, label: "T & P Reception" },
  { index: 112, label: "T & P Path Way I" },
  { index: 113, label: "T & P Conference Hall" },
  { index: 114, label: "T & P Path Way II" },
  { index: 115, label: "T & P U Table Conference Hall" },
  { index: 116, label: "T & P Library" },
  { index: 117, label: "T & P Faculty Hall" },
  { index: 118, label: "T & P VIP Launch" },
];

/** Best tour scene for a place name, or null when nothing matches. */
export function findTourScene(name?: string | null): TourScene | null {
  if (!name) return null;
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = TOUR_SCENES.find((s) => s.label.toLowerCase() === needle);
  if (exact) return exact;
  return (
    TOUR_SCENES.find(
      (s) => s.label.toLowerCase().includes(needle) || needle.includes(s.label.toLowerCase())
    ) ?? null
  );
}
