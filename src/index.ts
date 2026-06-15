import "dotenv/config";
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { runAutomationCycle } from "./engine.js";
import { getInstagramAccount, getAutomationStatus, insertLog } from "./supabase.js";

const app = express();

app.use(cors());
app.use(express.json());

function getUserId(req: express.Request, res: express.Response): string | null {
  const userId = req.body?.userId || req.query?.userId;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "Missing userId in request body or query" });
    return null;
  }
  return userId;
}

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/status", async (req, res) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  try {
    const status = await getAutomationStatus(userId);
    res.json({
      userId,
      ...(status ?? { status: "unknown", last_sync: null }),
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

app.post("/trigger", async (req, res) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  console.log("\n");
  console.log(">>> Manual trigger received for user:", userId);
  console.log("\n");

  const resultPromise = runAutomationCycle(userId);

  res.json({
    accepted: true,
    message: "Automation cycle started. Check /status or logs for results.",
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await resultPromise;
    const logAction = result.success
      ? `Manual cycle: ${result.likes} likes, ${result.saves} saves`
      : `Manual cycle completed with errors: ${result.errors.join("; ")}`;
    await insertLog(userId, logAction, result.success ? "success" : "error", {
      ...result,
    });
  } catch (err) {
    await insertLog(userId, "Manual cycle failed unexpectedly", "error", {
      error: String(err),
    });
  }
});

app.post("/trigger-sync", async (req, res) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  console.log("\n");
  console.log(">>> Manual sync trigger received for user:", userId);
  console.log("\n");

  try {
    const result = await runAutomationCycle(userId);
    res.json({
      success: result.success,
      hashtagsProcessed: result.hashtagsSearched.length,
      likes: result.likes,
      saves: result.saves,
      actionsPerformed: result.actionsPerformed,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      hashtagsProcessed: 0,
      likes: 0,
      saves: 0,
      actionsPerformed: 0,
      error: err instanceof Error ? err.message : "Unknown error",
      timestamp: new Date().toISOString(),
    });
  }
});

app.get("/instagram-account", async (req, res) => {
  const userId = getUserId(req, res);
  if (!userId) return;

  try {
    const account = await getInstagramAccount(userId);
    res.json({ userId, account });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

app.listen(config.PORT, '0.0.0.0', () => {
  console.log(`\n  FeedFlow Automation Service`);
  console.log(`  ${"─".repeat(40)}`);
  console.log(`  Server   : http://192.168.29.16:${config.PORT}`);
  console.log(`  Health   : http://192.168.29.16:${config.PORT}/health`);
  console.log(`  Status   : http://192.168.29.16:${config.PORT}/status`);
  console.log(`  Trigger  : POST http://192.168.29.16:${config.PORT}/trigger`);
  console.log(`  Sync     : POST http://192.168.29.16:${config.PORT}/trigger-sync`);
  console.log(`  Headless : ${config.HEADLESS}`);
  console.log(`  Max likes: ${config.MAX_LIKES_PER_CYCLE}`);
  console.log(`  ${"─".repeat(40)}\n`);
});