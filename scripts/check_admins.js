require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

async function checkAdmins() {
  const { data, error } = await supabase.from("admins").select("*");
  if (error) {
    console.error("Error fetching admins:", error.message);
  } else {
    console.log("Admins table:");
    console.table(data);
  }
}

checkAdmins();
