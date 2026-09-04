/**
 * Types for the capture environment helper.
 *
 * `env.mjs` is plain ESM so the capture scripts run under node with no build
 * step. This declares the parts the Playwright config needs, so there is still
 * one source of truth for how the browser is launched.
 */

export declare const GL_ARGS: string[];
export declare function chromeExecutable(): string | undefined;
export declare const APP_URL: string;
export declare const VIEW: { width: number; height: number };
export declare const SHOT_TIMEOUT: number;
export declare function artOut(): string;
export declare function framesDir(): string;
export declare function artifactPath(name: string): string;
export declare function launchOptions(): { executablePath?: string; args: string[] };
