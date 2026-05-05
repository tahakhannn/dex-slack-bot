require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
async function check() {
  const { data: profiles } = await supabase.from('user_profiles').select('*');
  console.log(profiles);
}
check().catch(console.error);
