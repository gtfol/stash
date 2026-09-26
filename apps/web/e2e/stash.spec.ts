import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { devices, expect, test, type BrowserContext, type Page, type TestInfo } from "@playwright/test";
import { Pool } from "pg";
import { authSecret, baseURL } from "../playwright.config";

// The whole app in Chromium: the guest library in IndexedDB, then two signed-in browsers syncing
// through the server and Postgres. Page details may or may not load from the network here, so no
// assertion depends on them.

const seedTitle = "How to make a brain: new experiments challenge existing picture";
const databaseURL = process.env.E2E_DATABASE_URL;
let pool: Pool;

test.beforeAll(async () => {
  test.skip(!databaseURL, "set E2E_DATABASE_URL to a disposable database");
  pool = new Pool({ connectionString: databaseURL });
  await pool.query(readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8"));
  await pool.query("truncate public.stash_items, public.stash_accounts, public.\"session\", public.\"account\", public.\"user\" cascade");
});
test.afterAll(async () => { await pool?.end(); });

async function screen(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: false });
  await info.attach(name, { path, contentType: "image/png" });
}

const row = (page: Page, title: string) => page.getByRole("listitem").filter({ has: page.getByRole("link", { name: title }) });
const rows = (page: Page) => page.getByRole("list", { name: "saved links" }).getByRole("listitem");
const field = (page: Page) => page.getByRole("textbox", { name: "link" });
const notice = (page: Page, text: string) => page.getByText(text, { exact: true });

async function add(page: Page, text: string) {
  await field(page).fill(text);
  await page.getByRole("button", { name: "save", exact: true }).click();
}

/** A signed-in browser for `userId`, with a session made the way Better Auth makes them. */
async function signedIn(context: BrowserContext, userId: string) {
  await pool.query(`insert into public."user" (id, name, email, "emailVerified") values ($1, $1, $1 || '@example.com', true) on conflict do nothing`, [userId]);
  const token = `${userId}-${crypto.randomUUID()}`;
  await pool.query(`insert into public."session" (id, token, "userId", "expiresAt", "updatedAt") values ($1, $2, $3, now() + interval '1 day', now())`,
    [crypto.randomUUID(), token, userId]);
  // Better Auth's signed cookie: the token, a dot, and its base64 HMAC-SHA256, URL-encoded.
  const value = encodeURIComponent(`${token}.${createHmac("sha256", authSecret).update(token).digest("base64")}`);
  await context.addCookies([{ name: "better-auth.session_token", value, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}

test("a guest saves, finds, renames, and deletes links", async ({ page }, info) => {
  await page.goto("/");
  await expect(row(page, seedTitle)).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await expect(row(page, seedTitle).getByRole("link")).toHaveAttribute("href", "https://archive.ph/GDsbC");
  await screen(page, info, "01-guest-library");

  await page.getByRole("button", { name: `details for ${seedTitle}` }).click();
  const details = page.getByRole("dialog", { name: seedTitle });
  await expect(details.getByText("https://archive.ph/GDsbC", { exact: true })).toBeVisible();
  await expect(details.getByText("https://www.nature.com/articles/d41586-026-02943-1", { exact: true })).toBeVisible();
  await expect(details.getByText("Lynne Peeples · Sep 18, 2026")).toBeVisible();
  await expect(details.getByRole("link", { name: "open link" })).toHaveAttribute("href", "https://archive.ph/GDsbC");
  await screen(page, info, "02-details");
  await details.getByRole("button", { name: "done" }).click();

  await add(page, "ftp://files.example.com/report.pdf");
  await expect(notice(page, "stash saves http and https links, not ftp links. nothing was saved.")).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await screen(page, info, "03-unsupported-scheme");

  await field(page).fill("example.com/stash-e2e");
  await expect(page.getByText("saves as https://example.com/stash-e2e")).toBeVisible();
  await page.getByRole("button", { name: "save", exact: true }).click();
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first().getByRole("link")).toHaveAttribute("href", "https://example.com/stash-e2e");
  await expect(field(page)).toHaveValue("");
  await screen(page, info, "04-saved");

  await add(page, "https://www.example.com/stash-e2e/?utm_source=e2e");
  await expect(notice(page, "already saved. moved to the top.")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  const search = page.getByRole("searchbox", { name: "search" });
  await search.fill("brain");
  await expect(rows(page)).toHaveCount(1);
  await search.fill("brain zzz");
  await expect(page.getByText("no matches")).toBeVisible();
  await screen(page, info, "05-no-matches");
  await page.getByRole("button", { name: "clear", exact: true }).click();
  await expect(search).toHaveValue("");
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole("button", { name: "details for example.com/stash-e2e" }).click();
  const mine = page.getByRole("dialog");
  await mine.getByRole("button", { name: "edit title" }).click();
  await mine.getByRole("textbox", { name: "title" }).fill("my renamed link");
  await mine.getByRole("button", { name: "save title" }).click();
  await expect(mine.getByRole("heading", { name: "my renamed link" })).toBeVisible();
  await mine.getByRole("button", { name: "done" }).click();
  await expect(row(page, "my renamed link")).toBeVisible();

  await page.reload();
  await expect(row(page, "my renamed link")).toBeVisible();
  await expect(rows(page)).toHaveCount(2);

  await page.getByRole("button", { name: `details for ${seedTitle}` }).click();
  await page.getByRole("button", { name: "delete link" }).click();
  const confirm = page.getByRole("dialog", { name: "delete this link?" });
  await expect(confirm).toBeVisible();
  await screen(page, info, "06-confirm-delete");
  await confirm.getByRole("button", { name: "delete", exact: true }).click();
  await expect(row(page, seedTitle)).toHaveCount(0);
  await page.reload();
  await expect(row(page, "my renamed link")).toBeVisible();
  await expect(rows(page)).toHaveCount(1);
  await screen(page, info, "07-after-delete-and-reload");
});

test("pasting anywhere saves the link on the clipboard", async ({ page }, info) => {
  await page.goto("/");
  await expect(row(page, seedTitle)).toBeVisible();
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData("text/plain", "read later: https://example.org/pasted-in-a-test");
    document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
  });
  await expect(rows(page).first().getByRole("link")).toHaveAttribute("href", "https://example.org/pasted-in-a-test");
  await screen(page, info, "08-pasted");
});

test("a shared link waits in the add field for one tap", async ({ page }) => {
  await page.goto("/?title=A%20story&text=look%20https%3A%2F%2Fexample.net%2Fshared%3Futm_source%3Dshare");
  await expect(field(page)).toHaveValue("https://example.net/shared?utm_source=share");
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.getByRole("button", { name: "save", exact: true })).toBeFocused();
});

test("two signed-in browsers share one library", async ({ browser }, info) => {
  const laptop = await browser.newContext();
  const { defaultBrowserType: _webkit, ...iPhone } = devices["iPhone 13"];
  void _webkit;
  const phone = await browser.newContext(iPhone);
  const first = await laptop.newPage();
  // A guest link saved before signing in comes along into the account.
  await first.goto("/");
  await expect(row(first, seedTitle)).toBeVisible();
  await add(first, "https://example.com/from-the-guest-library");
  await expect(rows(first)).toHaveCount(2);

  await signedIn(laptop, "allen");
  await first.reload();
  await expect(first.getByRole("button", { name: "synced" })).toBeVisible({ timeout: 15_000 });
  await expect(row(first, "example.com/from-the-guest-library")).toBeVisible();
  await expect(row(first, seedTitle)).toHaveCount(1);
  await first.getByRole("button", { name: "synced" }).click();
  await expect(first.getByText("allen@example.com")).toBeVisible();
  await screen(first, info, "09-signed-in-menu");
  await first.keyboard.press("Escape");

  await signedIn(phone, "allen");
  const second = await phone.newPage();
  await second.goto("/");
  await expect(second.getByRole("button", { name: "synced" })).toBeVisible({ timeout: 15_000 });
  await expect(row(second, "example.com/from-the-guest-library")).toBeVisible();
  await expect(row(second, seedTitle)).toHaveCount(1);
  await expect(rows(second)).toHaveCount(2);

  // The phone saves the same page again and renames it; the laptop deletes the article.
  await add(second, "https://www.example.com/from-the-guest-library/");
  await expect(notice(second, "already saved. moved to the top.")).toBeVisible();
  await second.getByRole("button", { name: "details for example.com/from-the-guest-library" }).click();
  await second.getByRole("button", { name: "edit title" }).click();
  await second.getByRole("textbox", { name: "title" }).fill("named on the phone");
  await second.getByRole("button", { name: "save title" }).click();
  await second.getByRole("button", { name: "done" }).click();
  await screen(second, info, "10-phone");

  await first.getByRole("button", { name: `details for ${seedTitle}` }).click();
  await first.getByRole("button", { name: "delete link" }).click();
  await first.getByRole("dialog", { name: "delete this link?" }).getByRole("button", { name: "delete", exact: true }).click();

  await expect.poll(async () => (await pool.query("select count(*)::int as n from stash_items where user_id = 'allen' and record->>'customTitle' = 'named on the phone'")).rows[0].n, { timeout: 15_000 }).toBe(1);
  await expect.poll(async () => (await pool.query("select count(*)::int as n from stash_items where user_id = 'allen' and dedupe_key is not null")).rows[0].n, { timeout: 15_000 }).toBe(1);

  await first.reload();
  await expect(row(first, "named on the phone")).toBeVisible({ timeout: 15_000 });
  await expect(rows(first)).toHaveCount(1);
  await second.reload();
  await expect(row(second, seedTitle)).toHaveCount(0, { timeout: 15_000 });
  await expect(rows(second)).toHaveCount(1);

  // Signing out returns to this browser's own guest links.
  await first.getByRole("button", { name: "synced" }).click();
  await first.getByRole("button", { name: "sign out" }).click();
  await expect(first.getByRole("button", { name: "sign in" })).toBeVisible();
  await expect(row(first, "example.com/from-the-guest-library")).toBeVisible();
  await laptop.close();
  await phone.close();
});

test("dark theme on a narrow screen", async ({ browser }, info) => {
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/");
  await expect(row(page, seedTitle)).toBeVisible();
  await add(page, "https://example.com/a-rather-long-path/that-keeps-going/and-going/until-it-has-to-wrap?id=12345");
  await expect(rows(page)).toHaveCount(2);
  await screen(page, info, "11-dark-narrow");
  await page.getByRole("button", { name: `details for ${seedTitle}` }).click();
  await screen(page, info, "12-dark-details");
  await page.getByRole("button", { name: "delete link" }).click();
  await screen(page, info, "13-dark-confirm");
  await context.close();
});
