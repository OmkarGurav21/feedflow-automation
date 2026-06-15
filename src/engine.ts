import { chromium, type Browser, type Page } from "playwright";
import { config, HASHTAG_MAP } from "./config.js";
import {
  getUserPreferences,
  getInstagramAccount,
  getAutomationStatus,
  ensureAutomationStatus,
  upsertAutomationStatus,
  insertLog,
} from "./supabase.js";

interface ActionDetail {
  type: "like" | "save";
  hashtag: string;
}

interface AutomationResult {
  success: boolean;
  actionsPerformed: number;
  hashtagsSearched: string[];
  errors: string[];
  likes: number;
  saves: number;
}

export async function runAutomationCycle(userId: string): Promise<AutomationResult> {
  const result: AutomationResult = {
    success: false,
    actionsPerformed: 0,
    hashtagsSearched: [],
    errors: [],
    likes: 0,
    saves: 0,
  };

  const startTime = new Date().toISOString();
  console.log("=".repeat(60));
  console.log(`[${startTime}] Automation cycle started for user ${userId}`);

  try {
    await ensureAutomationStatus(userId);
    await insertLog(userId, "Automation cycle started", "info", { hashtags: [] });
    console.log("  Automation status ensured.");

    const status = await getAutomationStatus(userId);

    if (!status || status.status !== "active") {
      const msg = "Automation is paused or not configured. Skipping cycle.";
      console.log(`  ${msg}`);
      await insertLog(userId, msg, "info");
      result.success = true;
      return result;
    }

    const instagramAccount = await getInstagramAccount(userId);
    if (!instagramAccount || !instagramAccount.instagram_password) {
      const msg = "No Instagram account or password found. Skipping cycle.";
      console.log(`  ${msg}`);
      await insertLog(userId, msg, "info");
      result.success = true;
      return result;
    }

    console.log(`  Loaded Instagram account: @${instagramAccount.instagram_username}`);

    const preferences = await getUserPreferences(userId);
    console.log(`  Loaded interests: ${preferences.map((p) => p.interest).join(", ") || "none"}`);

    if (preferences.length === 0) {
      const msg = "No interests selected. Skipping cycle.";
      console.log(`  ${msg}`);
      await insertLog(userId, msg, "info");
      result.success = true;
      return result;
    }

    const interestIds = preferences.map((p) => p.interest);
    console.log(`  Interests: ${interestIds.join(", ")}`);

    const hashtags = Array.from(new Set(interestIds.flatMap((id) => HASHTAG_MAP[id] ?? [])));

    if (hashtags.length === 0) {
      const msg = "No hashtags mapped for selected interests. Skipping cycle.";
      console.log(`  ${msg}`);
      await insertLog(userId, msg, "info");
      result.success = true;
      return result;
    }

    console.log(`  Hashtags to search: ${hashtags.join(", ")}`);
    console.log("  Automation started.");

    console.log("  Launching browser...");
    const browser: Browser = await chromium.launch({
      headless: config.HEADLESS,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
      permissions: [],
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    });

    const page: Page = await context.newPage();

    try {
      await loginToInstagram(page, instagramAccount.instagram_username, instagramAccount.instagram_password);
      await insertLog(userId, "Logged into Instagram", "info");

      let totalLikes = 0;
      let totalSaves = 0;

      for (const hashtag of hashtags) {
        if (totalLikes >= config.MAX_LIKES_PER_CYCLE) {
          console.log(`  Reached max likes (${config.MAX_LIKES_PER_CYCLE}). Stopping.`);
          break;
        }

        const remaining = config.MAX_LIKES_PER_CYCLE - totalLikes;
        console.log(`  Searching #${hashtag} (need ${remaining} more likes)...`);

        try {
          const { likes, saves, actions } = await interactWithHashtag(page, hashtag, remaining);
          totalLikes += likes;
          totalSaves += saves;
          result.hashtagsSearched.push(hashtag);

          if (actions.length > 0) {
            console.log(`  Hashtag searched: #${hashtag}`);
            await insertLog(userId, `Hashtag searched: #${hashtag}`, "info", { hashtag });
          }

          for (const action of actions) {
            if (action.type === "like") {
              console.log(`  Post liked from #${hashtag}`);
              await insertLog(userId, `Post liked from #${hashtag}`, "success", { hashtag });
            } else {
              console.log(`  Post saved from #${hashtag}`);
              await insertLog(userId, `Post saved from #${hashtag}`, "success", { hashtag });
            }
          }
        } catch (err) {
          const msg = `Error interacting with #${hashtag}: ${err instanceof Error ? err.message : String(err)}`;
          console.error(`  ${msg}`);
          result.errors.push(msg);
          await insertLog(userId, msg, "error", { hashtag });
        }

        await page.waitForTimeout(3000);
      }

      result.likes = totalLikes;
      result.saves = totalSaves;
      result.actionsPerformed = totalLikes + totalSaves;

      const now = new Date().toISOString();
      await upsertAutomationStatus(userId, "active", now);

      console.log("  Automation completed.");
      await insertLog(userId, "Automation completed", "success", {
        likes: totalLikes,
        saves: totalSaves,
        hashtagsSearched: result.hashtagsSearched,
        duration: calculateDuration(startTime),
      });

      result.success = true;
      console.log(`[${new Date().toISOString()}] Cycle complete: ${totalLikes} likes, ${totalSaves} saves`);
    } finally {
      await browser.close();
      console.log("  Browser closed.");
    }
  } catch (err) {
    const msg = `Automation cycle failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error(`  ${msg}`);
    result.errors.push(msg);
    await insertLog(userId, msg, "error", { error: String(err) });
  }

  console.log("=".repeat(60));
  return result;
}

async function loginToInstagram(page: Page, username: string, password: string): Promise<void> {
  console.log("  Navigating to Instagram login...");
  await page.goto("https://www.instagram.com/accounts/login/", {
    waitUntil: "commit",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  await page.waitForSelector('input[type="text"]', { timeout: 15000 });
  await page.fill('input[type="text"]', username);
  await page.fill('input[type="password"]', password);

  const loginBtn = page.locator('div[role="button"]:has-text("Log in")').first();
  if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await loginBtn.click();
  } else {
    await page.locator('button[type="submit"]').first().click();
  }

  await page.waitForFunction(
    () => !window.location.href.includes("/login/"),
    { timeout: 20000 }
  );
  await page.waitForTimeout(2000);

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

  console.log("  Login successful.");
}

async function interactWithHashtag(
  page: Page,
  hashtag: string,
  maxLikes: number
): Promise<{ likes: number; saves: number; actions: ActionDetail[] }> {
  const actions: ActionDetail[] = [];
  let likes = 0;
  let saves = 0;

  await page.goto(`https://www.instagram.com/explore/tags/${hashtag}/`, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const firstPost = page.locator('a[href*="/p/"]').first();
  if (!(await firstPost.isVisible({ timeout: 10000 }))) {
    console.log(`  No posts found for #${hashtag}`);
    return { likes: 0, saves: 0, actions };
  }

  await firstPost.click();
  await page.waitForTimeout(3000);

  for (let i = 0; i < maxLikes; i++) {
    try {
      await page.waitForTimeout(1500);

      const likeSelectors = [
        'svg[aria-label="Like"]',
        'svg[aria-label="Like Photo"]',
        'svg[aria-label="Like Video"]',
        'button[aria-label="Like"]',
        'span[aria-label="Like"]',
        'section svg[aria-label="Like"], section svg[aria-label="Unlike"]',
      ];

      let liked = false;
      for (const sel of likeSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          const label = await btn.getAttribute("aria-label");
          if (label && (label === "Like" || label === "Like Photo" || label === "Like Video")) {
            await btn.click();
            likes++;
            liked = true;
            actions.push({ type: "like", hashtag });
            await page.waitForTimeout(1500);
            break;
          } else if (label && (label === "Unlike" || label === "Unlike Photo" || label === "Unlike Video")) {
            liked = true;
            break;
          }
        }
      }

      if (!liked) {
        try {
          const heart = page.locator("section svg").first();
          await heart.click();
          likes++;
          actions.push({ type: "like", hashtag });
          await page.waitForTimeout(1500);
        } catch { }
      }

      const saveSelectors = [
        'svg[aria-label="Save"]',
        'svg[aria-label="Save Photo"]',
        'svg[aria-label="Save Video"]',
        'button[aria-label="Save"]',
      ];

      let saved = false;
      for (const sel of saveSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          const label = await btn.getAttribute("aria-label");
          if (label && (label === "Save" || label === "Save Photo" || label === "Save Video")) {
            await btn.click();
            saves++;
            saved = true;
            actions.push({ type: "save", hashtag });
            await page.waitForTimeout(1500);
            break;
          } else if (label && (label === "Remove" || label === "Saved")) {
            saved = true;
            break;
          }
        }
      }

      if (!saved) {
        try {
          const allSvgs = page.locator("section svg");
          const count = await allSvgs.count();
          if (count >= 4) {
            const bookmark = allSvgs.nth(count - 1);
            await bookmark.click();
            saves++;
            actions.push({ type: "save", hashtag });
            await page.waitForTimeout(1500);
          }
        } catch { }
      }

      const nextSelectors = [
        'svg[aria-label="Next"]',
        'button[aria-label="Next"]',
        'a[aria-label="Next"]',
      ];
      let clicked = false;
      for (const sel of nextSelectors) {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await btn.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) break;
    } catch {
      break;
    }
  }

  return { likes, saves, actions };
}

function calculateDuration(startTime: string): string {
  const diff = Date.now() - new Date(startTime).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}
