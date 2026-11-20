import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright-core";
import { createHarnessTransport } from "./harness.js";

export const FLOW_URL = "https://flow.google.com/";
// Flow's buttons are found by their English names ("Start generation", "Download"...), so Flow has to show in English
// whatever language the Google account uses. `hl=en` on the address does that: `hl=es` turned every label Spanish on
// an English account (2026-10-13), the choice holds through Flow's in-app navigation, and the browser's own language
// changes nothing. It only lasts until the next full page load, so every load adds it and ensureEnglish re-checks.
export const inEnglish = (url: string): string => {
  const u = new URL(url);
  u.searchParams.set("hl", "en");
  return u.toString();
};
export const HOME_DIR = process.env.FLOW_MCP_HOME ?? join(homedir(), ".config", "google-flow-mcp", "state");
// Kept for upstream login help only; this local bridge never launches or copies a profile.
export const PROFILE_DIR = join(HOME_DIR, "unused-profile");
export const CDP_PORT = Number(process.env.FLOW_MCP_CDP_PORT ?? 9222);

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!process.env.FLOW_MCP_TARGET_ID) throw new Error("FLOW_MCP_TARGET_ID is required; no automatic profile or tab selection.");
  if (browser?.isConnected()) return browser;
  const transport = await createHarnessTransport({
    socketPath: process.env.FLOW_MCP_HARNESS_SOCKET ?? join(homedir(), ".config", "browser-harness", "runtime", process.platform === "win32" ? "bu-default.port" : "bu-default.sock"),
    targetId: process.env.FLOW_MCP_TARGET_ID,
    leasePath: join(HOME_DIR, "harness-ipc.lock"),
  });
  try {
    browser = await chromium.connectOverCDP(transport, { timeout: 15_000, noDefaults: true });
    return browser;
  } catch {
    transport.close();
    throw new Error("Could not adapt the existing Browser Harness session. No Chrome connection or profile was opened.");
  }
}

export async function getFlowPage(): Promise<Page> {
  const pages = (await getBrowser()).contexts().flatMap(context => context.pages());
  if (pages.length !== 1) throw new Error("Expected exactly the configured Flow page from the existing Harness transport.");
  const page = pages[0];
  const u = new URL(page.url());
  if (u.protocol !== "https:" || !(u.hostname === "flow.google.com" || (u.hostname === "labs.google" && /^\/fx(?:\/|$)/.test(u.pathname)))) throw new Error("The configured Flow tab navigated away; no fallback page will be used.");
  await ensureEnglish(page);
  return page;
}

// Reloads Flow in English when it is showing in another language (a page the user opened by hand, or Flow redirecting
// to an address without hl). Sign-in pages are left alone.
export async function ensureEnglish(page: Page): Promise<void> {
  if (!/^https:\/\/flow\.google\.com\//.test(page.url())) return;
  const lang = () => page.evaluate(() => document.documentElement.lang).catch(() => "");
  const now = await lang();
  if (!now || /^en\b/i.test(now)) return;
  await page.goto(inEnglish(page.url()), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.documentElement.lang, null, { timeout: 15_000 }).catch(() => {});
  const after = await lang();
  if (after && !/^en\b/i.test(after)) {
    throw new Error(
      `Flow is showing in "${after}" and would not switch to English. flow-mcp finds Flow's buttons by their English names. ` +
        `Add ?hl=en to the end of Flow's address in the Flow Chrome window, or set your Google account's language to English (myaccount.google.com/language).`,
    );
  }
}
