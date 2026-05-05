require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function testClear(slackId) {
    const [employeeUpdate, profileUpdate] = await Promise.all([
      supabase
        .from("employees")
        .update({ birthday: null, join_date: null, updated_at: new Date().toISOString() })
        .eq("slack_id", slackId)
        .select(),
      supabase
        .from("user_profiles")
        .update({
          birth_day: null,
          birth_month: null,
          birth_year: null,
          anniv_day: null,
          anniv_month: null,
          anniv_year: null,
          birthday_opt_out: false,
          anniversary_opt_out: false,
          updated_at: new Date().toISOString(),
        })
        .eq("slack_id", slackId)
        .select(),
    ]);
    console.log("Employee update:", employeeUpdate);
    console.log("Profile update:", profileUpdate);
}

testClear('U0AUE563943').catch(console.error);
