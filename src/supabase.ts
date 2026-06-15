import { createClient } from "@supabase/supabase-js";
import { config } from "./config.js";

export const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);

export interface PreferencesRow {
  user_id: string;
  interest: string;
  type: "more" | "less";
}

export interface AutomationStatusRow {
  user_id: string;
  status: "active" | "paused";
  last_sync: string | null;
}

export interface AutomationLogRow {
  id?: string;
  user_id: string;
  action: string;
  status: "success" | "error" | "info";
  created_at: string;
  metadata?: Record<string, unknown>;
}

export interface InstagramAccountRow {
  user_id: string;
  instagram_username: string;
  instagram_password: string;
  connection_status: string;
  connected_at: string | null;
  last_sync: string | null;
  updated_at: string;
}

export async function getUserPreferences(userId: string): Promise<PreferencesRow[]> {
  const { data, error } = await supabase
    .from("preferences")
    .select("*")
    .eq("user_id", userId)
    .eq("type", "more");

  if (error) {
    throw new Error(`Failed to fetch preferences: ${error.message}`);
  }

  return data ?? [];
}

export async function getInstagramAccount(userId: string): Promise<InstagramAccountRow | null> {
  const { data, error } = await supabase
    .from("instagram_accounts")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch Instagram account: ${error.message}`);
  }

  return data ?? null;
}

export async function saveInstagramAccount(
  userId: string,
  instagramUsername: string,
  instagramPassword: string
): Promise<void> {
  const { error } = await supabase.from("instagram_accounts").upsert(
    {
      user_id: userId,
      instagram_username: instagramUsername,
      instagram_password: instagramPassword,
      connection_status: "connected",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw new Error(`Failed to save Instagram account: ${error.message}`);
  }
}

export async function getAutomationStatus(userId: string): Promise<AutomationStatusRow | null> {
  const { data, error } = await supabase
    .from("automation_status")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(`Failed to fetch automation status: ${error.message}`);
  }

  return data ?? null;
}

export async function ensureAutomationStatus(userId: string): Promise<AutomationStatusRow> {
  const existing = await getAutomationStatus(userId);
  if (existing) return existing;

  const row = { user_id: userId, status: "active" as const, last_sync: null };
  const { error } = await supabase.from("automation_status").insert(row);

  if (error) {
    throw new Error(`Failed to create automation status: ${error.message}`);
  }

  return row;
}

export async function upsertAutomationStatus(
  userId: string,
  status: "active" | "paused",
  lastSync: string
): Promise<void> {
  const { error } = await supabase
    .from("automation_status")
    .upsert({ user_id: userId, status, last_sync: lastSync }, { onConflict: "user_id" });

  if (error) {
    throw new Error(`Failed to update automation status: ${error.message}`);
  }
}

export async function insertLog(
  userId: string,
  action: string,
  status: "success" | "error" | "info",
  metadata?: Record<string, unknown>
): Promise<void> {
  const { data, error } = await supabase.from("automation_logs").insert({
    user_id: userId,
    action,
    status,
    created_at: new Date().toISOString(),
    metadata,
  }).select();

  if (error) {
    console.error(`[insertLog FAILED] action="${action}" error="${error.message}" code="${error.code}" details="${error.details}"`);
    throw new Error(`Failed to insert log: ${error.message}`);
  }

  if (!data || data.length === 0) {
    console.error(`[insertLog EMPTY] action="${action}" — no rows returned`);
    throw new Error(`Log insert returned no rows for action: ${action}`);
  }
}
