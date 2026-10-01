export type Zone = "front" | "standard" | "premium" | "accessible";

export type Movie = {
  id: string;
  title: string;
  genre: string;
  rating: string;
  durationMinutes: number;
  posterTone: string;
};

export type Screen = {
  id: string;
  name: string;
  rowCount: number;
  seatsPerRow: number;
};

export type Seat = {
  id: string;
  screenId: string;
  rowLabel: string;
  seatNumber: number;
  zone: Zone;
};

export type Show = {
  id: string;
  movieId: string;
  screenId: string;
  startsAt: string;
  language: string;
  format: string;
  status: "scheduled" | "cancelled";
};

export type GroupRequest = {
  id: string;
  showId: string;
  label: string;
  groupSize: number;
  preferredZone: Zone | "any";
  preferTogether: boolean;
  status: "pending" | "allocated";
  createdAt: string;
};

export type Allocation = {
  id: string;
  showId: string;
  seatId: string;
  groupRequestId: string;
  allocatedAt: string;
  releasedAt: string | null;
};

export type TheaterData = {
  movies: Movie[];
  screens: Screen[];
  seats: Seat[];
  shows: Show[];
  groups: GroupRequest[];
  allocations: Allocation[];
};

export type SessionMode = "demo" | "supabase";

export type MovieInput = Omit<Movie, "id">;
export type ScreenInput = Pick<Screen, "name" | "rowCount" | "seatsPerRow">;
export type ShowInput = Omit<Show, "id" | "status">;
export type GroupInput = Omit<GroupRequest, "id" | "createdAt" | "status">;
