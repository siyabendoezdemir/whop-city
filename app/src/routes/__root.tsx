import { HeadContent, Scripts, createRootRoute } from "@tanstack/react-router";

import appCss from "../styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { name: "color-scheme", content: "light" },
      { name: "theme-color", content: "#f4f7fb" },
      {
        name: "description",
        content:
          "Whop City renders a Whop business as a city you can walk through — a privacy-safe projection of district health, tier, and direction.",
      },
      // Whop's hosting overrides <title> with the app name and re-asserts it
      // with a MutationObserver, so this is what shows locally, not in hosted.
      { title: "Whop City" },
    ],
    links: [
      { rel: "preconnect", href: "https://rsms.me" },
      { rel: "stylesheet", href: "https://rsms.me/inter/inter.css" },
      { rel: "stylesheet", href: appCss },
    ],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
