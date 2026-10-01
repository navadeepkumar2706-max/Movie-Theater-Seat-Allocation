import { planAllocation, type AllocationResult } from "./allocationStrategy";
import { readDemoData, writeDemoData } from "./demoData";
import { supabase } from "./supabase";
import type {
  Allocation,
  GroupInput,
  GroupRequest,
  Movie,
  MovieInput,
  Screen,
  ScreenInput,
  Seat,
  SessionMode,
  Show,
  ShowInput,
  TheaterData,
  Zone,
} from "./types";

function requireSupabase() {
  if (!supabase) throw new Error("Supabase is not configured. Use demo mode or add the Supabase project settings.");
  return supabase;
}

function message(error: { message: string; code?: string }): string {
  if (error.code === "23505") {
    return "Those seats were just taken by another staff member. Refresh the seat map and try again.";
  }
  return error.message;
}

function mapMovie(row: Record<string, unknown>): Movie {
  return {
    id: String(row.id),
    title: String(row.title),
    genre: String(row.genre),
    rating: String(row.rating),
    durationMinutes: Number(row.duration_minutes),
    posterTone: String(row.poster_tone),
  };
}

function mapScreen(row: Record<string, unknown>): Screen {
  return {
    id: String(row.id),
    name: String(row.name),
    rowCount: Number(row.row_count),
    seatsPerRow: Number(row.seats_per_row),
  };
}

function mapSeat(row: Record<string, unknown>): Seat {
  return {
    id: String(row.id),
    screenId: String(row.screen_id),
    rowLabel: String(row.row_label),
    seatNumber: Number(row.seat_number),
    zone: row.zone as Zone,
  };
}

function mapShow(row: Record<string, unknown>): Show {
  return {
    id: String(row.id),
    movieId: String(row.movie_id),
    screenId: String(row.screen_id),
    startsAt: String(row.starts_at),
    language: String(row.language),
    format: String(row.format),
    status: row.status as Show["status"],
  };
}

function mapGroup(row: Record<string, unknown>): GroupRequest {
  return {
    id: String(row.id),
    showId: String(row.show_id),
    label: String(row.label),
    groupSize: Number(row.group_size),
    preferredZone: row.preferred_zone as GroupRequest["preferredZone"],
    preferTogether: Boolean(row.prefer_together),
    status: row.status as GroupRequest["status"],
    createdAt: String(row.created_at),
  };
}

function mapAllocation(row: Record<string, unknown>): Allocation {
  return {
    id: String(row.id),
    showId: String(row.show_id),
    seatId: String(row.seat_id),
    groupRequestId: String(row.group_request_id),
    allocatedAt: String(row.allocated_at),
    releasedAt: row.released_at ? String(row.released_at) : null,
  };
}

async function run<T>(
  query: PromiseLike<{ data: T | null; error: { message: string; code?: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(message(error));
  if (data === null) throw new Error("The database returned no data.");
  return data;
}

export async function loadTheaterData(mode: SessionMode): Promise<TheaterData> {
  if (mode === "demo") return readDemoData();
  const client = requireSupabase();
  const [movies, screens, seats, shows, groups, allocations] = await Promise.all([
    run(client.from("movies").select("*").order("title")),
    run(client.from("screens").select("*").order("name")),
    run(client.from("seats").select("*").order("row_label").order("seat_number")),
    run(client.from("shows").select("*").order("starts_at")),
    run(client.from("group_requests").select("*").order("created_at", { ascending: false })),
    run(client.from("allocations").select("*").order("allocated_at", { ascending: false })),
  ]);
  return {
    movies: movies.map(mapMovie),
    screens: screens.map(mapScreen),
    seats: seats.map(mapSeat),
    shows: shows.map(mapShow),
    groups: groups.map(mapGroup),
    allocations: allocations.map(mapAllocation),
  };
}

function newId(): string {
  return crypto.randomUUID();
}

export async function createMovie(mode: SessionMode, input: MovieInput): Promise<void> {
  if (mode === "demo") {
    const data = readDemoData();
    data.movies.push({ ...input, id: newId() });
    writeDemoData(data);
    return;
  }
  const client = requireSupabase();
  await run(client.from("movies").insert({
    title: input.title,
    genre: input.genre,
    rating: input.rating,
    duration_minutes: input.durationMinutes,
    poster_tone: input.posterTone,
  }).select("id"));
}

export async function createScreen(mode: SessionMode, input: ScreenInput): Promise<void> {
  if (mode === "demo") {
    const data = readDemoData();
    const id = newId();
    data.screens.push({ ...input, id, rowCount: input.rowCount, seatsPerRow: input.seatsPerRow });
    const labels = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, input.rowCount);
    data.seats.push(...labels.split("").flatMap((rowLabel, rowIndex) =>
      Array.from({ length: input.seatsPerRow }, (_, index) => ({
        id: `${id}-${rowLabel}-${index + 1}`,
        screenId: id,
        rowLabel,
        seatNumber: index + 1,
        zone: rowIndex >= Math.floor(input.rowCount * 0.65) ? "premium" as const : "standard" as const,
      })),
    ));
    writeDemoData(data);
    return;
  }
  const client = requireSupabase();
  await run(client.rpc("create_screen_with_seats", {
    p_name: input.name,
    p_row_count: input.rowCount,
    p_seats_per_row: input.seatsPerRow,
  }));
}

export async function createShow(mode: SessionMode, input: ShowInput): Promise<void> {
  if (mode === "demo") {
    const data = readDemoData();
    data.shows.push({ ...input, id: newId(), status: "scheduled" });
    writeDemoData(data);
    return;
  }
  const client = requireSupabase();
  await run(client.from("shows").insert({
    movie_id: input.movieId,
    screen_id: input.screenId,
    starts_at: input.startsAt,
    language: input.language,
    format: input.format,
  }).select("id"));
}

export async function createGroupRequest(mode: SessionMode, input: GroupInput): Promise<string> {
  if (mode === "demo") {
    const data = readDemoData();
    const group: GroupRequest = {
      ...input,
      id: newId(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    data.groups.unshift(group);
    writeDemoData(data);
    return group.id;
  }
  const client = requireSupabase();
  const row = await run(client.from("group_requests").insert({
    show_id: input.showId,
    label: input.label,
    group_size: input.groupSize,
    preferred_zone: input.preferredZone,
    prefer_together: input.preferTogether,
  }).select("id").single());
  const saved = row as unknown as { id?: string } | null;
  if (typeof saved?.id !== "string") {
    throw new Error("The group request was saved, but its ID was not returned.");
  }
  return saved.id;
}

export async function allocateGroup(mode: SessionMode, groupId: string): Promise<AllocationResult> {
  const data = await loadTheaterData(mode);
  const group = data.groups.find((item) => item.id === groupId);
  if (!group) throw new Error("This group request no longer exists. Refresh the page.");
  if (group.status === "allocated") throw new Error("This group already has seats allocated.");
  const show = data.shows.find((item) => item.id === group.showId);
  if (!show) throw new Error("The show for this group request could not be found.");
  const plan = planAllocation(group, show, data);

  if (mode === "demo") {
    const latest = readDemoData();
    const currentActive = new Set(
      latest.allocations
        .filter((allocation) => allocation.showId === show.id && !allocation.releasedAt)
        .map((allocation) => allocation.seatId),
    );
    if (plan.seats.some((seat) => currentActive.has(seat.id))) {
      throw new Error("Those seats were just taken. Refresh the seat map and try again.");
    }
    const allocatedAt = new Date().toISOString();
    latest.allocations.push(...plan.seats.map((seat) => ({
      id: newId(),
      showId: show.id,
      seatId: seat.id,
      groupRequestId: group.id,
      allocatedAt,
      releasedAt: null,
    })));
    const currentGroup = latest.groups.find((item) => item.id === group.id);
    if (currentGroup) currentGroup.status = "allocated";
    writeDemoData(latest);
    return {
      seatIds: plan.seats.map((seat) => seat.id),
      together: plan.together,
      explanation: plan.explanation,
    };
  }

  const client = requireSupabase();
  const result = await run(client.rpc("allocate_group_seats", {
    p_group_request_id: group.id,
    p_seat_ids: plan.seats.map((seat) => seat.id),
  }));
  const seatIds = Array.isArray(result)
    ? result.map((row: { seat_id: string }) => row.seat_id)
    : [];
  return { seatIds, together: plan.together, explanation: plan.explanation };
}

export async function releaseAllocation(mode: SessionMode, allocationId: string): Promise<void> {
  if (mode === "demo") {
    const data = readDemoData();
    const allocation = data.allocations.find((item) => item.id === allocationId);
    if (!allocation || allocation.releasedAt) throw new Error("This seat is already available.");
    allocation.releasedAt = new Date().toISOString();
    const groupAllocations = data.allocations.filter(
      (item) => item.groupRequestId === allocation.groupRequestId && !item.releasedAt,
    );
    if (groupAllocations.length === 0) {
      const group = data.groups.find((item) => item.id === allocation.groupRequestId);
      if (group) group.status = "pending";
    }
    writeDemoData(data);
    return;
  }
  const client = requireSupabase();
  await run(client.rpc("release_seat", { p_allocation_id: allocationId }));
}
