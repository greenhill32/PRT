import type { Event } from './types';

export function errorMessage(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error
    ? String(error.message) : String(error);
}

export function sameEventPayload(a: Omit<Event, 'created_at'>, b: Event): boolean {
  const detail = (value: Event['detail']) => JSON.stringify(value
    ? Object.entries(value).sort(([a], [b]) => a.localeCompare(b)) : null);
  return a.event_id === b.event_id && a.session_id === b.session_id
    && a.event_type === b.event_type && a.raw_value === b.raw_value
    && a.unit === b.unit && a.source === b.source
    && new Date(a.timestamp).getTime() === new Date(b.timestamp).getTime()
    && (a.correction_of ?? null) === (b.correction_of ?? null)
    && (a.voids_event_id ?? null) === (b.voids_event_id ?? null)
    && detail(a.detail) === detail(b.detail);
}

export async function appendIdempotently(
  event: Omit<Event, 'created_at'>,
  insert: () => Promise<Event>,
  read: (id: string) => Promise<Event | null>
): Promise<Event> {
  try { return await insert(); }
  catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== '23505') throw error;
    const existing = await read(event.event_id);
    if (!existing || !sameEventPayload(event, existing)) {
      throw new Error('Event UUID already exists with different data; local result retained.');
    }
    return existing;
  }
}
