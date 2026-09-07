/**
 * Holding page. This is the rollback target: the build promoted back into
 * production after any probe window closes.
 *
 * It is deliberately inert.
 *
 *   - No fetch. There is no network call anywhere in this file.
 *   - No env read. The handler takes no `env` argument, so nothing
 *     secret-derived can reach the response.
 *   - No analytics and no custom events. Nothing is tracked and no script of
 *     any kind is served.
 *   - No business content. The page names no business, product, plan, price,
 *     metric, or identifier.
 *   - No mutation surface. The only outcome of any request is this constant
 *     string.
 *
 * The body is a single frozen constant, so what ships is exactly what is read
 * here.
 */

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow, noarchive" />
    <title>Not available</title>
    <style>
      html { color-scheme: light dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font: 16px/1.6 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      main { padding: 2rem; text-align: center; opacity: 0.7; }
    </style>
  </head>
  <body>
    <main>
      <p>Nothing is published here.</p>
    </main>
  </body>
</html>
`;

export default {
  /**
   * `request` is unused and there is no `env` parameter: the response cannot
   * vary by caller, path, or runtime state.
   */
  async fetch(_request: Request): Promise<Response> {
    return new Response(PAGE, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow, noarchive",
      },
    });
  },
};
