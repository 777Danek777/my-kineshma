import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import { scriptDb } from "./script-db";

// Local HTTP checks only. All fixtures have random IDs; no real credentials,
// cookies, tokens, database URLs, or unfiltered response bodies are printed.
const base = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
const runId = randomUUID();
const marker = `SOCIAL_COMMENT_TEST_${runId}`;
const password = randomBytes(32).toString("base64url");
const admin = { id: randomUUID(), email: `social-admin-${runId}@example.invalid`, role: "admin", name: "Social test administrator" };
const member = { id: randomUUID(), email: `social-user-${runId}@example.invalid`, role: "user", name: "Social test ordinary user" };
const identities = [admin, member];
const category = { id: randomUUID(), name: `SOCIAL ${runId}`, slug: `social-test-${runId}` };
const posts = Object.fromEntries(["main", "other", "draft", "unpublished", "cascade", "rate", "names"].map((label) => [label, { id: randomUUID(), slug: `social-${label}-${runId}`, title: `Демонстрация общения ${label} ${runId.slice(0, 8)}`, version: 1 }])) as Record<"main" | "other" | "draft" | "unpublished" | "cascade" | "rate" | "names", { id: string; slug: string; title: string; version: number }>;
const postIds = Object.values(posts).map(({ id }) => id);
const receiptKeys = new Set<string>();
const visitorHashes = new Set<string>();
let passed = 0;
let activeTest = "initialization";
let adminCookie = "";
let memberCookie = "";
type ModerationSettings = { commentsModerationEnabled: boolean; postsModerationEnabled: boolean; defaultCategoryId: string | null; version: number };
let originalSettings: ModerationSettings | null = null;
let lastSettingsVersion: number | null = null;

class TestFailure extends Error {}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new TestFailure(message); }
async function test(name: string, operation: () => Promise<void>) {
  activeTest = name;
  await operation();
  console.log(`PASS ${++passed}: ${name}`);
}
type Options = { cookie?: string; json?: unknown; origin?: string | null; headers?: Record<string, string>; body?: string };
async function request(method: string, route: string, options: Options = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (method !== "GET" && options.origin !== null) headers.set("Origin", options.origin ?? base.origin);
  if (options.json !== undefined) headers.set("Content-Type", "application/json");
  return fetch(new URL(route, base), { method, headers, body: options.json !== undefined ? JSON.stringify(options.json) : options.body, redirect: "manual", signal: AbortSignal.timeout(60_000) });
}
async function expect(method: string, route: string, status: number, options: Options = {}) {
  const response = await request(method, route, options);
  assert(response.status === status, `${method} ${route.split("?")[0]}: expected ${status}, received ${response.status}`);
  return response;
}
async function statusOnly(method: string, route: string, status: number, options: Options = {}) { await (await expect(method, route, status, options)).arrayBuffer(); }
async function json<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch { throw new TestFailure("Expected a JSON response."); }
}
function privateResponse(response: Response) {
  assert(response.headers.get("cache-control")?.includes("no-store"), "Social responses must not be cached.");
  assert(response.headers.get("vary")?.toLowerCase().split(/\s*,\s*/).includes("cookie"), "Visitor-dependent social responses must vary by Cookie.");
  assert(response.headers.get("content-type")?.startsWith("application/json") && response.headers.get("x-content-type-options") === "nosniff", "Social JSON must have a safe content type and nosniff.");
}
function cookieFrom(response: Response, name: string) {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`) || value.startsWith(`__Secure-${name}=`));
  if (!header) return null;
  assert(/;\s*HttpOnly(?:;|$)/i.test(header) && /;\s*SameSite=(Lax|Strict)(?:;|$)/i.test(header), "A protected cookie is missing HttpOnly or SameSite.");
  if (base.protocol === "https:") assert(/;\s*Secure(?:;|$)/i.test(header), "HTTPS cookies must be Secure.");
  return { pair: header.split(";")[0], header };
}
function signedPayload(value: string): Record<string, unknown> {
  try {
    const result: unknown = JSON.parse(Buffer.from(value.split(".")[0], "base64url").toString("utf8"));
    assert(result && typeof result === "object" && !Array.isArray(result), "Invalid test token payload.");
    return result as Record<string, unknown>;
  } catch { throw new TestFailure("Could not identify this test's own visitor or receipt."); }
}
function tamper(value: string) { return `${value.slice(0, -1)}${value.endsWith("a") ? "b" : "a"}`; }
function legacyCommentHash(value: object) {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  assert(secret && secret.length >= 32, "The local test signing key is unavailable.");
  // Freeze the pre-NFKC wire format rather than importing the current server helper.
  // The key and resulting hash are used only for this run's receipt and never logged.
  return createHmac("sha256", secret).update(`social-comment-payload:${JSON.stringify(value)}`).digest("base64url");
}
type Visitor = { cookie: string; csrfToken: string; hash: string; rawId: string };
async function session(previous?: Visitor): Promise<Visitor> {
  const response = await expect("POST", "/api/social/session", 200, { json: {}, cookie: previous?.cookie });
  privateResponse(response);
  const received = cookieFrom(response, "mk_social_visitor");
  const cookie = received?.pair || previous?.cookie;
  assert(cookie, "Social session did not provide a visitor cookie.");
  if (received) assert(/;\s*Max-Age=15552000(?:;|$)/i.test(received.header) && /;\s*Path=\/(?:;|$)/i.test(received.header), "Social cookie must last 180 days and cover this site.");
  const body = await json<{ csrfToken: string }>(response);
  assert(typeof body.csrfToken === "string", "Social session did not provide a CSRF token.");
  const payload = signedPayload(body.csrfToken);
  const rawCookie = signedPayload(cookie.slice(cookie.indexOf("=") + 1));
  assert(typeof payload.visitor === "string" && /^[a-f0-9]{64}$/.test(payload.visitor), "Visitor identity must be represented by an opaque hash.");
  assert(typeof rawCookie.id === "string" && /^[a-f0-9-]{36}$/.test(rawCookie.id), "Visitor cookie must contain its own random identity.");
  visitorHashes.add(payload.visitor);
  return { cookie, csrfToken: body.csrfToken, hash: payload.visitor, rawId: rawCookie.id };
}
type Stats = { likeCount: number; commentCount: number; liked: boolean };
async function stats(slug: string, visitor?: Visitor) {
  const response = await expect("GET", `/api/posts/${slug}/social`, 200, { cookie: visitor?.cookie });
  privateResponse(response);
  const result = await json<Stats>(response);
  assert(Object.keys(result).every((key) => ["likeCount", "commentCount", "liked"].includes(key)), "Public social stats expose internal identity data.");
  return result;
}
async function like(slug: string, visitor: Visitor, liked: boolean, status = 200, headers?: Record<string, string>) {
  return expect("PUT", `/api/posts/${slug}/like`, status, { cookie: visitor.cookie, json: { liked, csrfToken: visitor.csrfToken }, headers });
}
type Ticket = { token: string; nonce: string; readyAt: number; visitor: Visitor; slug: string; moderationEnabled: boolean };
async function issue(slug: string, visitor: Visitor): Promise<Ticket> {
  const response = await expect("GET", `/api/posts/${slug}/comments/form`, 200, { cookie: visitor.cookie });
  privateResponse(response);
  const result = await json<{ token: string; minimumWaitMs: number; moderationEnabled: boolean }>(response);
  const token = signedPayload(result.token);
  assert(result.minimumWaitMs === 3000 && typeof token.nonce === "string" && /^[a-f0-9-]{36}$/.test(token.nonce), "Comment form delay or nonce is incorrect.");
  assert(token.visitor === visitor.hash && token.slug === slug, "Comment challenge is not bound to its visitor and publication.");
  assert(typeof result.moderationEnabled === "boolean", "Comment form does not expose its actual moderation mode.");
  receiptKeys.add(token.nonce);
  return { token: result.token, nonce: token.nonce, readyAt: Date.now() + result.minimumWaitMs + 100, visitor, slug, moderationEnabled: result.moderationEnabled };
}
async function mature(ticket: Ticket) { if (ticket.readyAt > Date.now()) await delay(ticket.readyAt - Date.now()); }
const commentText = `${marker}\n<script>globalThis.__social_xss=true</script><img src=x onerror="alert(1)">`;
const displayName = 'Тест <img src=x onerror="alert(1)">';
function commentBody(ticket: Ticket, changes: Record<string, unknown> = {}) { return { displayName, content: commentText, website: "", token: ticket.token, csrfToken: ticket.visitor.csrfToken, ...changes }; }
async function comment(ticket: Ticket, status = 201, changes: Record<string, unknown> = {}, headers?: Record<string, string>, acceptedStatus = "PENDING") {
  await mature(ticket);
  const response = await expect("POST", `/api/posts/${ticket.slug}/comments`, status, { cookie: ticket.visitor.cookie, json: commentBody(ticket, changes), headers });
  if (status === 200 || status === 201) {
    privateResponse(response);
    const result = await json<{ success: boolean; status: string }>(response);
    assert(result.success && result.status === acceptedStatus, `Comment acknowledgement must preserve its accepted status ${acceptedStatus}.`);
  } else await response.arrayBuffer();
}
async function storedComment(ticket: Ticket) {
  const record = await scriptDb.comment.findUnique({ where: { receiptKey: ticket.nonce } });
  assert(record && postIds.includes(record.postId), "The test comment was not persisted for its own post/receipt.");
  return record;
}
type PublicComment = { id: string; displayName: string; content: string; createdAt: string; parentId: string | null; likeCount: number; liked: boolean; replyCount: number; replies: PublicComment[] };
type CommentList = { items: PublicComment[]; page: number; pageSize: number; total: number; rootTotal: number; totalPages: number; preview: boolean };
async function comments(slug: string, page = 1, options: { visitor?: Visitor; preview?: boolean; parentId?: string } = {}) {
  const query = new URLSearchParams({ page: String(page), ...(options.preview ? { preview: "1" } : {}), ...(options.parentId ? { parentId: options.parentId } : {}) });
  const response = await expect("GET", `/api/posts/${slug}/comments?${query}`, 200, { cookie: options.visitor?.cookie });
  privateResponse(response);
  const result = await json<CommentList>(response);
  const safe = (item: PublicComment): boolean => Object.keys(item).every(key => ["id", "displayName", "content", "createdAt", "parentId", "likeCount", "liked", "replyCount", "replies"].includes(key)) && item.replies.every(safe);
  assert(result.items.every(safe), "Public comments expose moderation/receipt/visitor information.");
  return result;
}
async function moderate(id: string, version: number, status: "PENDING" | "APPROVED" | "REJECTED", expected = 200) {
  return expect("PATCH", `/api/admin/comments/${id}`, expected, { cookie: adminCookie, json: { version, status } });
}
async function changeCommentMode(enabled: boolean) {
  assert(originalSettings && lastSettingsVersion !== null, "Settings were not snapshotted before mutation.");
  const result = await json<{ settings: ModerationSettings }>(await expect("PATCH", "/api/admin/settings", 200, {
    cookie: adminCookie,
    json: { version: lastSettingsVersion, commentsModerationEnabled: enabled, postsModerationEnabled: originalSettings.postsModerationEnabled, defaultCategoryId: originalSettings.defaultCategoryId },
  }));
  lastSettingsVersion = result.settings.version;
  assert(result.settings.commentsModerationEnabled === enabled && result.settings.postsModerationEnabled === originalSettings.postsModerationEnabled && result.settings.defaultCategoryId === originalSettings.defaultCategoryId, "Comment moderation changed unrelated post settings.");
}
async function commentLike(slug: string, id: string, visitor: Visitor, liked: boolean, status = 200) {
  return expect("PUT", `/api/posts/${slug}/comments/${id}/like`, status, { cookie: visitor.cookie, json: { liked, csrfToken: visitor.csrfToken } });
}
function decodeHtml(value: string) { return value.replaceAll("&quot;", '"').replaceAll("&#x27;", "'").replaceAll("&#39;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&"); }
function attribute(tag: string, name: string) { const result = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag); return result ? decodeHtml(result[1]) : null; }
function metadataValue(html: string, property: string) {
  const tag = html.match(/<meta\b[^>]*>/g)?.find((item) => attribute(item, "property") === property || attribute(item, "name") === property);
  return tag ? attribute(tag, "content") : null;
}

async function main() {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) && base.pathname === "/" && !base.username && !base.password, "Social tests require a local APP_URL origin.");
  await test("temporary administrators, ordinary user and clearly labelled posts are isolated", async () => {
    const hash = await hashPassword(password);
    for (const identity of identities) await scriptDb.user.create({ data: { ...identity, accounts: { create: { id: randomUUID(), accountId: identity.id, providerId: "credential", password: hash } } } });
    await scriptDb.category.create({ data: category });
    for (const post of Object.values(posts)) await scriptDb.post.create({ data: { ...post, content: `Демонстрационный материал проверки социальных функций ${runId}.`, excerpt: `Демонстрация ${runId}`, status: "PUBLISHED", publishedAt: new Date(), authorId: admin.id, categoryId: category.id } });
    for (const identity of identities) {
      const response = await expect("POST", "/api/auth/sign-in/email", 200, { json: { email: identity.email, password } });
      const received = cookieFrom(response, "my-kineshma.session_token");
      assert(received, "Test identity did not receive an authenticated session.");
      if (identity.role === "admin") adminCookie = received.pair; else memberCookie = received.pair;
      await response.arrayBuffer();
    }
  });
  await test("comment moderation rejects guests, ordinary users and forged admin cookies", async () => {
    const id = randomUUID();
    for (const cookie of [undefined, memberCookie, `my-kineshma.session_token=${randomBytes(32).toString("hex")}`]) {
      await statusOnly("GET", "/api/admin/comments?status=PENDING&page=1", 401, { cookie });
      await statusOnly("PATCH", `/api/admin/comments/${id}`, 401, { cookie, json: { status: "APPROVED", version: 1 } });
      await statusOnly("PUT", `/api/admin/comments/${id}`, 401, { cookie, json: { version: 1, displayName: "Изменение", content: "Проверочный комментарий" } });
      await statusOnly("DELETE", `/api/admin/comments/${id}`, 401, { cookie, json: { version: 1 } });
    }
    const page = await request("GET", "/admin/comments");
    assert([303, 307, 308].includes(page.status) && new URL(page.headers.get("location") || "/", base).pathname === "/admin/login", "Guest moderation page must redirect to login.");
    await page.arrayBuffer();
  });
  await test("moderation settings are saved for restoration and comment mode changes independently", async () => {
    const response = await json<{ settings: ModerationSettings }>(await expect("GET", "/api/admin/settings", 200, { cookie: adminCookie }));
    originalSettings = response.settings;
    lastSettingsVersion = response.settings.version;
    await changeCommentMode(true);
  });
  await test("fresh published posts report real zero counts without visitor registration", async () => {
    const result = await stats(posts.main.slug);
    assert(result.likeCount === 0 && result.commentCount === 0 && result.liked === false, "A fresh publication has fabricated activity.");
    assert((await comments(posts.main.slug)).total === 0, "A fresh publication unexpectedly contains comments.");
  });
  let first: Visitor;
  let second: Visitor;
  let security: Visitor;
  await test("social sessions use signed 180-day protected cookies and same-origin CSRF tokens", async () => {
    await statusOnly("POST", "/api/social/session", 403, { json: {}, origin: null });
    await statusOnly("POST", "/api/social/session", 403, { json: {}, origin: "https://untrusted.example.invalid" });
    [first, second, security] = await Promise.all([session(), session(), session()]);
    assert(new Set([first.hash, second.hash, security.hash]).size === 3, "Independent visitors received the same identity.");
  });
  await test("like requests reject missing/tampered CSRF, foreign visitors and forged cookies", async () => {
    const route = `/api/posts/${posts.main.slug}/like`;
    await statusOnly("PUT", route, 403, { json: { liked: true, csrfToken: security.csrfToken } });
    await statusOnly("PUT", route, 400, { cookie: security.cookie, json: { liked: true } });
    await statusOnly("PUT", route, 403, { cookie: security.cookie, json: { liked: true, csrfToken: tamper(security.csrfToken) } });
    await statusOnly("PUT", route, 403, { cookie: security.cookie, json: { liked: true, csrfToken: first.csrfToken } });
    await statusOnly("PUT", route, 403, { cookie: tamper(security.cookie), json: { liked: true, csrfToken: security.csrfToken } });
    await statusOnly("PUT", route, 403, { cookie: `${security.cookie}; ${security.cookie}`, json: { liked: true, csrfToken: security.csrfToken } });
    for (const origin of [null, "https://untrusted.example.invalid"]) await statusOnly("PUT", route, 403, { cookie: security.cookie, json: { liked: true, csrfToken: security.csrfToken }, origin });
    await statusOnly("PUT", route, 403, { cookie: security.cookie, json: { liked: true, csrfToken: security.csrfToken }, headers: { "Sec-Fetch-Site": "cross-site" } });
    assert((await stats(posts.main.slug)).likeCount === 0, "A rejected request changed the like count.");
  });
  await test("client counters and identity fields cannot control a like", async () => {
    const route = `/api/posts/${posts.main.slug}/like`;
    for (const extra of [{ likeCount: 999 }, { anonymousVisitorIdHash: first.hash }, { liked: "true" }]) await statusOnly("PUT", route, 400, { cookie: security.cookie, json: { liked: true, csrfToken: security.csrfToken, ...extra } });
    assert((await stats(posts.main.slug)).likeCount === 0, "Untrusted client counters changed stored activity.");
  });
  await test("concurrent repeated desired-state likes create exactly one hashed visitor row", async () => {
    const results = await Promise.all([like(posts.main.slug, first, true), like(posts.main.slug, first, true), like(posts.main.slug, first, true)]);
    for (const result of results) await result.arrayBuffer();
    const own = await stats(posts.main.slug, first);
    const outsider = await stats(posts.main.slug, second);
    assert(own.likeCount === 1 && own.liked && outsider.likeCount === 1 && !outsider.liked, "Concurrent repeated likes changed identity/count semantics.");
    const rows = await scriptDb.like.findMany({ where: { postId: posts.main.id } });
    assert(rows.length === 1 && rows[0].anonymousVisitorIdHash === first.hash && rows[0].anonymousVisitorIdHash !== first.rawId, "Likes must store exactly one hashed visitor identity, never the raw cookie ID.");
  });
  await test("independent visitors, unlike retries and renewed sessions preserve accurate state", async () => {
    await (await like(posts.main.slug, second, true)).arrayBuffer();
    assert((await stats(posts.main.slug, first)).likeCount === 2, "A second visitor was not counted independently.");
    const removals = await Promise.all([like(posts.main.slug, first, false), like(posts.main.slug, first, false)]);
    for (const result of removals) await result.arrayBuffer();
    assert((await stats(posts.main.slug, first)).likeCount === 1 && !(await stats(posts.main.slug, first)).liked && (await stats(posts.main.slug, second)).liked, "Repeated unlike affected another visitor.");
    await (await like(posts.main.slug, first, true)).arrayBuffer();
    const renewed = await session(first);
    assert(renewed.hash === first.hash && renewed.rawId === first.rawId && (await stats(posts.main.slug, renewed)).liked, "Renewing a session changed the visitor or forgot their like.");
    first = renewed;
    assert(!(await stats(posts.main.slug)).liked && (await stats(posts.main.slug)).likeCount === 2, "Anonymous aggregate read leaked another visitor's personal liked state.");
  });
  let mainTicket: Ticket;
  let duplicateTicket: Ticket;
  let cascadeTicket: Ticket;
  let draftTicket: Ticket;
  let hiddenTicket: Ticket;
  await test("comment challenges bind a random nonce to the visitor and publication", async () => {
    await statusOnly("GET", `/api/posts/${posts.main.slug}/comments/form`, 403);
    [mainTicket, duplicateTicket, cascadeTicket, draftTicket, hiddenTicket] = await Promise.all([issue(posts.main.slug, first), issue(posts.main.slug, first), issue(posts.cascade.slug, first), issue(posts.draft.slug, first), issue(posts.unpublished.slug, first)]);
    assert(new Set([mainTicket.nonce, duplicateTicket.nonce, cascadeTicket.nonce, draftTicket.nonce, hiddenTicket.nonce]).size === 5, "Comment forms reused a nonce.");
    await scriptDb.post.update({ where: { id: posts.draft.id }, data: { status: "DRAFT", publishedAt: null } });
    await scriptDb.post.update({ where: { id: posts.unpublished.id }, data: { status: "UNPUBLISHED" } });
  });
  await test("draft and unpublished posts expose neither social data nor writable actions", async () => {
    for (const ticket of [draftTicket, hiddenTicket]) {
      await mature(ticket);
      for (const suffix of ["social", "comments", "comments/form"]) await statusOnly("GET", `/api/posts/${ticket.slug}/${suffix}`, 404, { cookie: first.cookie });
      await (await like(ticket.slug, first, true, 404)).arrayBuffer();
      await comment(ticket, 404);
      await statusOnly("GET", `/news/${ticket.slug}`, 404);
    }
    assert(await scriptDb.like.count({ where: { postId: { in: [posts.draft.id, posts.unpublished.id] } } }) === 0, "Hidden posts acquired likes.");
  });
  await test("new comments remain PENDING and invisible to public lists and counters", async () => {
    await comment(mainTicket);
    const saved = await storedComment(mainTicket);
    assert(saved.status === "PENDING" && saved.version === 1 && saved.displayName === displayName && saved.content === commentText, "A submitted comment bypassed moderation or changed its text.");
    assert((await comments(posts.main.slug)).total === 0 && (await stats(posts.main.slug)).commentCount === 0, "A pending comment is publicly counted or listed.");
    const html = await (await expect("GET", `/news/${posts.main.slug}`, 200)).text();
    assert(!html.includes(marker), "Pending comment text leaked into rendered publication HTML.");
  });
  await test("comment retry is idempotent, changed nonce reuse conflicts, and concurrent retries create one row", async () => {
    await comment(mainTicket, 200);
    await comment(mainTicket, 409, { content: `${commentText} changed` });
    await mature(duplicateTicket);
    const body = commentBody(duplicateTicket, { displayName: "Демонстрационный повтор", content: `${marker} duplicate` });
    const results = await Promise.all([request("POST", `/api/posts/${posts.main.slug}/comments`, { cookie: first.cookie, json: body }), request("POST", `/api/posts/${posts.main.slug}/comments`, { cookie: first.cookie, json: body })]);
    assert(results.map(({ status }) => status).sort((a, b) => a - b).join(",") === "200,201", "Concurrent comment retries must produce one 201 and one idempotent 200.");
    for (const response of results) await response.arrayBuffer();
    assert(await scriptDb.comment.count({ where: { receiptKey: duplicateTicket.nonce } }) === 1 && await scriptDb.comment.count({ where: { receiptKey: mainTicket.nonce } }) === 1, "A receipt created duplicate comments.");
  });
  const anonymousPendingIds: string[] = [];
  await test("blank and missing comment names normalize to an anonymous signature without bypassing moderation", async () => {
    const visitor = await session();
    const tickets = await Promise.all([issue(posts.names.slug, visitor), issue(posts.names.slug, visitor)]);
    for (const [index, name] of ["   ", undefined].entries()) {
      const changes = { displayName: name, content: `${marker} anonymous pending ${index}` };
      await comment(tickets[index], 201, changes);
      const saved = await storedComment(tickets[index]);
      anonymousPendingIds.push(saved.id);
      assert(saved.displayName === "Житель Кинешмы" && saved.status === "PENDING", "An unnamed comment lost its signature or bypassed moderation.");
      await comment(tickets[index], 200, { ...changes, displayName: name === undefined ? "" : undefined });
      assert(await scriptDb.comment.count({ where: { receiptKey: tickets[index].nonce } }) === 1, "Equivalent blank/missing retries created duplicate comments.");
    }
    assert((await comments(posts.names.slug)).total === 0 && (await stats(posts.names.slug)).commentCount === 0, "An anonymous pending comment became public.");
  });
  await test("prohibited public nicknames return validation errors without comments, receipts or quota consumption", async () => {
    const visitor = await session();
    const ticket = await issue(posts.names.slug, visitor);
    const before = await scriptDb.comment.count({ where: { postId: posts.names.id } });
    await mature(ticket);
    for (const name of ["ХУЙ", "ДОЛБОЁБ", "х.у.й"]) {
      const response = await expect("POST", `/api/posts/${ticket.slug}/comments`, 400, { cookie: visitor.cookie, json: commentBody(ticket, { displayName: name }) });
      const body = await json<{ fieldErrors?: Record<string, unknown> }>(response);
      assert(typeof body.fieldErrors?.displayName === "string", "A prohibited nickname needs a displayName field error.");
    }
    assert(await scriptDb.comment.count({ where: { postId: posts.names.id } }) === before, "Rejected nicknames created comments.");
    assert(await scriptDb.commentReceipt.count({ where: { key: ticket.nonce } }) === 0, "A rejected nickname consumed the receipt.");
    assert(await scriptDb.actionLimit.count({ where: { key: `social:comments:accepted:${visitor.hash}` } }) === 0, "Rejected nicknames consumed the accepted-comment quota.");
  });
  await test("pre-normalization comment receipts accept exact legacy retries without recreating deleted comments", async () => {
    const visitor = await session();
    const ticket = await issue(posts.names.slug, visitor);
    const rawName = " Ａｎｎａ ";
    const content = `${marker} legacy nickname retry`;
    const payloadHash = legacyCommentHash({ visitor: visitor.hash, slug: ticket.slug, displayName: rawName.trim(), content });
    await scriptDb.commentReceipt.create({ data: { key: ticket.nonce, postId: posts.names.id, payloadHash, acceptedStatus: "PENDING" } });
    const before = await scriptDb.comment.count({ where: { postId: posts.names.id } });
    await comment(ticket, 200, { displayName: rawName, content });
    await comment(ticket, 409, { displayName: rawName, content: `${content} changed` });
    assert(await scriptDb.comment.count({ where: { receiptKey: ticket.nonce } }) === 0 && await scriptDb.comment.count({ where: { postId: posts.names.id } }) === before, "A legacy retry recreated a deleted comment.");
    const receipt = await scriptDb.commentReceipt.findUniqueOrThrow({ where: { key: ticket.nonce } });
    assert(receipt.payloadHash === payloadHash && receipt.acceptedStatus === "PENDING", "Legacy compatibility rewrote the original receipt.");
    assert(await scriptDb.actionLimit.count({ where: { key: `social:comments:accepted:${visitor.hash}` } }) === 0, "A legacy retry consumed a new-comment quota slot.");
  });
  await test("comment forms enforce minimum delay, field lengths, honeypot and strict payload shape", async () => {
    const early = await issue(posts.main.slug, security);
    await statusOnly("POST", `/api/posts/${early.slug}/comments`, 400, { cookie: security.cookie, json: commentBody(early) });
    await mature(early);
    for (const change of [{ displayName: "x" }, { displayName: "x".repeat(61) }, { displayName: "Line\nBreak" }, { content: "x" }, { content: "x".repeat(2001) }, { website: "https://spam.example.invalid" }, { status: "APPROVED" }]) await comment(early, 400, change);
    await statusOnly("POST", `/api/posts/${early.slug}/comments`, 413, { cookie: security.cookie, body: "x".repeat(16_385), headers: { "Content-Type": "application/json" } });
    await statusOnly("POST", `/api/posts/${early.slug}/comments`, 415, { cookie: security.cookie, body: "plain text", headers: { "Content-Type": "text/plain" } });
    assert(await scriptDb.commentReceipt.count({ where: { key: early.nonce } }) === 0, "Invalid comments created a receipt.");
  });
  await test("comments reject missing/tampered CSRF, wrong browser, wrong post and foreign Origin", async () => {
    const ticket = await issue(posts.main.slug, security);
    await mature(ticket);
    const route = `/api/posts/${ticket.slug}/comments`;
    const body = commentBody(ticket);
    await statusOnly("POST", route, 403, { json: body });
    const { csrfToken: omittedCsrf, ...withoutCsrf } = body;
    void omittedCsrf;
    await statusOnly("POST", route, 400, { cookie: security.cookie, json: withoutCsrf });
    await statusOnly("POST", route, 403, { cookie: security.cookie, json: { ...body, csrfToken: tamper(security.csrfToken) } });
    await statusOnly("POST", route, 403, { cookie: security.cookie, json: { ...body, csrfToken: first.csrfToken } });
    await statusOnly("POST", route, 403, { cookie: security.cookie, json: { ...body, token: tamper(ticket.token) } });
    await statusOnly("POST", route, 403, { cookie: second.cookie, json: { ...body, csrfToken: second.csrfToken } });
    await statusOnly("POST", `/api/posts/${posts.other.slug}/comments`, 403, { cookie: security.cookie, json: body });
    for (const origin of [null, "https://untrusted.example.invalid"]) await statusOnly("POST", route, 403, { cookie: security.cookie, json: body, origin });
    await statusOnly("POST", route, 403, { cookie: security.cookie, json: body, headers: { "Sec-Fetch-Site": "cross-site" } });
    assert(await scriptDb.commentReceipt.count({ where: { key: ticket.nonce } }) === 0, "Rejected comment authentication created a receipt.");
  });
  await test("moderation list provides pending text and its actual publication only to administrators", async () => {
    const saved = await storedComment(mainTicket);
    const list = await json<{ items: { id: string; content: string; version: number; post: { id: string; slug: string; status: string } }[]; pageSize: number }>(await expect("GET", "/api/admin/comments?status=PENDING&page=1", 200, { cookie: adminCookie }));
    const item = list.items.find(({ id }) => id === saved.id);
    assert(list.pageSize === 20 && item?.content === commentText && item.post.id === posts.main.id && item.post.slug === posts.main.slug && item.post.status === "PUBLISHED", "Moderation list lacks the correct pending comment/publication link.");
    await statusOnly("GET", "/api/admin/comments?status=UNKNOWN", 400, { cookie: adminCookie });
  });
  await test("moderator mutations enforce Origin, allowed status and current version", async () => {
    const saved = await storedComment(mainTicket);
    for (const origin of [null, "https://untrusted.example.invalid"]) {
      await statusOnly("PATCH", `/api/admin/comments/${saved.id}`, 403, { cookie: adminCookie, origin, json: { status: "APPROVED", version: saved.version } });
      await statusOnly("DELETE", `/api/admin/comments/${saved.id}`, 403, { cookie: adminCookie, origin, json: { version: saved.version } });
    }
    await statusOnly("PATCH", `/api/admin/comments/${saved.id}`, 400, { cookie: adminCookie, json: { status: "UNKNOWN", version: saved.version } });
    await statusOnly("PATCH", `/api/admin/comments/${saved.id}`, 400, { cookie: adminCookie, json: { status: "APPROVED", version: saved.version, postId: posts.other.id } });
    const results = await Promise.all([request("PATCH", `/api/admin/comments/${saved.id}`, { cookie: adminCookie, json: { status: "APPROVED", version: saved.version } }), request("PATCH", `/api/admin/comments/${saved.id}`, { cookie: adminCookie, json: { status: "APPROVED", version: saved.version } })]);
    assert(results.map(({ status }) => status).sort((a, b) => a - b).join(",") === "200,409", "Concurrent moderation must accept one version and reject its stale duplicate.");
    for (const result of results) await result.arrayBuffer();
    const approved = await storedComment(mainTicket);
    assert(approved.status === "APPROVED" && approved.version === saved.version + 1, "Approval did not advance exactly one version.");
    await (await moderate(saved.id, saved.version, "REJECTED", 409)).arrayBuffer();
    await statusOnly("DELETE", `/api/admin/comments/${saved.id}`, 409, { cookie: adminCookie, json: { version: saved.version } });
  });
  await test("approved comments become public and untrusted text remains data, not executable HTML", async () => {
    const saved = await storedComment(mainTicket);
    const list = await comments(posts.main.slug);
    assert(list.total === 1 && list.items[0]?.id === saved.id && list.items[0].content === commentText && (await stats(posts.main.slug)).commentCount === 1, "Approved comment list/count did not update.");
    const html = await (await expect("GET", `/news/${posts.main.slug}`, 200)).text();
    assert(!html.includes("<script>globalThis.__social_xss=true</script>") && !html.includes('<img src=x onerror="alert(1)">'), "Comment text became executable publication HTML.");
    if (html.includes(marker)) assert(html.includes("&lt;script&gt;"), "Server-rendered comment text must be escaped.");
  });
  await test("rejecting and approving updates only approved counts", async () => {
    let saved = await storedComment(mainTicket);
    await (await moderate(saved.id, saved.version, "REJECTED")).arrayBuffer();
    assert((await stats(posts.main.slug)).commentCount === 0 && (await comments(posts.main.slug)).total === 0, "Rejected comments remain publicly counted/listed.");
    saved = await storedComment(mainTicket);
    await (await moderate(saved.id, saved.version, "APPROVED")).arrayBuffer();
    assert((await stats(posts.main.slug)).commentCount === 1, "Reapproved comment was not counted exactly once.");
    const duplicate = await storedComment(duplicateTicket);
    await (await moderate(duplicate.id, duplicate.version, "REJECTED")).arrayBuffer();
    assert((await stats(posts.main.slug)).commentCount === 1, "Rejecting a pending comment changed the approved count.");
  });
  await test("approved comment pagination is stable, bounded to twenty and contains no pending/rejected rows", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({ id: randomUUID(), postId: posts.main.id, displayName: `Проверка ${index + 1}`, content: `${marker} pagination ${index}`, status: "APPROVED" as const, createdAt: new Date(Date.now() + index) }));
    await scriptDb.comment.createMany({ data: rows });
    const page1 = await comments(posts.main.slug, 1);
    const page2 = await comments(posts.main.slug, 2);
    assert(page1.total === 22 && page1.pageSize === 20 && page1.totalPages === 2 && page1.items.length === 20 && page2.items.length === 2, "Approved comment pagination boundaries are incorrect.");
    assert(new Set([...page1.items, ...page2.items].map(({ id }) => id)).size === 22, "Pagination duplicates or omits comments.");
    assert((await comments(posts.main.slug, 1)).items.map(({ id }) => id).join() === page1.items.map(({ id }) => id).join(), "Pagination ordering is unstable.");
    assert((await stats(posts.main.slug)).commentCount === 22, "The comment counter diverged from approved pagination totals.");
    for (const page of ["0", "-1", "NaN", "1000000"]) await statusOnly("GET", `/api/posts/${posts.main.slug}/comments?page=${page}`, 400);
  });
  await test("canonical and Open Graph metadata use the original URL and a real accessible image", async () => {
    const html = await (await expect("GET", `/news/${posts.main.slug}`, 200, { headers: { "X-Forwarded-Host": "untrusted.example.invalid", "X-Forwarded-Proto": "https" } })).text();
    const canonicalTag = html.match(/<link\b[^>]*>/g)?.find((tag) => attribute(tag, "rel") === "canonical");
    const canonical = new URL(`/news/${posts.main.slug}`, base).href;
    assert(canonicalTag && attribute(canonicalTag, "href") === canonical && metadataValue(html, "og:url") === canonical, "Canonical/Open Graph URLs trust a forwarded host or are missing.");
    assert(metadataValue(html, "og:title") === posts.main.title && Boolean(metadataValue(html, "og:description")), "Publication Open Graph title/description are missing or incorrect.");
    const image = metadataValue(html, "og:image");
    assert(image, "Publication Open Graph image is missing.");
    const imageUrl = new URL(image);
    assert(imageUrl.origin === base.origin, "Open Graph image must point to an existing image served by this site.");
    const response = await expect("GET", `${imageUrl.pathname}${imageUrl.search}`, 200);
    assert(response.headers.get("content-type") === "image/jpeg" && response.headers.get("cache-control")?.includes("no-store"), "Open Graph image must be a private non-cacheable JPEG response.");
    const imageBytes = Buffer.from(await response.arrayBuffer());
    assert(imageBytes[0] === 0xff && imageBytes[1] === 0xd8, "Open Graph response is not an actual JPEG.");
    const copies = await Promise.all(Array.from({ length: 6 }, async () => {
      const repeated = await expect("GET", imageUrl.pathname, 200);
      return Buffer.from(await repeated.arrayBuffer());
    }));
    assert(copies.every(copy => copy.equals(imageBytes)), "Concurrent preview reads returned inconsistent image data.");
  });
  await test("unpublishing immediately hides existing likes, comments, forms and article metadata", async () => {
    const ticket = await issue(posts.main.slug, first);
    await mature(ticket);
    await statusOnly("PATCH", `/api/admin/posts/${posts.main.id}`, 200, { cookie: adminCookie, json: { version: posts.main.version, status: "UNPUBLISHED" } });
    posts.main.version++;
    for (const suffix of ["social", "comments", "comments/form"]) await statusOnly("GET", `/api/posts/${posts.main.slug}/${suffix}`, 404, { cookie: first.cookie });
    await (await like(posts.main.slug, first, true, 404)).arrayBuffer();
    await comment(ticket, 404);
    const hidden = await expect("GET", `/news/${posts.main.slug}`, 404);
    await statusOnly("GET", `/news/${posts.main.slug}/preview.jpg`, 404);
    const html = await hidden.text();
    assert(!html.includes(marker) && metadataValue(html, "og:title") !== posts.main.title, "Hidden article metadata or comments leaked into its 404 response.");
    await statusOnly("PATCH", `/api/admin/posts/${posts.main.id}`, 200, { cookie: adminCookie, json: { version: posts.main.version, status: "PUBLISHED" } });
    posts.main.version++;
    const restored = await stats(posts.main.slug, first);
    assert(restored.likeCount === 2 && restored.liked && restored.commentCount === 22, "Republishing duplicated or lost existing social data.");
  });
  await test("deleting a post cascades its likes, comments and nonce receipts", async () => {
    await (await like(posts.cascade.slug, first, true)).arrayBuffer();
    await comment(cascadeTicket);
    assert(await scriptDb.like.count({ where: { postId: posts.cascade.id } }) === 1 && await scriptDb.comment.count({ where: { postId: posts.cascade.id } }) === 1 && await scriptDb.commentReceipt.count({ where: { postId: posts.cascade.id } }) === 1, "Cascade fixtures are incomplete.");
    await statusOnly("DELETE", `/api/admin/posts/${posts.cascade.id}`, 200, { cookie: adminCookie, json: { version: posts.cascade.version } });
    assert(await scriptDb.like.count({ where: { postId: posts.cascade.id } }) === 0 && await scriptDb.comment.count({ where: { postId: posts.cascade.id } }) === 0 && await scriptDb.commentReceipt.count({ where: { postId: posts.cascade.id } }) === 0, "Post deletion left orphaned social records.");
    await statusOnly("GET", `/api/posts/${posts.cascade.slug}/social`, 404);
  });
  await test("comment deletion removes public content while its retained receipt prevents recreation", async () => {
    const saved = await storedComment(mainTicket);
    await statusOnly("DELETE", `/api/admin/comments/${saved.id}`, 200, { cookie: adminCookie, json: { version: saved.version } });
    assert((await stats(posts.main.slug)).commentCount === 21 && !(await comments(posts.main.slug)).items.some(({ id }) => id === saved.id), "Deleted approved comment remains public or counted.");
    assert(await scriptDb.commentReceipt.count({ where: { key: mainTicket.nonce } }) === 1, "Comment deletion removed its minimal replay-protection receipt.");
    await comment(mainTicket, 200);
    await comment(mainTicket, 409, { content: `${commentText} retry changed` });
    assert(await scriptDb.comment.count({ where: { receiptKey: mainTicket.nonce } }) === 0, "An exact retry recreated a deliberately deleted comment.");
  });
  await test("three accepted comments exhaust the visitor quota and changing forwarded IP does not bypass it", async () => {
    const ticket = await issue(posts.main.slug, first);
    await comment(ticket, 429, { content: `${marker} quota` }, { "X-Forwarded-For": "203.0.113.100" });
    await comment(ticket, 429, { content: `${marker} quota` }, { "X-Forwarded-For": "198.51.100.200" });
    const count = await scriptDb.actionLimit.findUnique({ where: { key: `social:comments:accepted:${first.hash}` } });
    assert(count?.count === 3, "Accepted-comment quota is not atomic/persisted.");
    assert(await scriptDb.commentReceipt.count({ where: { key: ticket.nonce } }) === 0, "A throttled comment kept a receipt despite transaction rollback.");
  });
  await test("like attempt limits are persisted and cannot be bypassed by changed forwarded IP", async () => {
    const visitor = await session();
    const remainingWindow = 60_000 - Date.now() % 60_000;
    if (remainingWindow < 5000) await delay(remainingWindow + 50);
    for (let index = 0; index < 30; index++) await (await like(posts.rate.slug, visitor, true, 200, { "X-Forwarded-For": `203.0.113.${index + 1}` })).arrayBuffer();
    await (await like(posts.rate.slug, visitor, false, 429, { "X-Forwarded-For": "198.51.100.100" })).arrayBuffer();
    await (await like(posts.rate.slug, visitor, false, 429, { "X-Forwarded-For": "198.51.100.200" })).arrayBuffer();
    const count = await scriptDb.actionLimit.findUnique({ where: { key: `social:likes:${visitor.hash}` } });
    assert(count && count.count > 30 && (await stats(posts.rate.slug, visitor)).likeCount === 1, "Persisted like rate limiting failed or modified the existing desired state.");
  });

  let pendingModeTicket: Ticket;
  let autoTicket: Ticket;
  let replyTicket: Ticket;
  let threadRootId = "";
  let replyId = "";
  let threadVisitor: Visitor;
  let replyVisitor: Visitor;
  await test("disabled comment moderation publishes immediately and does not approve existing pending comments", async () => {
    [threadVisitor, replyVisitor] = await Promise.all([session(), session()]);
    pendingModeTicket = await issue(posts.other.slug, threadVisitor);
    assert(pendingModeTicket.moderationEnabled, "The form must describe enabled moderation.");
    await comment(pendingModeTicket, 201, { content: `${marker} existing pending` });
    await changeCommentMode(false);
    autoTicket = await issue(posts.other.slug, threadVisitor);
    assert(!autoTicket.moderationEnabled, "The form must describe immediate publication.");
    await comment(autoTicket, 201, { content: `${marker} immediate root` }, undefined, "APPROVED");
    const saved = await storedComment(autoTicket);
    threadRootId = saved.id;
    assert(saved.status === "APPROVED" && (await storedComment(pendingModeTicket)).status === "PENDING", "Disabling moderation failed to publish a new comment or promoted an existing pending one.");
    assert((await comments(posts.other.slug)).total === 1 && (await stats(posts.other.slug)).commentCount === 1, "Immediate publication did not update public lists and counts.");
  });
  await test("unnamed comments and replies publish under the anonymous signature when moderation is disabled", async () => {
    const visitor = await session();
    const tickets = await Promise.all([issue(posts.names.slug, visitor), issue(posts.names.slug, visitor)]);
    const ids: string[] = [];
    for (const [index, name] of ["", undefined].entries()) {
      assert(!tickets[index].moderationEnabled, "The anonymous form does not describe immediate publication.");
      const changes = { displayName: name, content: `${marker} anonymous immediate ${index}` };
      await comment(tickets[index], 201, changes, undefined, "APPROVED");
      const saved = await storedComment(tickets[index]);
      ids.push(saved.id);
      assert(saved.displayName === "Житель Кинешмы" && saved.status === "APPROVED", "An anonymous immediate comment was rejected or mislabeled.");
      await comment(tickets[index], 200, { ...changes, displayName: name === undefined ? "  " : undefined }, undefined, "APPROVED");
    }
    const reply = await issue(posts.names.slug, visitor);
    await comment(reply, 201, { displayName: undefined, content: `${marker} anonymous reply`, parentId: ids[0] }, undefined, "APPROVED");
    const visible = await comments(posts.names.slug);
    assert(visible.total === 3 && visible.rootTotal === 2 && visible.items.every(item => item.displayName === "Житель Кинешмы"), "Anonymous public roots were not listed or counted correctly.");
    assert(visible.items.find(item => item.id === ids[0])?.replies[0]?.displayName === "Житель Кинешмы", "An anonymous reply has no public signature.");
    assert((await stats(posts.names.slug)).commentCount === 3, "The public count includes anonymous pending comments or duplicate retries.");
    assert(await scriptDb.comment.count({ where: { id: { in: anonymousPendingIds }, status: "PENDING" } }) === 2, "Changing the mode published existing anonymous pending comments.");
  });
  await test("receipt acceptance mode is stable across independent settings changes", async () => {
    await changeCommentMode(true);
    await comment(autoTicket, 200, { content: `${marker} immediate root` }, undefined, "APPROVED");
    await changeCommentMode(false);
    await comment(pendingModeTicket, 200, { content: `${marker} existing pending` });
    const receipts = await scriptDb.commentReceipt.findMany({ where: { key: { in: [autoTicket.nonce, pendingModeTicket.nonce] } } });
    assert(receipts.find(receipt => receipt.key === autoTicket.nonce)?.acceptedStatus === "APPROVED" && receipts.find(receipt => receipt.key === pendingModeTicket.nonce)?.acceptedStatus === "PENDING", "Receipts forgot their original accepted moderation status.");
    assert((await storedComment(pendingModeTicket)).status === "PENDING", "An idempotent retry promoted an existing pending comment.");
  });
  await test("one-level replies accept only a visible root comment in the same publication", async () => {
    replyTicket = await issue(posts.other.slug, replyVisitor);
    await comment(replyTicket, 201, { parentId: threadRootId, content: `${marker} direct reply` }, undefined, "APPROVED");
    replyId = (await storedComment(replyTicket)).id;
    const invalid = await issue(posts.other.slug, replyVisitor);
    const pending = await storedComment(pendingModeTicket);
    const foreignParent = (await comments(posts.main.slug)).items[0];
    assert(foreignParent, "Foreign publication fixture is missing.");
    for (const parentId of [randomUUID(), pending.id, foreignParent.id, replyId, "invalid-id"]) {
      await comment(invalid, 400, { parentId, content: `${marker} rejected reply` });
    }
    assert(await scriptDb.commentReceipt.count({ where: { key: invalid.nonce } }) === 0, "A rejected reply consumed its nonce.");
    const list = await comments(posts.other.slug, 1, { visitor: replyVisitor });
    assert(list.rootTotal === 1 && list.total === 2 && list.items[0].replies[0]?.id === replyId && list.items[0].replies[0].parentId === threadRootId, "A one-level reply is not nested below its actual parent.");
    assert((await stats(posts.other.slug)).commentCount === 2, "Reply was omitted from the real approved comment count.");
  });
  await test("thread preview and reply pagination are bounded and include only approved content", async () => {
    const rootRows = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), postId: posts.other.id, displayName: `Проверка корня ${index}`, content: `${marker} root page ${index}`, status: "APPROVED" as const, createdAt: new Date(Date.now() + 100 + index) }));
    const replyRows = Array.from({ length: 22 }, (_, index) => ({ id: randomUUID(), postId: posts.other.id, parentId: threadRootId, displayName: `Проверка ответа ${index}`, content: `${marker} reply page ${index}`, status: "APPROVED" as const, createdAt: new Date(Date.now() + index) }));
    await scriptDb.comment.createMany({ data: [...rootRows, ...replyRows] });
    const preview = await comments(posts.other.slug, 1, { preview: true });
    const full = await comments(posts.other.slug);
    const replies1 = await comments(posts.other.slug, 1, { parentId: threadRootId });
    const replies2 = await comments(posts.other.slug, 2, { parentId: threadRootId });
    assert(preview.items.length === 3 && preview.pageSize === 3 && preview.items.every(item => item.replies.length <= 1), "Feed preview is not bounded to three recent threads.");
    assert(preview.items.map(item => item.id).join() === rootRows.slice(1).map(item => item.id).join(), "Preview does not show the last three root comments in stable order.");
    assert(full.items.find(item => item.id === threadRootId)?.replies.length === 3 && full.rootTotal === 5 && full.total === 28, "Full threads expose unlimited replies or incorrect totals.");
    assert(replies1.items.length === 20 && replies2.items.length === 3 && replies1.total === 23 && new Set([...replies1.items, ...replies2.items].map(item => item.id)).size === 23, "Reply pagination duplicates, omits or overfetches replies.");
    assert((await stats(posts.other.slug)).commentCount === 28, "Visible reply totals differ from the publication counter.");
  });
  await test("comment likes use desired-state uniqueness, protected visitors and independent counters", async () => {
    const attempts = await Promise.all([commentLike(posts.other.slug, replyId, threadVisitor, true), commentLike(posts.other.slug, replyId, threadVisitor, true), commentLike(posts.other.slug, replyId, threadVisitor, true)]);
    for (const response of attempts) { privateResponse(response); const value = await json<{likeCount:number;liked:boolean}>(response); assert(value.likeCount === 1 && value.liked, "Duplicate likes changed a comment counter."); }
    const rows = await scriptDb.commentLike.findMany({ where: { commentId: replyId } });
    assert(rows.length === 1 && rows[0].anonymousVisitorIdHash === threadVisitor.hash && rows[0].anonymousVisitorIdHash !== threadVisitor.rawId, "Comment likes did not store one opaque visitor hash.");
    await (await commentLike(posts.other.slug, replyId, replyVisitor, true)).arrayBuffer();
    await (await commentLike(posts.other.slug, replyId, threadVisitor, false)).arrayBuffer();
    await (await commentLike(posts.other.slug, replyId, threadVisitor, false)).arrayBuffer();
    const own = (await comments(posts.other.slug, 1, { parentId: threadRootId, visitor: replyVisitor })).items.find(item => item.id === replyId);
    const outsider = (await comments(posts.other.slug, 1, { parentId: threadRootId, visitor: threadVisitor })).items.find(item => item.id === replyId);
    assert(own?.likeCount === 1 && own.liked && outsider?.likeCount === 1 && !outsider.liked, "Comment like state leaked between visitors or repeated unlike changed another visitor's like.");
    const route = `/api/posts/${posts.other.slug}/comments/${replyId}/like`;
    const payload = { liked: true, csrfToken: threadVisitor.csrfToken };
    await statusOnly("PUT", route, 403, { json: payload });
    for (const origin of [null, "https://untrusted.example.invalid"]) await statusOnly("PUT", route, 403, { cookie: threadVisitor.cookie, json: payload, origin });
    await statusOnly("PUT", route, 403, { cookie: tamper(threadVisitor.cookie), json: payload });
    await statusOnly("PUT", route, 403, { cookie: threadVisitor.cookie, json: { ...payload, csrfToken: replyVisitor.csrfToken } });
    await statusOnly("PUT", route, 400, { cookie: threadVisitor.cookie, json: { ...payload, likeCount: 999 } });
    await statusOnly("PUT", route, 400, { cookie: threadVisitor.cookie, json: { liked: true } });
    await (await commentLike(posts.main.slug, replyId, threadVisitor, true, 404)).arrayBuffer();
    const pending = await storedComment(pendingModeTicket);
    await (await commentLike(posts.other.slug, pending.id, threadVisitor, true, 404)).arrayBuffer();
  });
  await test("administrator editing preserves status and rejects forged fields and stale versions", async () => {
    const saved = await storedComment(autoTicket);
    const changes = { version: saved.version, displayName: "Исправленный псевдоним", content: `${marker} edited <script>alert(1)</script>` };
    const route = `/api/admin/comments/${saved.id}`;
    for (const origin of [null, "https://untrusted.example.invalid"]) await statusOnly("PUT", route, 403, { cookie: adminCookie, origin, json: changes });
    for (const extra of [{ status: "REJECTED" }, { parentId: replyId }, { postId: posts.main.id }, { version: 0 }]) await statusOnly("PUT", route, 400, { cookie: adminCookie, json: { ...changes, ...extra } });
    for (const forbidden of ["ХУЙ", "МУДАК"]) {
      await statusOnly("PUT", route, 400, { cookie: adminCookie, json: { ...changes, displayName: forbidden } });
    }
    const unchanged = await storedComment(autoTicket);
    assert(unchanged.version === saved.version && unchanged.displayName === saved.displayName && unchanged.content === saved.content && unchanged.status === saved.status, "A rejected administrator nickname changed the saved comment.");
    const responses = await Promise.all([request("PUT", route, { cookie: adminCookie, json: changes }), request("PUT", route, { cookie: adminCookie, json: changes })]);
    assert(responses.map(response => response.status).sort((a,b) => a-b).join() === "200,409", "Concurrent edits did not enforce the current version.");
    for (const response of responses) await response.arrayBuffer();
    const updated = await storedComment(autoTicket);
    assert(updated.status === "APPROVED" && updated.version === saved.version + 1 && updated.content === changes.content && updated.parentId === null, "Editing changed moderation status/parent or lost text.");
    const visible = (await comments(posts.other.slug)).items.find(item => item.id === saved.id);
    assert(visible?.content === changes.content && visible.displayName === changes.displayName, "Administrator edits are not visible in the public thread.");
    const pending = await storedComment(pendingModeTicket);
    await statusOnly("PUT", `/api/admin/comments/${pending.id}`, 200, { cookie: adminCookie, json: { version: pending.version, displayName: "Ожидающий автор", content: `${marker} pending edited` } });
    assert((await storedComment(pendingModeTicket)).status === "PENDING", "Editing silently published a pending comment.");
  });
  await test("hiding a parent hides its replies and their actions without deleting them", async () => {
    let parent = await storedComment(autoTicket);
    await (await moderate(parent.id, parent.version, "PENDING")).arrayBuffer();
    assert((await comments(posts.other.slug)).total === 4 && (await stats(posts.other.slug)).commentCount === 4, "Hidden-parent replies remain visible or counted.");
    await statusOnly("GET", `/api/posts/${posts.other.slug}/comments?parentId=${parent.id}`, 404, { cookie: threadVisitor.cookie });
    await (await commentLike(posts.other.slug, replyId, threadVisitor, true, 404)).arrayBuffer();
    const invalid = await issue(posts.other.slug, replyVisitor);
    await comment(invalid, 400, { parentId: parent.id, content: `${marker} hidden parent reply` });
    assert(await scriptDb.comment.count({ where: { parentId: parent.id } }) === 23, "Hiding a parent destroyed stored replies.");
    parent = await storedComment(autoTicket);
    await (await moderate(parent.id, parent.version, "APPROVED")).arrayBuffer();
    assert((await stats(posts.other.slug)).commentCount === 28, "Restoring the parent did not restore approved replies exactly once.");
  });
  await test("unpublished threads deny comment reactions and parent deletion cascades replies but retains receipts", async () => {
    await statusOnly("PATCH", `/api/admin/posts/${posts.other.id}`, 200, { cookie: adminCookie, json: { version: posts.other.version, status: "UNPUBLISHED" } });
    posts.other.version++;
    await (await commentLike(posts.other.slug, replyId, threadVisitor, true, 404)).arrayBuffer();
    await statusOnly("GET", `/api/posts/${posts.other.slug}/comments?preview=1`, 404, { cookie: threadVisitor.cookie });
    await statusOnly("PATCH", `/api/admin/posts/${posts.other.id}`, 200, { cookie: adminCookie, json: { version: posts.other.version, status: "PUBLISHED" } });
    posts.other.version++;
    const parent = await storedComment(autoTicket);
    const descendantIds = (await scriptDb.comment.findMany({ where: { parentId: parent.id }, select: { id: true } })).map(item => item.id);
    await statusOnly("DELETE", `/api/admin/comments/${parent.id}`, 200, { cookie: adminCookie, json: { version: parent.version } });
    assert(await scriptDb.comment.count({ where: { id: { in: [parent.id, ...descendantIds] } } }) === 0 && await scriptDb.commentLike.count({ where: { commentId: { in: [parent.id, ...descendantIds] } } }) === 0, "Deleting a parent left orphaned replies or comment likes.");
    assert((await stats(posts.other.slug)).commentCount === 4 && await scriptDb.commentReceipt.count({ where: { key: { in: [autoTicket.nonce, replyTicket.nonce] } } }) === 2, "Parent deletion removed receipts or left a stale approved count.");
    await changeCommentMode(true);
    await comment(autoTicket, 200, { content: `${marker} immediate root` }, undefined, "APPROVED");
    await comment(replyTicket, 200, { parentId: threadRootId, content: `${marker} direct reply` }, undefined, "APPROVED");
    assert(await scriptDb.comment.count({ where: { receiptKey: { in: [autoTicket.nonce, replyTicket.nonce] } } }) === 0, "Retry recreated a deliberately deleted thread.");
  });
}

async function cleanup() {
  let settingsRestored = true;
  if (originalSettings && lastSettingsVersion !== null) {
    const restored = await scriptDb.siteSettings.updateMany({ where: { id: "main", version: lastSettingsVersion }, data: { commentsModerationEnabled: originalSettings.commentsModerationEnabled, postsModerationEnabled: originalSettings.postsModerationEnabled, defaultCategoryId: originalSettings.defaultCategoryId, version: { increment: 1 } } });
    settingsRestored = restored.count === 1;
    if (settingsRestored) console.log("PASS settings restored: original moderation choices and default category preserved.");
  }
  const userIds = (await scriptDb.user.findMany({ where: { OR: identities.map(({ id, email }) => ({ id, email })) }, select: { id: true } })).map(({ id }) => id);
  // Only posts authored by this run's exact temporary identities can be removed.
  await scriptDb.post.deleteMany({ where: { authorId: { in: userIds }, id: { in: postIds } } });
  await scriptDb.commentReceipt.deleteMany({ where: { key: { in: [...receiptKeys] }, postId: { in: postIds } } });
  await scriptDb.category.deleteMany({ where: { id: category.id, name: category.name, posts: { none: {} }, submissions: { none: {} } } });
  const ownLimits = [...visitorHashes].flatMap((hash) => [`social:likes:${hash}`, `social:comment-likes:${hash}`, `social:forms:${hash}`, `social:comments:attempts:${hash}`, `social:comments:accepted:${hash}`, `social:comments:daily:${hash}`]);
  ownLimits.push(...identities.map(({ email }) => `login:${createHash("sha256").update(email).digest("hex")}`));
  await scriptDb.actionLimit.deleteMany({ where: { key: { in: ownLimits } } });
  await scriptDb.user.deleteMany({ where: { OR: identities.map(({ id, email }) => ({ id, email })) } });
  assert(await scriptDb.post.count({ where: { id: { in: postIds } } }) === 0 && await scriptDb.like.count({ where: { postId: { in: postIds } } }) === 0 && await scriptDb.comment.count({ where: { postId: { in: postIds } } }) === 0 && await scriptDb.commentReceipt.count({ where: { postId: { in: postIds } } }) === 0, "Owned publications or social records remain after cleanup.");
  assert(await scriptDb.user.count({ where: { id: { in: identities.map(({ id }) => id) } } }) === 0 && await scriptDb.category.count({ where: { id: category.id } }) === 0, "Owned identities/category remain after cleanup.");
  assert(settingsRestored, "Settings changed outside this test; test fixtures removed, but another editor's settings were not overwritten.");
  console.log("PASS cleanup: only this run's users, posts, category, social records and individual limits removed; shared quotas retained.");
}

const uiFixtureFile = path.resolve("storage/private/social-ui-fixture.json");
const uiTitle = "Проверка социальных функций — тестовый материал";
type UiFixture = { fixtureId: string; userId: string; postId: string; categoryId: string; email: string; password?: string; slug: string; visitorHashes: string[]; state: "prepared" | "cleaned" };
async function prepareUi() {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "UI fixtures may only be prepared for a local APP_URL.");
  try { await readFile(uiFixtureFile); throw new TestFailure("The UI fixture file already exists; inspect/clean it instead of overwriting it."); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  const existingCategory = await scriptDb.category.findFirst({ orderBy: { name: "asc" }, select: { id: true } });
  assert(existingCategory, "An existing category is required for the UI fixture.");
  const fixtureId = randomUUID();
  const userId = randomUUID();
  const postId = randomUUID();
  const temporaryPassword = randomBytes(32).toString("base64url");
  const fixture: UiFixture = { fixtureId, userId, postId, categoryId: existingCategory.id, email: `social-ui-${fixtureId}@example.invalid`, password: temporaryPassword, slug: `social-ui-${fixtureId}`, visitorHashes: [], state: "prepared" };
  const hash = await hashPassword(temporaryPassword);
  await mkdir(path.dirname(uiFixtureFile), { recursive: true });
  // Retain the exact identifiers for recovery; the password is never stdout.
  await writeFile(uiFixtureFile, JSON.stringify(fixture, null, 2), { flag: "wx", mode: 0o600 });
  try {
    await scriptDb.$transaction(async (tx) => {
      await tx.user.create({ data: { id: userId, name: "Проверка социальных функций", email: fixture.email, role: "admin", accounts: { create: { id: randomUUID(), accountId: userId, providerId: "credential", password: hash } } } });
      await tx.post.create({ data: { id: postId, slug: fixture.slug, title: uiTitle, content: "Это демонстрационный материал для проверки лайков, комментариев и меню «Поделиться». Он не является реальной новостью Кинешмы.\n\nПосле проверки запись, комментарии, лайки и временная учётная запись будут удалены.", excerpt: "Демонстрационный материал для проверки социальных функций. Это не реальная новость.", status: "PUBLISHED", sourceType: "COMMUNITY", publishedAt: new Date(), categoryId: existingCategory.id, authorId: userId } });
    });
  } catch {
    await writeFile(uiFixtureFile, JSON.stringify({ ...fixture, password: undefined, state: "cleaned" }, null, 2), { mode: 0o600 });
    throw new TestFailure("UI fixture creation failed; transaction rolled back and password removed from its recovery file.");
  }
  console.log(`UI fixture prepared: ${new URL(`/news/${fixture.slug}`, base).href}`);
  console.log("Temporary credentials are stored only in storage/private/social-ui-fixture.json; no credentials printed.");
}
async function cleanupUi() {
  const fixture = JSON.parse(await readFile(uiFixtureFile, "utf8")) as UiFixture;
  assert([fixture.fixtureId, fixture.userId, fixture.postId, fixture.categoryId].every((id) => typeof id === "string" && /^[a-f0-9-]{36}$/.test(id)), "UI fixture identifiers are invalid.");
  assert(fixture.email === `social-ui-${fixture.fixtureId}@example.invalid` && fixture.slug === `social-ui-${fixture.fixtureId}` && Array.isArray(fixture.visitorHashes), "UI fixture ownership markers are invalid.");
  const user = await scriptDb.user.findUnique({ where: { id: fixture.userId }, select: { id: true, email: true, role: true, name: true } });
  const post = await scriptDb.post.findUnique({ where: { id: fixture.postId }, select: { id: true, authorId: true, slug: true, title: true } });
  assert(!user || (user.email === fixture.email && user.role === "admin" && user.name === "Проверка социальных функций"), "Refusing to delete a different user.");
  assert(!post || (post.authorId === fixture.userId && post.slug === fixture.slug && post.title === uiTitle), "Refusing to delete a different publication.");
  assert(await scriptDb.post.count({ where: { authorId: fixture.userId, id: { not: fixture.postId } } }) === 0 && await scriptDb.mediaAsset.count({ where: { uploadedById: fixture.userId } }) === 0 && await scriptDb.submission.count({ where: { reviewedById: fixture.userId } }) === 0, "UI moderator has unrelated records; cleanup refused.");
  // Only explicitly recorded visitor hashes are eligible for counter cleanup.
  // A reader merely liking this public fixture does not authorize erasing that
  // reader's shared per-visitor limits for other publications.
  const recordedHashes = new Set(fixture.visitorHashes);
  assert([...recordedHashes].every((hash) => /^[a-f0-9]{64}$/.test(hash)), "UI fixture visitor markers are invalid.");
  await scriptDb.post.deleteMany({ where: { id: fixture.postId, authorId: fixture.userId } });
  const limits = [...recordedHashes].flatMap((hash) => [`social:likes:${hash}`, `social:forms:${hash}`, `social:comments:attempts:${hash}`, `social:comments:accepted:${hash}`, `social:comments:daily:${hash}`]);
  limits.push(`login:${createHash("sha256").update(fixture.email).digest("hex")}`);
  await scriptDb.actionLimit.deleteMany({ where: { key: { in: limits } } });
  await scriptDb.user.deleteMany({ where: { id: fixture.userId, email: fixture.email } });
  assert(await scriptDb.post.count({ where: { id: fixture.postId } }) === 0 && await scriptDb.like.count({ where: { postId: fixture.postId } }) === 0 && await scriptDb.comment.count({ where: { postId: fixture.postId } }) === 0 && await scriptDb.commentReceipt.count({ where: { postId: fixture.postId } }) === 0 && await scriptDb.user.count({ where: { id: fixture.userId } }) === 0, "UI fixture cleanup is incomplete.");
  // Keep the recovery/helper artifact instead of attempting filesystem deletion.
  await writeFile(uiFixtureFile, JSON.stringify({ ...fixture, password: undefined, state: "cleaned" }, null, 2), { mode: 0o600 });
  console.log("UI fixture cleaned: exact test post, social rows and temporary moderator removed; real categories/users and shared quotas preserved. Recovery file retained without password.");
}

if (process.argv.includes("--prepare-ui") || process.argv.includes("--cleanup-ui")) {
  try { if (process.argv.includes("--prepare-ui")) await prepareUi(); else await cleanupUi(); }
  catch (error) {
    console.error(error instanceof TestFailure ? error.message : "UI fixture operation failed; sensitive details suppressed.");
    process.exitCode = 1;
  }
  finally { await scriptDb.$disconnect(); }
} else {
  try {
    await main();
    console.log(`All ${passed} social integration/security checks passed.`);
  } catch (error) {
    console.error(`FAIL ${activeTest}: ${error instanceof TestFailure ? error.message : "Unexpected test/database error; sensitive details suppressed."}`);
    process.exitCode = 1;
  } finally {
    try { await cleanup(); }
    catch (error) {
      console.error(error instanceof TestFailure ? `FAIL cleanup: ${error.message}` : "FAIL cleanup: could not finish removing this run's fixtures; sensitive details suppressed.");
      process.exitCode = 1;
    }
    await scriptDb.$disconnect();
  }
}
