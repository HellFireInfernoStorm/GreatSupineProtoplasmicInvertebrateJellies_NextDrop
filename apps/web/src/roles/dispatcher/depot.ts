// The depot a dispatcher's workspace opens on (issue #131, seed-and-demo.md §15.3).

/** The depot the sign-in form starts on, and the workspace's default without a usable choice. */
export const DEFAULT_DEPOT = "Peliyagoda";

/**
 * The depot chosen at sign-in or by a deep link (`?depot=`) when the account covers it. Otherwise Peliyagoda when the
 * account covers it, else the account's own depot. Never simply the first depot in the list.
 */
export function initialDepot(depots: readonly string[], chosen: string | null): string {
  if (chosen && depots.includes(chosen)) return chosen;
  return depots.includes(DEFAULT_DEPOT) ? DEFAULT_DEPOT : depots[0]!;
}

/** Where a sign-in lands: the role's home, with the dispatcher's chosen depot so the workspace opens on it. */
export function homeWithDepot(home: string, depot: string | undefined): string {
  return depot ? `${home}?${new URLSearchParams({ depot }).toString()}` : home;
}
