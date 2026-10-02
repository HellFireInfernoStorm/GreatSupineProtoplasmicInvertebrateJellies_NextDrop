// Pure rules core: validator, allocator, trip time, fuel, reducer (spec/rules-core).
// Zero runtime dependencies, no I/O, no clock, no randomness.

/** Minutes in one day. Times in the rules core are integer minutes since local midnight. */
export const MINUTES_PER_DAY = 24 * 60;
