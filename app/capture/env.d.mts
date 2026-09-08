/**
 * Types for the shared capture harness.
 *
 * `env.mjs` is plain JavaScript and predates the TypeScript tools in here.
 * Sitting beside it under the name TypeScript looks for lets those tools
 * import it without converting the harness and churning every capture script.
 */

import type { Browser, BrowserContext, LaunchOptions, Page } from "@playwright/test";

export declare const APP_URL: string;
export declare const PROJECT_ROOT: string;
export declare const GL_ARGS: string[];
export declare function chromeExecutable(): string | undefined;
export declare const VIEW: { width: number; height: number };
export declare const SHOT_TIMEOUT: number;

export declare function artOut(): string;
export declare function framesDir(): string;
export declare function artifactPath(name: string): string;
export declare function launchOptions(): LaunchOptions;
export declare function openCity(
  browser: Browser,
  options?: {
    scenario?: string;
    capture?: boolean;
    ss?: number;
    view?: { width: number; height: number };
    /** A context of your own, for the settings `openCity` does not take — reduced motion, mainly. */
    context?: BrowserContext;
  },
): Promise<Page>;
