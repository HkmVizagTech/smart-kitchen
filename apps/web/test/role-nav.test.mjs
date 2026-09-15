// Verifies the merge: sign in as each role and check the nav shows exactly the
// sections that role should have — and nothing else. The API is stubbed so this
// runs against no database.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const DIST = path.resolve(new URL("../dist", import.meta.url).pathname);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };

// Static server for the built app (SPA fallback to index.html).
const server = http.createServer((req, res) => {
  let file = path.join(DIST, decodeURIComponent(req.url.split("?")[0]));
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
  res.writeHead(200, { "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(4310, r));

const EXPECTED = {
  BOOKING:            ["New Booking", "My Bookings", "Close a Meal"],
  KITCHEN_ADMIN:      ["Orders", "Packing Sheet"],
  VERIFICATION_ADMIN: ["To verify", "Payments"],
  SUPER_ADMIN:        ["New Booking", "My Bookings", "Close a Meal", "Orders", "Packing Sheet",
                       "To verify", "Payments", "Dashboard", "Reports", "Dishes", "Vessels",
                       "Routes", "Users", "Settings"],
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
let failures = 0;

for (const [role, expected] of Object.entries(EXPECTED)) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // Stub every API call the shell makes on boot.
  await page.route("**/auth/me", (r) =>
    r.fulfill({ json: { user: { id: 1, name: "Test Person", role, unitId: null } } }));
  await page.route("**/notifications/summary", (r) => r.fulfill({ json: { unread: 0, sections: {} } }));
  await page.route("**/notifications", (r) => r.fulfill({ json: [] }));
  // Any other API call returns something harmless so sections don't explode.
  await page.route("**/booking-menu", (r) => r.fulfill({ json: { ITEM1: [], ITEM2: [], ITEM3: [] } }));
  // Playwright tries the most recently registered route first, so the catch-all
  // goes first and the specific shapes after it.
  await page.route("**/admin/**", (r) => r.fulfill({ json: [] }));
  await page.route("**/admin/settings", (r) => r.fulfill({ json: {} }));
  await page.route("**/admin/dashboard", (r) => r.fulfill({ json: {
    tomorrow: { breakfast: { booked: 0, total: 6, plates: 0, orders: 0 }, dinner: { booked: 0, total: 6, plates: 0, orders: 0 } },
    today: { lunch: { booked: 0, total: 6, plates: 0, orders: 0 } },
    pendingVerifications: 0, usersCount: 0, dishesCount: 0, totalKitchens: 6, recent: [] } }));
  await page.route("**/orders**", (r) => r.fulfill({ json: [] }));
  await page.route("**/booking/progress**", (r) => r.fulfill({ json: { total: 6, booked: 0, ready: false, units: [] } }));

  await page.addInitScript(() => localStorage.setItem("sk_token", "stub.token"));
  await page.goto("http://127.0.0.1:4310/", { waitUntil: "networkidle" });
  try {
    await page.waitForSelector(".sidebar .item", { timeout: 10000 });
  } catch {
    console.log(`FAIL  ${role} — shell never rendered`);
    if (errors.length) console.log("      page errors:\n        " + errors.slice(0, 4).join("\n        "));
    failures++; await ctx.close(); continue;
  }

  const shown = await page.$$eval(".sidebar .item", (els) =>
    els.map((e) => e.textContent.trim()).filter(Boolean));
  const roleLabel = await page.$eval(".brand .sub", (e) => e.textContent.trim()).catch(() => "?");
  const landing = await page.$eval(".sidebar .item.active", (e) => e.textContent.trim()).catch(() => "none");

  const missing = expected.filter((x) => !shown.includes(x));
  const extra = shown.filter((x) => !expected.includes(x));
  const ok = missing.length === 0 && extra.length === 0;
  if (!ok) failures++;

  console.log(`${ok ? "PASS" : "FAIL"}  ${role.padEnd(19)} header="${roleLabel}"  lands on "${landing}"`);
  console.log(`      sees ${shown.length}: ${shown.join(", ")}`);
  if (missing.length) console.log(`      MISSING: ${missing.join(", ")}`);
  if (extra.length) console.log(`      LEAKED:  ${extra.join(", ")}`);
  await ctx.close();
}

// Signed-out users must get the login screen, not the shell.
const ctx = await browser.newContext();
const page = await ctx.newPage();
await page.goto("http://127.0.0.1:4310/", { waitUntil: "networkidle" });
const hasLogin = await page.$(".auth-card") !== null;
const hasSidebar = await page.$(".sidebar .item") !== null;
const okOut = hasLogin && !hasSidebar;
if (!okOut) failures++;
console.log(`${okOut ? "PASS" : "FAIL"}  signed out          login screen=${hasLogin} sidebar=${hasSidebar}`);
await ctx.close();


// A section that blows up must not take the shell with it.
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.route("**/auth/me", (r) =>
    r.fulfill({ json: { user: { id: 1, name: "Test Person", role: "SUPER_ADMIN", unitId: null } } }));
  await page.route("**/notifications/summary", (r) => r.fulfill({ json: { unread: 0, sections: {} } }));
  await page.route("**/notifications", (r) => r.fulfill({ json: [] }));
  // Deliberately wrong shape — this used to white-screen the whole app.
  await page.route("**/admin/dashboard", (r) => r.fulfill({ json: [] }));
  await page.addInitScript(() => localStorage.setItem("sk_token", "stub.token"));
  await page.goto("http://127.0.0.1:4310/", { waitUntil: "networkidle" });

  const navAlive = (await page.$$(".sidebar .item")).length;
  const errorCard = await page.$eval(".main .section-title", (e) => e.textContent.trim()).catch(() => "");
  const canSignOut = await page.$(".signout") !== null;
  const ok = navAlive === 14 && errorCard.includes("didn") && canSignOut;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  crashing section     nav still shows ${navAlive} items, sign-out=${canSignOut}, shows "${errorCard}"`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures === 0 ? "\nAll role-nav cases pass." : `\n${failures} FAILED`);
process.exit(failures ? 1 : 0);
