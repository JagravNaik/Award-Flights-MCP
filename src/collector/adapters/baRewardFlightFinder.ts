import type { BrowserCollectorAdapter } from "./types.js";
import {
  captureJsonResponses,
  clickFirst,
  dismissCommonCookieBanners,
  fillFirstVisible,
  normalizeCapturedAwards,
  saveDebugArtifacts
} from "./helpers.js";

export const baRewardFlightFinderAdapter: BrowserCollectorAdapter = {
  id: "ba-reward-flight-finder",
  name: "British Airways Reward Flight Finder",
  async collect({ context, route, config }) {
    const page = await context.newPage();
    page.setDefaultTimeout(config.navigationTimeoutMs);
    const captured = captureJsonResponses(page, config.maxCapturedJsonResponses);
    const warnings: string[] = [];

    try {
      const navigationError = await page.goto("https://www.britishairways.com/travel/flightfinder/public/en_gb", {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs
      }).then(() => undefined).catch((error) => error instanceof Error ? error : new Error(String(error)));
      if (navigationError) {
        const debugArtifacts = await saveDebugArtifacts(page, config.debugDir, this.id, route);
        return {
          results: [],
          warnings: [`BA page did not finish loading before timeout. Collector will not bypass queue, captcha, or bot-protection controls. ${navigationError.message}`],
          debugArtifacts
        };
      }
      await dismissCommonCookieBanners(page);
      await page.waitForTimeout(config.actionDelayMs);

      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (/experiencing high demand|welcome to ba\.com/i.test(bodyText)) {
        const debugArtifacts = await saveDebugArtifacts(page, config.debugDir, this.id, route);
        return {
          results: [],
          warnings: ["BA served its high-demand holding page. Collector will not bypass queue, captcha, or bot-protection controls."],
          debugArtifacts
        };
      }

      const fromFilled = await fillFirstVisible(page, [
        "input[name*='from' i]",
        "input[id*='from' i]",
        "input[aria-label*='from' i]",
        "input[placeholder*='from' i]"
      ], route.origin);
      const toFilled = await fillFirstVisible(page, [
        "input[name*='to' i]",
        "input[id*='to' i]",
        "input[aria-label*='to' i]",
        "input[placeholder*='to' i]",
        "input[name*='destination' i]"
      ], route.destination);
      const dateFilled = await fillFirstVisible(page, [
        "input[name*='outbound' i]",
        "input[id*='outbound' i]",
        "input[aria-label*='outbound' i]",
        "input[placeholder*='date' i]",
        "input[type='date']"
      ], route.startDate);

      if (!fromFilled || !toFilled) {
        warnings.push("Could not confidently fill BA route fields; UI selectors may have changed or the profile may need a manual setup run.");
      }
      if (!dateFilled) {
        warnings.push("Could not confidently fill BA date field; attempting search anyway.");
      }

      await clickFirst(page, [/find/i, /search/i, /submit/i]);
      await page.waitForLoadState("networkidle", { timeout: config.navigationTimeoutMs }).catch(() => undefined);
      await page.waitForTimeout(config.actionDelayMs);

      const results = normalizeCapturedAwards(captured, route, this.id);
      const debugArtifacts = results.length ? [] : await saveDebugArtifacts(page, config.debugDir, this.id, route);
      if (!results.length) {
        warnings.push("BA collector found no normalized awards in captured browser responses.");
      }
      return { results, warnings, debugArtifacts };
    } finally {
      await page.close().catch(() => undefined);
    }
  }
};
