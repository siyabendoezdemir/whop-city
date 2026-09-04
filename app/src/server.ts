/**
 * The server entry.
 *
 * TanStack Start resolves `src/server.ts` as a custom entry, which is how City
 * gets exactly one fixed API path without a router-level catch-all. The match
 * is an equality check on the pathname: there is no pattern, no parameter and
 * no dispatch table, so the set of endpoints the browser can reach is the one
 * literal below and everything else is the app.
 */

import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";
import { createServerEntry } from "@tanstack/react-start/server-entry";

import { SNAPSHOT_PATH, handleSnapshotRequest } from "./server/snapshotRoute";
import { resolveEnv } from "./server/env";

const startFetch = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  async fetch(request, ...rest) {
    if (new URL(request.url).pathname === SNAPSHOT_PATH) {
      return handleSnapshotRequest(request, await resolveEnv());
    }
    return startFetch(request, ...rest);
  },
});
