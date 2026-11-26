import { createHash, randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { scriptDb } from "./script-db";

// Local HTTP integration checks. Only random test identities and their own
// records are removed; real credentials and response bodies are never logged.
const base = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
const runId = randomUUID();
const marker = `PUBLICATION_METADATA_TEST_${runId}`;
const admin = { id: randomUUID(), email: `metadata-admin-${runId}@example.invalid`, name: "Metadata integration test", role: "admin" };
const category = { id: randomUUID(), name: `METADATA ${runId}`, slug: `metadata-test-${runId}` };
const password = randomBytes(32).toString("base64url");
const nameMarker = `METADATA_SOURCE_${runId.slice(0, 8)}`;
const sourceName = `${nameMarker}<script>globalThis.__metadata_xss=true</script>`;
const sourceUrl = `https://source.example.invalid/report/${runId}?a=1&b=2`;
const videoUrl = `https://video.example.invalid/watch/${runId}`;
const metadata = { sourceType: "OFFICIAL", sourceName, sourceUrl, videoUrl };
let passed = 0;
let activeTest = "initialization";
let cookie = "";

class TestFailure extends Error {}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}
async function test(name: string, operation: () => Promise<void>) {
  activeTest = name;
  await operation();
  console.log(`PASS ${++passed}: ${name}`);
}
type Options = { json?: unknown; authenticated?: boolean; origin?: string | null };
async function expect(method: string, route: string, status: number, options: Options = {}) {
  const headers = new Headers();
  if (options.authenticated !== false && cookie) headers.set("Cookie", cookie);
  if (method !== "GET" && options.origin !== null) headers.set("Origin", options.origin ?? base.origin);
  if (options.json !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(new URL(route, base), { method, headers, body: options.json === undefined ? undefined : JSON.stringify(options.json), redirect: "manual", signal: AbortSignal.timeout(60_000) });
  assert(response.status === status, `${method} ${route.split("?")[0]}: expected ${status}, received ${response.status}`);
  return response;
}
async function statusOnly(method: string, route: string, status: number, options: Options = {}) {
  await (await expect(method, route, status, options)).arrayBuffer();
}
async function json<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch { throw new TestFailure("Expected a valid JSON response."); }
}
type Post = { id: string; slug: string; version: number; title: string; content: string; status: string; sourceType: string; sourceName: string | null; sourceUrl: string | null; videoUrl: string | null };
function body(label: string) {
  return { title: `Демонстрация метаданных ${label} ${runId.slice(0, 8)}`, content: `${marker}\nДемонстрационная публикация автоматической проверки метаданных.`, categoryId: category.id, imageIds: [], status: "DRAFT" };
}
async function getPost(id: string) {
  return (await json<{ post: Post }>(await expect("GET", `/api/admin/posts/${id}`, 200))).post;
}
async function patch(post: Post, values: Record<string, unknown>) {
  return (await json<{ post: Post }>(await expect("PATCH", `/api/admin/posts/${post.id}`, 200, { json: { version: post.version, ...values } }))).post;
}
function sameMetadata(post: Post) {
  assert(post.sourceType === metadata.sourceType && post.sourceName === sourceName && post.sourceUrl === sourceUrl && post.videoUrl === videoUrl, "Metadata did not round-trip unchanged.");
}
function escapedAttribute(value: string) { return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function assertSafeExternalAnchor(html: string, url: string) {
  const tag = html.match(/<a\b[^>]*>/g)?.find((anchor) => anchor.includes(`href="${escapedAttribute(url)}"`));
  assert(tag, "The approved external URL is not rendered as a normal link.");
  if (/target="_blank"/.test(tag)) {
    const rel = /rel="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? [];
    assert(rel.includes("noopener") && rel.includes("noreferrer"), "A new-tab external link must prevent opener/referrer access.");
  }
}

async function main() {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) && base.pathname === "/" && !base.username && !base.password, "Tests require a local APP_URL origin without credentials.");
  await test("temporary administrator signs in with protected session cookies", async () => {
    const hash = await hashPassword(password);
    await scriptDb.user.create({ data: { ...admin, accounts: { create: { id: randomUUID(), accountId: admin.id, providerId: "credential", password: hash } } } });
    await scriptDb.category.create({ data: category });
    const response = await expect("POST", "/api/auth/sign-in/email", 200, { json: { email: admin.email, password } });
    const header = response.headers.getSetCookie().find((value) => /^(?:__Secure-)?my-kineshma\.session_token=/.test(value));
    assert(header && /;\s*HttpOnly(?:;|$)/i.test(header) && /;\s*SameSite=Lax(?:;|$)/i.test(header), "The test administrator did not receive a protected session cookie.");
    cookie = header.split(";")[0];
    await response.arrayBuffer();
  });

  let legacy: Post;
  let post: Post;
  await test("older publication payloads retain COMMUNITY and empty metadata defaults", async () => {
    legacy = (await json<{ post: Post }>(await expect("POST", "/api/admin/posts", 201, { json: body("старый формат") }))).post;
    assert(legacy.sourceType === "COMMUNITY" && legacy.sourceName === null && legacy.sourceUrl === null && legacy.videoUrl === null, "Legacy payload metadata defaults changed.");
    const saved = await scriptDb.post.findUnique({ where: { id: legacy.id } });
    assert(saved?.sourceType === "COMMUNITY" && saved.sourceName === null && saved.sourceUrl === null && saved.videoUrl === null, "Legacy defaults were not persisted in PostgreSQL.");
  });
  await test("OFFICIAL source, trimmed name, HTTPS source and video URLs round-trip", async () => {
    post = (await json<{ post: Post }>(await expect("POST", "/api/admin/posts", 201, { json: { ...body("официальный источник"), ...metadata, sourceName: `  ${sourceName}  `, sourceUrl: `  ${sourceUrl}  `, videoUrl: `  ${videoUrl}  ` } }))).post;
    sameMetadata(post);
    sameMetadata(await getPost(post.id));
    const persisted = await scriptDb.post.findUnique({ where: { id: post.id } });
    assert(persisted?.sourceType === "OFFICIAL" && persisted.sourceName === sourceName && persisted.sourceUrl === sourceUrl && persisted.videoUrl === videoUrl, "Explicit metadata was not persisted in PostgreSQL.");
  });
  await test("draft source and video information remain private", async () => {
    await statusOnly("GET", `/news/${post.slug}`, 404, { authenticated: false });
    const html = await (await expect("GET", "/", 200, { authenticated: false })).text();
    assert(!html.includes(marker) && !html.includes(nameMarker) && !html.includes(`source.example.invalid/report/${runId}`) && !html.includes(videoUrl), "A draft leaked publication metadata into the public home page.");
  });
  await test("metadata mutations still require administrator authorization and matching Origin", async () => {
    const change = { version: post.version, ...metadata };
    await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 401, { json: change, authenticated: false });
    await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 403, { json: change, origin: null });
    await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 403, { json: change, origin: "https://untrusted.example.invalid" });
    assert((await getPost(post.id)).version === post.version, "A rejected metadata mutation changed the record.");
  });
  await test("omitting metadata from a later PATCH preserves all existing values", async () => {
    const before = post.version;
    post = await patch(post, { title: `${post.title} — уточнено` });
    assert(post.version === before + 1, "A normal editorial save did not advance the version.");
    sameMetadata(post);
  });
  await test("unsafe URL schemes, credentials, control characters and spaces cannot change saved metadata", async () => {
    const unsafe = [
      "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>alert(1)</script>", "file:///private.txt", "ftp://example.invalid/file", "http://example.invalid/", "//example.invalid/", "blob:https://example.invalid/object", "mailto:person@example.invalid", "https://user:password@example.invalid/", "https://user@example.invalid/", "https://user%40mail:password@example.invalid/", "https://example.invalid/a b", "https://exa\tmple.invalid/", "https://example.invalid/a\r\nb", "https://example.invalid/a\u0000b", "https://example.invalid/a\u007fb", "https://", "https:\\example.invalid/path",
    ];
    const version = post.version;
    for (const field of ["sourceUrl", "videoUrl"] as const) for (const value of unsafe) {
      await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 400, { json: { version, [field]: value } });
    }
    await statusOnly("POST", "/api/admin/posts", 400, { json: { ...body("опасная ссылка"), sourceUrl: "javascript:alert(1)" } });
    await statusOnly("POST", "/api/admin/posts", 400, { json: { ...body("опасное видео"), videoUrl: "data:text/html,unsafe" } });
    const saved = await getPost(post.id);
    sameMetadata(saved);
    assert(saved.version === version && await scriptDb.post.count({ where: { authorId: admin.id } }) === 2, "Rejected URL input modified or created a publication.");
  });
  await test("source enum and metadata length limits reject invalid data without saving", async () => {
    const tooLongUrl = `https://example.invalid/${"x".repeat(2048)}`;
    for (const invalid of [{ sourceType: "ADMIN" }, { sourceName: "x".repeat(101) }, { sourceUrl: tooLongUrl }, { videoUrl: tooLongUrl }]) {
      await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 400, { json: { version: post.version, ...invalid } });
    }
    const saved = await getPost(post.id);
    sameMetadata(saved);
    assert(saved.version === post.version, "Invalid metadata advanced the publication version.");
  });
  await test("explicit null and empty strings clear optional metadata", async () => {
    post = await patch(post, { sourceName: null, sourceUrl: null, videoUrl: null });
    assert(post.sourceType === "OFFICIAL" && post.sourceName === null && post.sourceUrl === null && post.videoUrl === null, "Explicit null did not clear optional metadata.");
    post = await patch(post, metadata);
    sameMetadata(post);
    post = await patch(post, { sourceName: "   ", sourceUrl: "", videoUrl: "   " });
    assert(post.sourceType === "OFFICIAL" && post.sourceName === null && post.sourceUrl === null && post.videoUrl === null, "Blank optional metadata was not normalized to null.");
  });
  await test("published source names are escaped and validated external URLs are safe links", async () => {
    post = await patch(post, { ...metadata, status: "PUBLISHED" });
    const html = await (await expect("GET", `/news/${post.slug}`, 200, { authenticated: false })).text();
    assert(html.includes(nameMarker) && html.includes("&lt;script&gt;globalThis.__metadata_xss=true&lt;/script&gt;") && !html.includes("<script>globalThis.__metadata_xss"), "Source display name was not safely escaped in the article.");
    assertSafeExternalAnchor(html, sourceUrl);
    assertSafeExternalAnchor(html, videoUrl);
    assert(!html.includes(`src="${escapedAttribute(videoUrl)}"`), "The external video URL was embedded or loaded automatically.");
    const home = await (await expect("GET", "/", 200, { authenticated: false })).text();
    assert(home.includes(nameMarker) && !home.includes("<script>globalThis.__metadata_xss"), "Published source display is absent or unsafe on the home page.");
  });
  await test("unpublishing removes source and video information from public pages", async () => {
    post = await patch(post, { status: "UNPUBLISHED" });
    await statusOnly("GET", `/news/${post.slug}`, 404, { authenticated: false });
    const home = await (await expect("GET", "/", 200, { authenticated: false })).text();
    assert(!home.includes(marker) && !home.includes(nameMarker) && !home.includes(`source.example.invalid/report/${runId}`) && !home.includes(videoUrl), "Unpublished metadata remains public.");
    sameMetadata(await getPost(post.id));
  });
  await test("metadata-bearing and legacy publications can be deleted normally", async () => {
    for (const record of [post, legacy]) await statusOnly("DELETE", `/api/admin/posts/${record.id}`, 200, { json: { version: record.version } });
    assert(await scriptDb.post.count({ where: { authorId: admin.id } }) === 0, "Test publications remain after normal deletion.");
  });
}

async function cleanup() {
  const owned = await scriptDb.user.findFirst({ where: { id: admin.id, email: admin.email }, select: { id: true } });
  if (owned) await scriptDb.post.deleteMany({ where: { authorId: owned.id } });
  await scriptDb.category.deleteMany({ where: { id: category.id, name: category.name, posts: { none: {} }, submissions: { none: {} } } });
  await scriptDb.actionLimit.deleteMany({ where: { key: `login:${createHash("sha256").update(admin.email).digest("hex")}` } });
  await scriptDb.user.deleteMany({ where: { id: admin.id, email: admin.email } });
  assert(await scriptDb.post.count({ where: { authorId: admin.id } }) === 0, "Test publications remain after cleanup.");
  assert(await scriptDb.category.count({ where: { id: category.id, name: category.name } }) === 0, "Test category remains after cleanup.");
  assert(await scriptDb.user.count({ where: { id: admin.id, email: admin.email } }) === 0, "Test administrator remains after cleanup.");
  console.log("PASS cleanup: only this run's publications, category, administrator and individual login counter removed.");
}

try {
  await main();
  console.log(`All ${passed} publication metadata integration/security checks passed.`);
} catch (error) {
  console.error(`FAIL ${activeTest}: ${error instanceof TestFailure ? error.message : "Unexpected test/database error; sensitive details suppressed."}`);
  process.exitCode = 1;
} finally {
  try { await cleanup(); }
  catch (error) {
    console.error(error instanceof TestFailure ? `FAIL cleanup: ${error.message}` : "FAIL cleanup: this run's fixture cleanup did not complete; sensitive details suppressed.");
    process.exitCode = 1;
  }
  await scriptDb.$disconnect();
}
