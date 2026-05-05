require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function check() {
  await supabase.from('employees').update({ birthday: '2003-05-06' }).eq('slack_id', 'U0AT493S7HC');
  await supabase.from('user_profiles').update({ birth_day: 6, birth_month: 5 }).eq('slack_id', 'U0AT493S7HC');
  await supabase.from('channel_settings').update({ post_time: '00:24' }).eq('channel_id', 'C0ASZV26EQ3');
  console.log("Updated taha.khan birthday to May 6 and post_time to 00:24");
}

check().catch(console.error);
