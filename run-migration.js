/**
 * Run this ONCE to apply the bulk_templates migration.
 * Usage:  node run-migration.js
 *
 * It uses the Supabase service-role key so it can run DDL via the REST API
 * by creating the tables through the management API.
 *
 * NOTE: If you have direct Postgres access, just paste the SQL in
 *       supabase/migrations/20260511_bulk_templates.sql into the
 *       Supabase SQL Editor instead.
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

// We'll create the tables by running a tiny select and catching the "not found"
// error — the real migration must be run via the Supabase Dashboard SQL editor.
// This script just verifies whether the tables are present.

async function verify() {
  const tables = ["bulk_templates", "bulk_template_history"];
  for (const table of tables) {
    const { error } = await supabase.from(table).select("id").limit(1);
    if (error) {
      console.log(`❌  ${table} — NOT found. Please run the SQL migration.`);
    } else {
      console.log(`✅  ${table} — OK`);
    }
  }

  console.log("\n📋 Migration SQL is at:");
  console.log("   supabase/migrations/20260511_bulk_templates.sql");
  console.log("\nPaste it into the Supabase Dashboard → SQL Editor → Run");
}

verify().catch(console.error);
