/**
 * Types for the shared capture harness.
 *
 * `env.mjs` is plain JavaScript and predates the TypeScript tools in here.
 * Sitting beside it under the name TypeScript looks for lets those tools
 * import it without converting the harness and churning every capture script.
 */

import type { Browser, LaunchOptions, Page } from "@playwright/test";

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
    ss?: number;
    motion?: boolean;
    view?: { width: number; height: number };
  },
): Promise<Page>;
