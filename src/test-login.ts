import "dotenv/config";
import { chromium } from "playwright";

const INSTAGRAM_USERNAME = process.env.INSTAGRAM_USERNAME ?? "";
const INSTAGRAM_PASSWORD = process.env.INSTAGRAM_PASSWORD ?? "";

if (!INSTAGRAM_USERNAME || !INSTAGRAM_PASSWORD) {
  console.error("Missing INSTAGRAM_USERNAME or INSTAGRAM_PASSWORD in .env");
  process.exit(1);
}

let stepCounter = 0;
async function screenshot(page: any, label: string) {
  stepCounter++;
  const path = `step-${String(stepCounter).padStart(2, "0")}-${label}.png`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  [shot] ${path}`);
}

async function main() {
  console.log("Launching Chromium (non-headless)...\n");
  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: "en-US",
    permissions: [],
  });
  const page = await context.newPage();

  try {
    // ── Step 1: Login ──────────────────────────────────────────
    console.log("[1/6] Navigating to Instagram login...");
    await page.goto("https://www.instagram.com/accounts/login/", {
      waitUntil: "commit",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);

    await page.waitForSelector('input[type="text"]', { timeout: 15000 });
    await page.fill('input[type="text"]', INSTAGRAM_USERNAME);
    await page.fill('input[type="password"]', INSTAGRAM_PASSWORD);
    await screenshot(page, "login-form-filled");

    const loginBtn = page.locator('div[role="button"]:has-text("Log in")').first();
    if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await loginBtn.click();
    } else {
      await page.locator('button[type="submit"]').first().click();
    }

    // Wait for navigation away from /login/
    await page.waitForFunction(
      () => !window.location.href.includes("/login/"),
      { timeout: 20000 }
    );
    await page.waitForTimeout(2000);

    // Dismiss interstitials (Save Info, Not Now, etc.)
    const dismissPhrases = [/not now/i, /save info/i, /skip/i, /later/i];
    for (const phrase of dismissPhrases) {
      try {
        const btn = page.locator("button", { hasText: phrase }).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click();
          await page.waitForTimeout(2000);
        }
      } catch { }
    }
    try {
      const el = page
        .locator('div[role="button"]:has-text("Not Now"), a:has-text("Not Now"), span:has-text("Not Now")')
        .first();
      if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
        await el.click();
        await page.waitForTimeout(2000);
      }
    } catch { }

    await page.waitForFunction(
      () => !window.location.href.includes("/accounts/"),
      { timeout: 20000 }
    );
    await screenshot(page, "login-success");
    console.log("  LOGIN SUCCESS — Homepage loaded\n");

    // ── Step 2: Navigate to hashtag ─────────────────────────────
    const HASHTAG = "technology";
    console.log(`[2/6] Navigating to #${HASHTAG}...`);
    await page.goto(`https://www.instagram.com/explore/tags/${HASHTAG}/`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(3000);
    await screenshot(page, `hashtag-${HASHTAG}`);
    console.log("  Hashtag page loaded\n");

    // ── Step 3: Open first post ─────────────────────────────────
    console.log("[3/6] Opening first post...");
    console.log(`  URL: ${page.url()}`);

    // Print page text to understand what's visible
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const lines = bodyText.split("\n").filter((l: string) => l.trim()).slice(0, 15);
    console.log(`  Page text (top): ${lines.join(" | ")}`);

    // Try multiple selectors for post links
    const postSelectors = [
      'a[href*="/p/"]',
      'a[href*="/reel/"]',
      "article a",
      'div[style*="flex"] a[href*="/"]',
      "a[href*='/p/'] img",
      'div[role="button"] a',
    ];

    let postLink = null;
    let usedSelector = "";
    for (const sel of postSelectors) {
      const count = await page.locator(sel).count();
      console.log(`  Selector "${sel}" → ${count} found`);
      if (count > 0 && !postLink) {
        postLink = page.locator(sel).first();
        usedSelector = sel;
      }
    }

    if (!postLink) {
      // Last resort: find any link on the page that looks like a post
      const allLinks = page.locator("a");
      const linkCount = await allLinks.count();
      console.log(`  Total <a> elements: ${linkCount}`);
      for (let i = 0; i < Math.min(linkCount, 10); i++) {
        const href = await allLinks.nth(i).getAttribute("href");
        console.log(`  link[${i}]: href="${href}"`);
      }
      throw new Error("No posts found");
    }

    const postUrl = await postLink.getAttribute("href");
    console.log(`  Opening via: ${usedSelector}`);
    console.log(`  Post URL: ${postUrl}`);
    await postLink.click();
    await page.waitForTimeout(3000);
    await screenshot(page, "post-opened");
    console.log("  Post opened\n");

    // ── Step 4: Like the post ───────────────────────────────────
    console.log("[4/6] Liking post...");
    const likeSelectors = [
      'svg[aria-label="Like"]',
      'svg[aria-label="Like Photo"]',
      'svg[aria-label="Like Video"]',
      'button[aria-label="Like"]',
      'span[aria-label="Like"]',
      // The heart icon in the post actions
      'section svg[aria-label="Like"], section svg[aria-label="Unlike"]',
    ];

    let liked = false;
    for (const sel of likeSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          const label = await btn.getAttribute("aria-label");
          if (label && (label === "Like" || label === "Like Photo" || label === "Like Video")) {
            await btn.click();
            liked = true;
            console.log(`  Like clicked via: ${sel}`);
            await page.waitForTimeout(1500);
            break;
          } else if (label && (label === "Unlike" || label === "Unlike Photo" || label === "Unlike Video")) {
            liked = true;
            console.log("  Already liked");
            break;
          }
        }
      } catch { }
    }

    if (!liked) {
      // Fallback: click the first svg in the action section
      try {
        const heart = page.locator("section svg").first();
        await heart.click();
        liked = true;
        console.log("  Like clicked via fallback");
        await page.waitForTimeout(1500);
      } catch { }
    }

    await screenshot(page, liked ? "post-liked" : "post-like-failed");
    console.log(`  Liked: ${liked}\n`);

    // ── Step 5: Save the post ───────────────────────────────────
    console.log("[5/6] Saving post...");
    const saveSelectors = [
      'svg[aria-label="Save"]',
      'svg[aria-label="Save Photo"]',
      'svg[aria-label="Save Video"]',
      'button[aria-label="Save"]',
      // Bookmark icon is typically the last svg in the action bar
    ];

    let saved = false;
    for (const sel of saveSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          const label = await btn.getAttribute("aria-label");
          if (label && (label === "Save" || label === "Save Photo" || label === "Save Video")) {
            await btn.click();
            saved = true;
            console.log(`  Save clicked via: ${sel}`);
            await page.waitForTimeout(1500);
            break;
          } else if (label && (label === "Remove" || label === "Saved")) {
            saved = true;
            console.log("  Already saved");
            break;
          }
        }
      } catch { }
    }

    if (!saved) {
      // Fallback: find the bookmark icon (usually last action icon)
      try {
        const allSvgs = page.locator("section svg");
        const count = await allSvgs.count();
        if (count >= 4) {
          const bookmark = allSvgs.nth(count - 1); // Last action icon is usually bookmark
          await bookmark.click();
          saved = true;
          console.log("  Save clicked via fallback");
          await page.waitForTimeout(1500);
        }
      } catch { }
    }

    await screenshot(page, saved ? "post-saved" : "post-save-failed");
    console.log(`  Saved: ${saved}\n`);

    // ── Step 6: Summary ─────────────────────────────────────────
    console.log("[6/6] Automation complete");
    console.log("  ─────────────────────────────────────");
    console.log(`  Login        : SUCCESS`);
    console.log(`  Hashtag      : #${HASHTAG}`);
    console.log(`  Post opened  : YES`);
    console.log(`  Like         : ${liked ? "SUCCESS" : "FAILED"}`);
    console.log(`  Save         : ${saved ? "SUCCESS" : "FAILED"}`);
    console.log("  ─────────────────────────────────────\n");
  } catch (err) {
    await page.screenshot({ path: "00-error.png", fullPage: false }).catch(() => {});
    console.log(`\n  ERROR — ${err instanceof Error ? err.message : String(err)}\n`);
  } finally {
    await browser.close();
    console.log("Browser closed.");
  }
}

main();
