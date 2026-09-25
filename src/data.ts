export type Direction = "to-tarragona" | "to-vilanova";

export type RouteStop = {
  name: string;
  town: string;
  coordinates: Record<Direction, { lat: number; lng: number }>;
};

// Stop names/order follow BusGarraf's published Vilanova–Tarragona list.
// Coordinates were cross-checked against the Generalitat GTFS feed (updated
// 2026-09-17, route L1655 and its platform records) and Vilanova's municipal
// interurban-stop inventory. Keep the separate platform coordinates where the
// GTFS feed identifies different poles by direction. The GTFS trip has fewer
// entries than the operator's public stop list, so Aigua, Zamenhof and Tèrmica
// use their specifically named platform records rather than a town-centre pin.
export const stops: RouteStop[] = [
  { name: "Plaça Eduard Maristany", town: "Vilanova i la Geltrú", coordinates: { "to-tarragona": { lat: 41.22038084744236, lng: 1.7305158618556 }, "to-vilanova": { lat: 41.22038084744236, lng: 1.7305158618556 } } },
  { name: "C/ Pare Garí", town: "Vilanova i la Geltrú", coordinates: { "to-tarragona": { lat: 41.2220406123006, lng: 1.7218992013589576 }, "to-vilanova": { lat: 41.22192810404552, lng: 1.7213940300534392 } } },
  { name: "C/ Aigua – C/ Bruc", town: "Vilanova i la Geltrú", coordinates: { "to-tarragona": { lat: 41.22353817886342, lng: 1.7170555518371595 }, "to-vilanova": { lat: 41.22355413076109, lng: 1.7169863085925536 } } },
  { name: "C/ Zamenhof", town: "Vilanova i la Geltrú", coordinates: { "to-tarragona": { lat: 41.22053370332264, lng: 1.7117292940902276 }, "to-vilanova": { lat: 41.2199172052342, lng: 1.7121931855506503 } } },
  { name: "Ibersol", town: "Vilanova i la Geltrú", coordinates: { "to-tarragona": { lat: 41.20940056139636, lng: 1.6874605644273895 }, "to-vilanova": { lat: 41.20906286127421, lng: 1.686572924820132 } } },
  { name: "Cubelles Centre", town: "Cubelles", coordinates: { "to-tarragona": { lat: 41.20737994494059, lng: 1.6729611089863714 }, "to-vilanova": { lat: 41.20737994494059, lng: 1.6729611089863714 } } },
  { name: "Tèrmica", town: "Cubelles", coordinates: { "to-tarragona": { lat: 41.20332063728851, lng: 1.6564965525173245 }, "to-vilanova": { lat: 41.20324987989878, lng: 1.6564601077097747 } } },
  { name: "Cunit Centre", town: "Cunit", coordinates: { "to-tarragona": { lat: 41.19887894762877, lng: 1.6349993415668962 }, "to-vilanova": { lat: 41.19858530327022, lng: 1.634543676373442 } } },
  { name: "Benzinera", town: "Cunit", coordinates: { "to-tarragona": { lat: 41.19716260613086, lng: 1.623992431997856 }, "to-vilanova": { lat: 41.19687784980144, lng: 1.623907285851371 } } },
  { name: "La Ponderosa", town: "Cunit", coordinates: { "to-tarragona": { lat: 41.195787734131464, lng: 1.6190002085052562 }, "to-vilanova": { lat: 41.19551434076303, lng: 1.619071577740245 } } },
  { name: "Segur Centre", town: "Segur de Calafell", coordinates: { "to-tarragona": { lat: 41.19358099967206, lng: 1.606225000529482 }, "to-vilanova": { lat: 41.19303753968567, lng: 1.6053087449577852 } } },
  { name: "Calafell Estació", town: "Calafell", coordinates: { "to-tarragona": { lat: 41.18989400008849, lng: 1.574897000125488 }, "to-vilanova": { lat: 41.18989400008849, lng: 1.574897000125488 } } },
  { name: "Calafell Poble", town: "Calafell", coordinates: { "to-tarragona": { lat: 41.20179324279033, lng: 1.5653799425397585 }, "to-vilanova": { lat: 41.19815600015715, lng: 1.5681940005816788 } } },
  { name: "Zona Universitària", town: "Tarragona", coordinates: { "to-tarragona": { lat: 41.13083324920444, lng: 1.2398135646367594 }, "to-vilanova": { lat: 41.130518755859185, lng: 1.2404533698016853 } } },
  { name: "Hospital Joan XXIII", town: "Tarragona", coordinates: { "to-tarragona": { lat: 41.125449565179984, lng: 1.2423544576917156 }, "to-vilanova": { lat: 41.12426999984566, lng: 1.2431780001953425 } } },
  { name: "Estació autobusos", town: "Tarragona", coordinates: { "to-tarragona": { lat: 41.11827071362793, lng: 1.2444282045126236 }, "to-vilanova": { lat: 41.11827071362793, lng: 1.2444282045126236 } } },
];

export type Timetable = {
  direction: Direction;
  start: string;
  end: string;
  departures: string[];
  stops: string[];
  stopOffsets: number[];
  arrivalAtOtherEnd: string;
};

// Transcribed from the operator PDF published in July 2025. Consult the
// operator's live planner for service changes, seasonal schedules and holidays.
export const timetables: Record<Direction, Timetable> = {
  "to-tarragona": {
    direction: "to-tarragona",
    start: "Vilanova i la Geltrú",
    end: "Tarragona",
    departures: ["06:15", "06:45", "07:15", "08:15", "09:30", "10:30", "16:45", "17:15", "18:15", "19:15"],
    stops: ["Plaça Eduard Maristany", "C/ Pare Garí", "C/ Aigua – C/ Bruc", "C/ Zamenhof", "Ibersol", "Cubelles Centre", "Tèrmica", "Cunit Centre", "Benzinera", "La Ponderosa", "Segur Centre", "Calafell Estació", "Calafell Poble", "Zona Universitària", "Hospital Joan XXIII", "Estació autobusos"],
    stopOffsets: [0, 3, 6, 10, 11, 15, 17, 20, 22, 23, 25, 33, 35, 70, 71, 75],
    arrivalAtOtherEnd: "20:30",
  },
  "to-vilanova": {
    direction: "to-vilanova",
    start: "Tarragona",
    end: "Vilanova i la Geltrú",
    departures: ["07:30", "08:00", "08:30", "09:30", "10:45", "11:45", "12:45", "15:15", "16:15", "17:15", "18:00", "18:30", "19:30", "20:30"],
    stops: ["Estació autobusos", "Hospital Joan XXIII", "Zona Universitària", "Calafell Poble", "Calafell Estació", "Segur Centre", "La Ponderosa", "Benzinera", "Cunit Centre", "Tèrmica", "Cubelles Centre", "Ibersol", "C/ Zamenhof", "C/ Aigua – C/ Bruc", "Pobles d’Espanya", "Plaça Eduard Maristany"],
    stopOffsets: [0, 2, 5, 35, 39, 45, 47, 48, 50, 53, 55, 59, 60, 64, 68, 75],
    arrivalAtOtherEnd: "21:45",
  },
};

export const directionLabel: Record<Direction, string> = {
  "to-tarragona": "Hacia Tarragona",
  "to-vilanova": "Hacia Vilanova",
};

export const officialScheduleUrl = "https://busgarraf.cat/es/lineas/";
export const publishedPdfUrl = "https://busgarraf.cat/wp-content/uploads/2025/07/Vilanova-i-la-Geltru-Cubelles-Cunit-Segur-de-Calafell-Calafell-Tarragona.pdf";
export const officialTariffUrl = "https://busgarraf.cat/es/tarifas/";
