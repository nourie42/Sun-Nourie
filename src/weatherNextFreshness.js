/** Retrieval timestamps never establish the age of a model initialization. */
export const WEATHERNEXT_MAX_RUN_AGE_HOURS = 36;
export function weatherNextFreshness(source, now = Date.now()) {
  const run = Date.parse(source?.runAt), end = source?.points?.flatMap(point => point.hourly || []).map(row => Date.parse(row.time)).filter(Number.isFinite);
  if (!Number.isFinite(run) || run > now) return { status: 'unavailable', runAgeHours: null, runAt: source?.runAt || null, message: 'A valid published model initialization is unavailable.' };
  const actualAgeHours = (now - run) / 3600000;
  const runAgeHours = Math.round(actualAgeHours * 10) / 10;
  const expires = end?.length ? Math.max(...end) : null;
  if (Number.isFinite(expires) && expires < now) return { status: 'unavailable', runAgeHours, runAt: source.runAt, message: 'The last published initialization no longer covers upcoming hours.' };
  const stale = actualAgeHours > WEATHERNEXT_MAX_RUN_AGE_HOURS || ['last-verified', 'stale'].includes(source?.status);
  return { status: stale ? 'stale' : 'ready', runAgeHours, runAt: source.runAt, message: stale ? 'Last available forecast: this initialization is old or its refresh failed. Collection time does not make the model run newer.' : 'Published model initialization is within the freshness window.' };
}
