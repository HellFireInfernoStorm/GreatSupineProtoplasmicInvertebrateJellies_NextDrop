import { QueryClient } from "@tanstack/react-query";

/** One client for the app. Route loaders and the session helpers use it outside React. */
export const queryClient = new QueryClient();
