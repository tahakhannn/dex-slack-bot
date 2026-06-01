/**
 * Seed script — inserts 10 Birthday + 10 Work Anniversary bulk templates,
 * and seeds 15 Birthday + 15 Work Anniversary GIFs into the centralized pool.
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
      "*_🎁 It's your big day! 🎉 Wishing you a birthday as awesome as you are — cheers to another trip around the sun! 🍰☀️🥂_*",
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
  {
    name: "Birthday Template 6",
    introText: "🎂 Guess who's leveling up today!",
    message:
      "*_🎂 Happy Birthday! Wishing you an incredible day packed with good vibes, great people, and maybe a slice (or three) of cake! Cheers to you! 🥂🎈_*",
  },
  {
    name: "Birthday Template 7",
    introText: "🥳 Today's forecast: 100% chance of celebration!",
    message:
      "*_🎈 It's your birthday and the whole team is here to celebrate! May this year bring you all the happiness you spread to everyone around you. Have a wonderful one! 🎂✨_*",
  },
  {
    name: "Birthday Template 8",
    introText: "🎈 Hold up — someone special is celebrating today!",
    message:
      "*_🎁 Happy Birthday! You make this team brighter just by being in it. Here's to a fantastic day, an even better year, and all the adventures ahead! 🎉🍰_*",
  },
  {
    name: "Birthday Template 9",
    introText: "✨ A little birdie told us someone has a birthday today!",
    message:
      "*_🥳 Cheers to another amazing year! May your day be filled with surprises, laughter, and every good thing coming your way. Enjoy your moment — you've earned it! 🥳🎁_*",
  },
  {
    name: "Birthday Template 10",
    introText: "🎉 Sound the trumpets — it's a birthday celebration!",
    message:
      "*_🎉 Happy Birthday! Another year older, another year wiser, and still just as awesome. The team is sending you all the warm wishes today — have a blast! 🎂🌟_*",
  },
];

// ─── Work Anniversary Templates ────────────────────────────────────────────

const anniversaryTemplates = [
  {
    name: "Work Anniversary Template 1",
    introText: "🏆 Achievement unlocked — milestone alert! 🎯",
    message:
      "*_💼 Cheers to another incredible year with us! 🥂 Your dedication and hard work inspire everyone around you — here's to many more! 🌟🎉👏_*",
  },
  {
    name: "Work Anniversary Template 2",
    introText: "📣 Attention team — we've got a legend in the house! 🎤✨",
    message:
      "*_🎊 Celebrating another year of awesomeness! 💪 Thank you for being the rockstar you are — this team wouldn't be the same without you! 🤘🔥🥳_*",
  },
  {
    name: "Work Anniversary Template 3",
    introText: "🎯 Mark your calendars — today is a special day! 📅🌟",
    message:
      "*_🥂 A standing ovation! 👏 Another year of crushing it — you bring passion, grit, and greatness every single day! Keep shining! ✨💼🏅_*",
  },
  {
    name: "Work Anniversary Template 4",
    introText: "🌟 Roll out the red carpet — milestone moment incoming! 🎬🎉",
    message:
      "*_🎉 Happy Work Anniversary! 🎈 Another year of making magic happen — your journey here has been nothing short of amazing! Let's celebrate BIG! 🥳🚀💎_*",
  },
  {
    name: "Work Anniversary Template 5",
    introText: "⚡ Power move alert — someone just leveled up! 🆙🏆",
    message:
      "*_💥 Boom! Another year strong! 💣 From day one to today, you've been an absolute force — grateful to have you on this ride! Let's keep winning together! 🏆🙌🎊_*",
  },
  {
    name: "Work Anniversary Template 6",
    introText: "🎯 Milestone moment — let's give it up for a team MVP!",
    message:
      "*_🏆 Happy Work Anniversary! Your commitment and positive energy make a real difference around here. Thank you for another outstanding year — we're lucky to have you! 🥂👏_*",
  },
  {
    name: "Work Anniversary Template 7",
    introText: "🌟 Today we celebrate someone who keeps raising the bar!",
    message:
      "*_🌟 Another year in the books and you continue to impress! Your hard work, creativity, and teamwork don't go unnoticed. Here's to many more great years ahead! 🎉💼_*",
  },
  {
    name: "Work Anniversary Template 8",
    introText: "📅 Anniversary alert — time to celebrate a key player!",
    message:
      "*_💼 Happy Work Anniversary! From big wins to everyday moments, you bring your best every single day. Cheers to your journey so far and everything still to come! 🏆✨_*",
  },
  {
    name: "Work Anniversary Template 9",
    introText: "👏 Hats off — someone is marking a special milestone today!",
    message:
      "*_👏 Congratulations on another wonderful year! You've grown, contributed, and inspired — and we can't wait to see what you accomplish next. Keep being amazing! 🌟🥳_*",
  },
  {
    name: "Work Anniversary Template 10",
    introText: "🏅 A round of applause for one of our finest!",
    message:
      "*_🎉 Happy Work Anniversary! Your dedication speaks for itself. Thank you for being such a valued part of this team — here's to continued success and great memories together! 🎉🤝_*",
  },
];

// ─── Birthday GIFs (centralized pool) ──────────────────────────────────────

const birthdayGifs = [
  "https://media.giphy.com/media/W0rfEyF1UeEda/200.gif",
  "https://media.giphy.com/media/dwI09ZWZ93gIt7uhQm/200.gif",
  "https://media.giphy.com/media/7NON3hH96H4InrrkPy/200.gif",
  "https://media.giphy.com/media/VyB31XTqZNJhFRZNyl/200.gif",
  "https://media.giphy.com/media/kxcTvgdRAQeUpoTzwY/200.gif",
  "https://media.giphy.com/media/CKzqGQ1GDMAl4HQifG/200.gif",
  "https://media.giphy.com/media/TbyAOtYa4ywrSpvjtm/200.gif",
  "https://media.giphy.com/media/FBaOcceal399S/200.gif",
  "https://media.giphy.com/media/Q0QSGW9vAs4l6S3CPd/200.gif",
  "https://media.giphy.com/media/TSpM3iivfaVfH5zjAC/200.gif",
  "https://media.giphy.com/media/8hNcC55mX8X5JYADrn/200.gif",
  "https://media.giphy.com/media/Jqmaf9ojW95AKxYmTZ/200.gif",
  "https://media.giphy.com/media/6siM8XbTN4STqannvU/200.gif",
  "https://media.giphy.com/media/3o6MbhYjXivPTv1VLy/200.gif",
  "https://media.giphy.com/media/26FPpSuhgHjIauStO/200.gif",
];

// ─── Work Anniversary GIFs (centralized pool) ─────────────────────────────

const anniversaryGifs = [
  "https://media.giphy.com/media/R3ART6G2nAPNepCtdI/200.gif",
  "https://media.giphy.com/media/0ksns8g525Jg5t7aTM/200.gif",
  "https://media.giphy.com/media/AIcu7gsqX0EVyAdrHl/200.gif",
  "https://media.giphy.com/media/ihef2mzZVbV4FygisP/200.gif",
  "https://media.giphy.com/media/tTOua3aOz8S44ixPPf/200.gif",
  "https://media.giphy.com/media/mfHy2SFL7pvdJMBob4/200.gif",
  "https://media.giphy.com/media/H2Q7zcxQfbCIUNlLHe/200.gif",
  "https://media.giphy.com/media/OvJvrm9p1KR4puTALN/200.gif",
  "https://media.giphy.com/media/dOb3TjDxn67hv5QhwX/200.gif",
  "https://media.giphy.com/media/jJQC2puVZpTMO4vUs0/200.gif",
  "https://media.giphy.com/media/BZ8hdiqRlzdNfmUF4F/200.gif",
  "https://media.giphy.com/media/CRm79UgSASWGO7KHhh/200.gif",
  "https://media.giphy.com/media/q4BwsaJeisnCU3Ga5s/200.gif",
  "https://media.giphy.com/media/F7JHDDqWaSPaglz24x/200.gif",
  "https://media.giphy.com/media/3oFzm9r8SO9wFMi76E/200.gif",
];

async function seed() {
  console.log("🌱 Seeding 10 birthday + 10 work anniversary templates...\n");

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

  // ─── Seed centralized GIF pools ──────────────────────────────────────────
  console.log("\n🎬 Seeding centralized GIF pools...\n");

  // Birthday GIFs
  const { error: bdayGifError } = await supabase
    .from("templates")
    .upsert(
      {
        workspace_id: WORKSPACE_ID,
        type: "birthday",
        message: "",
        intro_text: "",
        gif_urls: birthdayGifs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "type" },
    );

  if (bdayGifError) {
    // Fallback: try insert then update
    const existing = await supabase.from("templates").select("*").eq("type", "birthday").limit(1);
    if (existing.data?.[0]) {
      const { error: updateErr } = await supabase
        .from("templates")
        .update({ gif_urls: birthdayGifs, updated_at: new Date().toISOString() })
        .eq("type", "birthday");
      if (updateErr) {
        console.error("❌ Failed to update birthday GIF pool:", updateErr.message);
      } else {
        console.log(`✅ Birthday GIF pool — updated (${birthdayGifs.length} GIFs)`);
      }
    } else {
      const { error: insertErr } = await supabase.from("templates").insert({
        workspace_id: WORKSPACE_ID,
        type: "birthday",
        message: "",
        intro_text: "",
        gif_urls: birthdayGifs,
        updated_at: new Date().toISOString(),
      });
      if (insertErr) {
        console.error("❌ Failed to insert birthday GIF pool:", insertErr.message);
      } else {
        console.log(`✅ Birthday GIF pool — inserted (${birthdayGifs.length} GIFs)`);
      }
    }
  } else {
    console.log(`✅ Birthday GIF pool — seeded (${birthdayGifs.length} GIFs)`);
  }

  // Anniversary GIFs
  const { error: annivGifError } = await supabase
    .from("templates")
    .upsert(
      {
        workspace_id: WORKSPACE_ID,
        type: "anniversary",
        message: "",
        intro_text: "",
        gif_urls: anniversaryGifs,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "type" },
    );

  if (annivGifError) {
    // Fallback: try insert then update
    const existing = await supabase.from("templates").select("*").eq("type", "anniversary").limit(1);
    if (existing.data?.[0]) {
      const { error: updateErr } = await supabase
        .from("templates")
        .update({ gif_urls: anniversaryGifs, updated_at: new Date().toISOString() })
        .eq("type", "anniversary");
      if (updateErr) {
        console.error("❌ Failed to update anniversary GIF pool:", updateErr.message);
      } else {
        console.log(`✅ Anniversary GIF pool — updated (${anniversaryGifs.length} GIFs)`);
      }
    } else {
      const { error: insertErr } = await supabase.from("templates").insert({
        workspace_id: WORKSPACE_ID,
        type: "anniversary",
        message: "",
        intro_text: "",
        gif_urls: anniversaryGifs,
        updated_at: new Date().toISOString(),
      });
      if (insertErr) {
        console.error("❌ Failed to insert anniversary GIF pool:", insertErr.message);
      } else {
        console.log(`✅ Anniversary GIF pool — inserted (${anniversaryGifs.length} GIFs)`);
      }
    }
  } else {
    console.log(`✅ Anniversary GIF pool — seeded (${anniversaryGifs.length} GIFs)`);
  }

  console.log("\n🎉 Done! All templates and GIFs seeded.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
