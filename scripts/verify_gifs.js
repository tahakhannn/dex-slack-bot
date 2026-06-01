// Verify GIF URLs are accessible and under 1MB

const birthdayGifs = [
  "https://media.giphy.com/media/v0uvKMF0GoJGLjDcrg/200.gif",
  "https://media.giphy.com/media/MG4ctSFB04ltvXpudW/200.gif",
  "https://media.giphy.com/media/3ZAlq6xSJO6TxSO7fo/200.gif",
  "https://media.giphy.com/media/W0rfEyF1UeEda/200.gif",
  "https://media.giphy.com/media/dwI09ZWZ93gIt7uhQm/200.gif",
  "https://media.giphy.com/media/trBhcepK6CMFoNSVhv/200.gif",
  "https://media.giphy.com/media/7NON3hH96H4InrrkPy/200.gif",
  "https://media.giphy.com/media/VyB31XTqZNJhFRZNyl/200.gif",
  "https://media.giphy.com/media/sO9ZMOgU7LqbiTvwJM/200.gif",
  "https://media.giphy.com/media/kxcTvgdRAQeUpoTzwY/200.gif",
  "https://media.giphy.com/media/20cS04roeYZcVXAypm/200.gif",
  "https://media.giphy.com/media/CKzqGQ1GDMAl4HQifG/200.gif",
  "https://media.giphy.com/media/TbyAOtYa4ywrSpvjtm/200.gif",
  "https://media.giphy.com/media/FBaOcceal399S/200.gif",
  "https://media.giphy.com/media/Q0QSGW9vAs4l6S3CPd/200.gif",
  "https://media.giphy.com/media/4oaCPLmXriCpMUowWV/200.gif",
  "https://media.giphy.com/media/TSpM3iivfaVfH5zjAC/200.gif",
  "https://media.giphy.com/media/8hNcC55mX8X5JYADrn/200.gif",
  "https://media.giphy.com/media/Jqmaf9ojW95AKxYmTZ/200.gif",
  "https://media.giphy.com/media/6siM8XbTN4STqannvU/200.gif",
];

const anniversaryGifs = [
  "https://media.giphy.com/media/yLD5PKYq7tsQZPZXpn/200.gif",
  "https://media.giphy.com/media/R3ART6G2nAPNepCtdI/200.gif",
  "https://media.giphy.com/media/0ksns8g525Jg5t7aTM/200.gif",
  "https://media.giphy.com/media/hv14mGOF3MY7wDKPkE/200.gif",
  "https://media.giphy.com/media/AIcu7gsqX0EVyAdrHl/200.gif",
  "https://media.giphy.com/media/ihef2mzZVbV4FygisP/200.gif",
  "https://media.giphy.com/media/tTOua3aOz8S44ixPPf/200.gif",
  "https://media.giphy.com/media/UBAf8QIWQZ7p6IOZEm/200.gif",
  "https://media.giphy.com/media/mfHy2SFL7pvdJMBob4/200.gif",
  "https://media.giphy.com/media/mzZbByY3c3eoqy9CaP/200.gif",
  "https://media.giphy.com/media/H2Q7zcxQfbCIUNlLHe/200.gif",
  "https://media.giphy.com/media/OvJvrm9p1KR4puTALN/200.gif",
  "https://media.giphy.com/media/879RsXB8GvEuY95LNl/200.gif",
  "https://media.giphy.com/media/dOb3TjDxn67hv5QhwX/200.gif",
  "https://media.giphy.com/media/jJQC2puVZpTMO4vUs0/200.gif",
  "https://media.giphy.com/media/BZ8hdiqRlzdNfmUF4F/200.gif",
  "https://media.giphy.com/media/CRm79UgSASWGO7KHhh/200.gif",
  "https://media.giphy.com/media/q4BwsaJeisnCU3Ga5s/200.gif",
  "https://media.giphy.com/media/F7JHDDqWaSPaglz24x/200.gif",
  "https://media.giphy.com/media/9uoYC7cjcU6w8/200.gif",
];

async function verify(label, urls) {
  console.log(`\n=== ${label} ===`);
  const good = [];
  for (const url of urls) {
    try {
      const r = await fetch(url, { method: "HEAD" });
      const cl = r.headers.get("content-length");
      const kb = cl ? Math.round(Number(cl) / 1024) : "?";
      const ok = r.status === 200 && (cl ? Number(cl) <= 1024 * 1024 : true);
      const id = url.split("/media/")[1].replace("/200.gif", "");
      console.log(`  ${ok ? "✅" : "❌"} ${r.status} ${kb}KB - ${id}`);
      if (ok) good.push(url);
    } catch (e) {
      console.log(`  ❌ ERR - ${url}`);
    }
  }
  console.log(`\n  ${good.length}/${urls.length} passed`);
  return good;
}

(async () => {
  const goodBday = await verify("Birthday GIFs", birthdayGifs);
  const goodAnniv = await verify("Anniversary GIFs", anniversaryGifs);

  console.log("\n=== GOOD BIRTHDAY GIFS ===");
  goodBday.slice(0, 15).forEach((u) => console.log(`  "${u}",`));
  console.log(`  Total: ${goodBday.length}`);

  console.log("\n=== GOOD ANNIVERSARY GIFS ===");
  goodAnniv.slice(0, 15).forEach((u) => console.log(`  "${u}",`));
  console.log(`  Total: ${goodAnniv.length}`);
})();
