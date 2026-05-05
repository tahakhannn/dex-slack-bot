require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
  const { data: settings } = await supabase.from('channel_settings').select('*');
  console.log("Settings:");
  console.log(settings);

  const { data: employees } = await supabase.from('employees').select('*');
  console.log("\nEmployees:");
  console.log(employees);

  const { data: sentEvents } = await supabase.from('sent_events').select('*').order('created_at', { ascending: false }).limit(5);
  console.log("\nRecent Sent Events:");
  console.log(sentEvents);
}

check().catch(console.error);
