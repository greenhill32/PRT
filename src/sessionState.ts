import type { Event, QueuedEvent } from './types';
import { computeEffectiveRawResults } from './leaderboard';

export const EVENT_ORDER = ['pushups', 'plank', 'row_2k'] as const;
export type WorkoutEventType = typeof EVENT_ORDER[number];

export function queuedToEvent(event: QueuedEvent): Event {
  return {
    event_id: event.event_id, session_id: event.session_id, event_type: event.event_type,
    raw_value: event.raw_value, unit: event.unit, timestamp: event.timestamp, source: event.source,
    correction_of: event.correction_of ?? null, voids_event_id: event.voids_event_id ?? null,
    detail: event.detail, created_at: event.timestamp
  };
}

export function mergeSessionEvents(sessionId: string, server: Event[], local: QueuedEvent[]): Event[] {
  const byId = new Map<string, Event>();
  for (const event of local) if (event.session_id === sessionId) byId.set(event.event_id, queuedToEvent(event));
  // The persisted row wins when both contain the same UUID.
  for (const event of server) if (event.session_id === sessionId) byId.set(event.event_id, event);
  return [...byId.values()];
}

export function revealedFromEvents(events: Event[]): Set<WorkoutEventType> {
  return new Set(Object.keys(computeEffectiveRawResults(events)) as WorkoutEventType[]);
}

export function nextMissingEvent(events: Event[]): WorkoutEventType | null {
  const results = computeEffectiveRawResults(events);
  return EVENT_ORDER.find(type => results[type] === undefined) ?? null;
}

export function parseEventInput(input: string, type: WorkoutEventType): number {
  const text = input.trim();
  const time = /^(\d+):([0-5]\d)$/.exec(text);
  let value: number;
  if (type !== 'pushups' && time) value = Number(time[1]) * 60 + Number(time[2]);
  else if (/^\d+$/.test(text)) value = Number(text);
  else throw new Error(type === 'pushups' ? 'Enter a whole number of reps.' : 'Enter whole seconds or mm:ss (e.g. 2:02).');
  if (!Number.isSafeInteger(value) || value < 0 || value > (type === 'pushups' ? 500 : 3600)) {
    throw new Error(type === 'pushups' ? 'Enter 0–500 reps.' : 'Enter a time up to one hour.');
  }
  if (type === 'row_2k' && value === 0) throw new Error('Row time must be greater than zero.');
  return value;
}
