import type {
  Allocation,
  GroupRequest,
  Seat,
  Show,
  TheaterData,
  Zone,
} from "./types";

export type AllocationPlan = {
  seats: Seat[];
  together: boolean;
  explanation: string;
};

export type AllocationResult = {
  seatIds: string[];
  together: boolean;
  explanation: string;
};

const ZONE_PREFERENCE: Record<Zone | "any", Zone[]> = {
  any: ["premium", "standard", "front", "accessible"],
  premium: ["premium", "standard", "front", "accessible"],
  standard: ["standard", "premium", "front", "accessible"],
  front: ["front", "standard", "premium", "accessible"],
  accessible: ["accessible", "standard", "premium", "front"],
};

function activeSeatIds(showId: string, allocations: Allocation[]): Set<string> {
  return new Set(
    allocations
      .filter((allocation) => allocation.showId === showId && !allocation.releasedAt)
      .map((allocation) => allocation.seatId),
  );
}

function compareSeat(a: Seat, b: Seat): number {
  return a.rowLabel.localeCompare(b.rowLabel) || a.seatNumber - b.seatNumber;
}

function zoneRank(zone: Zone, preferred: Zone | "any"): number {
  return ZONE_PREFERENCE[preferred].indexOf(zone);
}

function contiguousCandidates(seats: Seat[], size: number): Seat[][] {
  const byRow = new Map<string, Seat[]>();
  for (const seat of seats) {
    const row = byRow.get(seat.rowLabel) ?? [];
    row.push(seat);
    byRow.set(seat.rowLabel, row);
  }
  const candidates: Seat[][] = [];
  for (const row of byRow.values()) {
    row.sort(compareSeat);
    for (let start = 0; start <= row.length - size; start += 1) {
      const run = row.slice(start, start + size);
      if (run.every((seat, index) => index === 0 || seat.seatNumber === run[index - 1].seatNumber + 1)) {
        candidates.push(run);
      }
    }
  }
  return candidates;
}

/**
 * Selects preferred seats without mutating data. The database RPC rechecks
 * availability and inserts the plan atomically, so concurrent staff actions
 * cannot double-book a seat.
 */
export function planAllocation(
  request: GroupRequest,
  show: Show,
  data: Pick<TheaterData, "seats" | "allocations">,
): AllocationPlan {
  const taken = activeSeatIds(show.id, data.allocations);
  const available = data.seats
    .filter((seat) => seat.screenId === show.screenId && !taken.has(seat.id))
    .sort((a, b) => {
      const zoneDifference =
        zoneRank(a.zone, request.preferredZone) - zoneRank(b.zone, request.preferredZone);
      return zoneDifference || compareSeat(a, b);
    });

  if (available.length < request.groupSize) {
    throw new Error(
      `Only ${available.length} seats remain in this screen; this group needs ${request.groupSize}.`,
    );
  }

  if (request.preferTogether) {
    const runs = contiguousCandidates(available, request.groupSize);
    if (runs.length > 0) {
      runs.sort((a, b) => {
        const aZoneCost = a.reduce((total, seat) => total + zoneRank(seat.zone, request.preferredZone), 0);
        const bZoneCost = b.reduce((total, seat) => total + zoneRank(seat.zone, request.preferredZone), 0);
        return aZoneCost - bZoneCost || compareSeat(a[0], b[0]);
      });
      return {
        seats: runs[0],
        together: true,
        explanation: `Found ${request.groupSize} adjacent seats in the ${runs[0][0].zone} zone.`,
      };
    }
  }

  const seats = available.slice(0, request.groupSize);
  const allSameRow = seats.every((seat) => seat.rowLabel === seats[0].rowLabel);
  const isContiguous =
    allSameRow &&
    seats.every((seat, index) => index === 0 || seat.seatNumber === seats[index - 1].seatNumber + 1);
  const together = allSameRow && isContiguous;
  return {
    seats,
    together,
    explanation: together
      ? `Found ${request.groupSize} adjacent seats.`
      : "No adjacent block was available; the best available seats are selected instead.",
  };
}
