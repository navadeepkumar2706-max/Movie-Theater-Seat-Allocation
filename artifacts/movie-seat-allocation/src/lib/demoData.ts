import type { TheaterData, Zone } from "./types";

const rowLabels = "ABCDEFGHIJ".split("");

function makeSeats(screenId: string, columns: number): TheaterData["seats"] {
  return rowLabels.slice(0, 8).flatMap((rowLabel, rowIndex) =>
    Array.from({ length: columns }, (_, index) => {
      const seatNumber = index + 1;
      const middleStart = Math.floor(columns * 0.28);
      const middleEnd = Math.ceil(columns * 0.72);
      const zone: Zone =
        rowIndex === 0
          ? "front"
          : rowIndex >= 5 && seatNumber >= middleStart && seatNumber <= middleEnd
            ? "premium"
            : seatNumber === 1 || seatNumber === columns
              ? "accessible"
              : "standard";
      return {
        id: `${screenId}-${rowLabel}-${seatNumber}`,
        screenId,
        rowLabel,
        seatNumber,
        zone,
      };
    }),
  );
}

const now = new Date();
const at = (hours: number, minutes: number) => {
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
};

const screenOne = "screen-grand";
const screenTwo = "screen-studio";
const showOne = "show-meridian-1900";
const showTwo = "show-paper-moons-2045";
const showThree = "show-neon-1815";

const seeded: TheaterData = {
  movies: [
    {
      id: "movie-meridian",
      title: "The Last Meridian",
      genre: "Sci-fi adventure",
      rating: "PG-13",
      durationMinutes: 128,
      posterTone: "violet",
    },
    {
      id: "movie-paper-moons",
      title: "Paper Moons",
      genre: "Romance",
      rating: "PG",
      durationMinutes: 104,
      posterTone: "rose",
    },
    {
      id: "movie-neon-pursuit",
      title: "Neon Pursuit",
      genre: "Action thriller",
      rating: "R",
      durationMinutes: 116,
      posterTone: "amber",
    },
  ],
  screens: [
    { id: screenOne, name: "Grand Hall", rowCount: 8, seatsPerRow: 12 },
    { id: screenTwo, name: "Studio 2", rowCount: 8, seatsPerRow: 10 },
  ],
  seats: [...makeSeats(screenOne, 12), ...makeSeats(screenTwo, 10)],
  shows: [
    {
      id: showOne,
      movieId: "movie-meridian",
      screenId: screenOne,
      startsAt: at(19, 0),
      language: "English",
      format: "IMAX",
      status: "scheduled",
    },
    {
      id: showTwo,
      movieId: "movie-paper-moons",
      screenId: screenTwo,
      startsAt: at(20, 45),
      language: "English",
      format: "Standard",
      status: "scheduled",
    },
    {
      id: showThree,
      movieId: "movie-neon-pursuit",
      screenId: screenOne,
      startsAt: at(18, 15),
      language: "Hindi",
      format: "Dolby Atmos",
      status: "scheduled",
    },
  ],
  groups: [
    {
      id: "group-patel-family",
      showId: showOne,
      label: "Patel family",
      groupSize: 4,
      preferredZone: "premium",
      preferTogether: true,
      status: "allocated",
      createdAt: at(15, 5),
    },
    {
      id: "group-college-club",
      showId: showOne,
      label: "Film club",
      groupSize: 6,
      preferredZone: "standard",
      preferTogether: true,
      status: "pending",
      createdAt: at(15, 32),
    },
    {
      id: "group-jones",
      showId: showTwo,
      label: "Jones party",
      groupSize: 2,
      preferredZone: "any",
      preferTogether: true,
      status: "allocated",
      createdAt: at(16, 8),
    },
  ],
  allocations: [],
};

function initialData(): TheaterData {
  const data = structuredClone(seeded);
  const meridianSeats = data.seats.filter(
    (seat) => seat.screenId === screenOne && seat.rowLabel === "G",
  );
  const paperSeats = data.seats.filter(
    (seat) => seat.screenId === screenTwo && seat.rowLabel === "F",
  );
  const allocatedSeats = [
    ...meridianSeats.filter((seat) => seat.seatNumber >= 5 && seat.seatNumber <= 8).map((seat) => ({
      seat,
      showId: showOne,
      groupId: "group-patel-family",
    })),
    ...paperSeats.filter((seat) => seat.seatNumber >= 5 && seat.seatNumber <= 6).map((seat) => ({
      seat,
      showId: showTwo,
      groupId: "group-jones",
    })),
  ];
  data.allocations = allocatedSeats.map(({ seat, showId, groupId }, index) => ({
    id: `demo-allocation-${index + 1}`,
    showId,
    seatId: seat.id,
    groupRequestId: groupId,
    allocatedAt: at(15, 45),
    releasedAt: null,
  }));
  return data;
}

export const DEMO_STORAGE_KEY = "seat-allocation-demo-v1";

export function readDemoData(): TheaterData {
  try {
    const saved = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!saved) return initialData();
    const parsed = JSON.parse(saved) as TheaterData;
    if (
      !parsed ||
      !Array.isArray(parsed.movies) ||
      !Array.isArray(parsed.seats) ||
      !Array.isArray(parsed.shows)
    ) {
      return initialData();
    }
    return parsed;
  } catch {
    return initialData();
  }
}

export function writeDemoData(data: TheaterData): void {
  localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
}
