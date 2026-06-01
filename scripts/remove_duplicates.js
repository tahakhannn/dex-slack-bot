/**
 * One-time script to remove duplicate bulk templates.
 * Keeps the newest entry for each name+type combo, deletes older duplicates.
 *
 * Usage:  node remove_duplicates.js
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

async function removeDuplicates() {
  const { data: all, error } = await supabase
    .from("bulk_templates")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("❌ Failed to fetch templates:", error.message);
    process.exit(1);
  }

  console.log(`📋 Found ${all.length} total bulk templates\n`);

  // Group by name + type, keep the newest (first in desc order)
  const seen = new Map();
  const toDelete = [];

  for (const row of all) {
    const key = `${row.type}::${row.name}`;
    if (seen.has(key)) {
      toDelete.push(row);
    } else {
      seen.set(key, row);
    }
  }

  if (!toDelete.length) {
    console.log("✅ No duplicates found!");
    return;
  }

  console.log(`🗑️  Found ${toDelete.length} duplicate(s) to remove:\n`);

  for (const row of toDelete) {
    console.log(`   - id: ${row.id} | ${row.type} | "${row.name}"`);
    const { error: delErr } = await supabase.from("bulk_templates").delete().eq("id", row.id);
    if (delErr) {
      console.error(`   ❌ Failed to delete id ${row.id}:`, delErr.message);
    } else {
      console.log(`   ✅ Deleted`);
    }
  }

  // Verify
  const { data: remaining } = await supabase
    .from("bulk_templates")
    .select("id, type, name")
    .order("type")
    .order("name");

  console.log(`\n📋 Remaining templates: ${remaining?.length || 0}`);
  for (const r of remaining || []) {
    console.log(`   ${r.type} | "${r.name}" (id: ${r.id})`);
  }
}

removeDuplicates().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
