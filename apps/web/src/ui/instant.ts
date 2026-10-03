/** An explicit offset prevents interpreting device-local dates as server instants. */
export function assertInstant(instant: string): void {
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(instant) || !Number.isFinite(Date.parse(instant)))
    throw new TypeError(`Invalid instant: ${instant}`);
}
