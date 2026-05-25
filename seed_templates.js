/**
 * Seed script — inserts 5 Birthday + 5 Work Anniversary bulk templates.
 *
 * Usage:  node seed_templates.js
 *
 * Each template has a unique intro line and cheer message.
 * Cheer messages use bold+italic (*_…_*) formatting with emojis.
 * Templates and GIFs are always randomized by the scheduler.
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY,
);

const WORKSPACE_ID = process.env.SLACK_WORKSPACE_ID || process.env.WORKSPACE_ID || "default";

// ─── Birthday Templates ────────────────────────────────────────────────────

const birthdayTemplates = [
  {
    name: "Birthday Template 1",
    introText: "🎉 Stop everything — it's party time! 🥳",
    message:
      "*_🎂 Happy Birthday! 🎈 May your day be filled with cake, laughter, and all the good vibes you deserve! Let's make some noise! 🎊🥳_*",
  },
  {
    name: "Birthday Template 2",
    introText: "🌟 Grab your confetti — a star was born today! ✨",
    message:
      "*_🎁 It's the big day! 🎉 Wishing you a birthday as awesome as you are — cheers to another trip around the sun! 🍰☀️🥂_*",
  },
  {
    name: "Birthday Template 3",
    introText: "🔔 Ding ding ding — birthday alert incoming! 🚨🎂",
    message:
      "*_🥳 Blow out the candles! 🕯️ Another year of being absolutely amazing starts NOW — let's celebrate YOU! 🎶🎈💃_*",
  },
  {
    name: "Birthday Template 4",
    introText: "🎈 Clear your calendars — we've got a celebration on our hands! 🎊",
    message:
      "*_🎉 Hip hip hooray! 🎂 May your birthday be sprinkled with joy, wrapped in love, and topped with extra frosting! 🧁❤️🎁_*",
  },
  {
    name: "Birthday Template 5",
    introText: "🪅 The countdown is over — today we celebrate! 🥳🎆",
    message:
      "*_🌈 Happy Birthday! 🎊 You bring so much energy to this team — today it's our turn to bring the energy to YOU! Let's gooo! 🚀🎂🔥_*",
  },
];

// ─── Work Anniversary Templates ────────────────────────────────────────────

const anniversaryTemplates = [
  {
    name: "Work Anniversary Template 1",
    introText: "🏆 Achievement unlocked — milestone alert! 🎯",
    message:
      "*_💼 Cheers on {ANNIV_YEARS} incredible year(s) with us! 🥂 Your dedication and hard work inspire everyone around you — here's to many more! 🌟🎉👏_*",
  },
  {
    name: "Work Anniversary Template 2",
    introText: "📣 Attention team — we've got a legend in the house! 🎤✨",
    message:
      "*_🎊 Celebrating {ANNIV_YEARS} year(s) of awesomeness! 💪 Thank you for being the rockstar you are — this team wouldn't be the same without you! 🤘🔥🥳_*",
  },
  {
    name: "Work Anniversary Template 3",
    introText: "🎯 Mark your calendars — today is a special day! 📅🌟",
    message:
      "*_🥂 A standing ovation! 👏 {ANNIV_YEARS} year(s) of crushing it — you bring passion, grit, and greatness every single day! Keep shining! ✨💼🏅_*",
  },
  {
    name: "Work Anniversary Template 4",
    introText: "🌟 Roll out the red carpet — milestone moment incoming! 🎬🎉",
    message:
      "*_🎉 Happy Work Anniversary! 🎈 {ANNIV_YEARS} year(s) of making magic happen — your journey here has been nothing short of amazing! Let's celebrate BIG! 🥳🚀💎_*",
  },
  {
    name: "Work Anniversary Template 5",
    introText: "⚡ Power move alert — someone just leveled up! 🆙🏆",
    message:
      "*_💥 Boom! {ANNIV_YEARS} year(s) strong! 💣 From day one to today, you've been an absolute force — grateful to have you on this ride! Let's keep winning together! 🏆🙌🎊_*",
  },
];

async function seed() {
  console.log("🌱 Seeding birthday and work anniversary templates...\n");

  for (const t of birthdayTemplates) {
    const { data, error } = await supabase.from("bulk_templates").insert({
      workspace_id: WORKSPACE_ID,
      type: "birthday",
      name: t.name,
      message: t.message,
      intro_text: t.introText,
      gif_urls: [],
      updated_at: new Date().toISOString(),
    }).select();

    if (error) {
      console.error(`❌ Failed to insert "${t.name}":`, error.message);
    } else {
      console.log(`✅ ${t.name} — inserted (id: ${data?.[0]?.id})`);
    }
  }

  console.log("");

  for (const t of anniversaryTemplates) {
    const { data, error } = await supabase.from("bulk_templates").insert({
      workspace_id: WORKSPACE_ID,
      type: "anniversary",
      name: t.name,
      message: t.message,
      intro_text: t.introText,
      gif_urls: [],
      updated_at: new Date().toISOString(),
    }).select();

    if (error) {
      console.error(`❌ Failed to insert "${t.name}":`, error.message);
    } else {
      console.log(`✅ ${t.name} — inserted (id: ${data?.[0]?.id})`);
    }
  }

  console.log("\n🎉 Done! All templates seeded.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
