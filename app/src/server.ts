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

import {
  AUTH_CALLBACK,
  AUTH_LOGOUT,
  AUTH_START,
  handleAuthCallback,
  handleAuthLogout,
  handleAuthStart,
} from "./server/oauth";
import { SNAPSHOT_PATH, handleSnapshotRequest } from "./server/snapshotRoute";
import { resolveEnv } from "./server/env";

/**
 * Where TanStack Start would dispatch server functions.
 *
 * City registers none — there is no `createServerFn` anywhere in `src` — so
 * nothing legitimate is ever sent here. Left to the framework, the prefix
 * answers a bare `/_serverFn/` with a 500 whose body is
 * `{"status":500,"unhandled":true,"message":"HTTPError"}`. That leaks nothing
 * today, but it is an unhandled path on a public deployment whose shape is the
 * framework's to change. Since the app has no server functions to serve, the
 * whole prefix is closed here instead.
 */
const SERVER_FN_PREFIX = "/_serverFn";

const startFetch = createStartHandler(defaultStreamHandler);

export default createServerEntry({
  async fetch(request, ...rest) {
    const { pathname } = new URL(request.url);

    if (pathname === SNAPSHOT_PATH) {
      return handleSnapshotRequest(request, await resolveEnv());
    }

    // Sign in with Whop. Three fixed paths, matched by equality like the
    // snapshot is: still no dispatcher and still nothing a caller can steer.
    if (pathname === AUTH_START) return handleAuthStart(request, await resolveEnv());
    if (pathname === AUTH_CALLBACK) return handleAuthCallback(request, await resolveEnv());
    if (pathname === AUTH_LOGOUT) return handleAuthLogout(request);

    if (pathname === SERVER_FN_PREFIX || pathname.startsWith(`${SERVER_FN_PREFIX}/`)) {
      return new Response(null, { status: 404 });
    }

    return startFetch(request, ...rest);
  },
});
