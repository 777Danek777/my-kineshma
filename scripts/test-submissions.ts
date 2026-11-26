import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, realpath, unlink } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { scriptDb } from "./script-db";

// This test creates temporary identities and clearly labelled submissions. It
// never reads real administrator credentials or prints tokens, cookies, private
// contact values, database URLs, or unfiltered server/database errors.
const base = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
const runId = randomUUID();
const marker = `SUBMISSION_TEST_${runId}`;
const privateName = `PRIVATE_NAME_${runId}`;
const privateContact = `private-${runId}@example.invalid`;
const hostile = '<script>globalThis.__submission_xss = true</script><img src=x onerror="alert(1)">';
const password = randomBytes(32).toString("base64url");
const admin = { id: randomUUID(), email: `submission-admin-${runId}@example.invalid`, role: "admin" };
const member = { id: randomUUID(), email: `submission-member-${runId}@example.invalid`, role: "user" };
const fixtureUsers = [admin, member];
const category = { id: randomUUID(), name: `SUBMISSION ${runId}`, slug: `submission-test-${runId}` };
const nonces = new Set<string>();
const submissionIds = new Set<string>();
const postIds = new Set<string>();
const mediaFiles = new Map<string, string>();
const ownLimitKeys = new Set<string>();
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || "./storage/uploads");
let passed = 0;
let activeTest = "initialization";
type ModerationSettings = { commentsModerationEnabled: boolean; postsModerationEnabled: boolean; defaultCategoryId: string | null; version: number };
let originalSettings: ModerationSettings | null = null;
let settingsVersion: number | null = null;
let settingsCookie = "";

async function useModeratedPosts(cookie: string) {
  settingsCookie = cookie;
  const { settings } = await json<{ settings: ModerationSettings }>(await expect("GET", "/api/admin/settings", 200, { cookie }));
  if (settings.postsModerationEnabled) return;
  originalSettings = settings; settingsVersion = settings.version + 1;
  const changed = await json<{ settings: ModerationSettings }>(await expect("PATCH", "/api/admin/settings", 200, { cookie, json: { commentsModerationEnabled: settings.commentsModerationEnabled, postsModerationEnabled: true, defaultCategoryId: settings.defaultCategoryId, version: settings.version } }));
  assert(changed.settings.postsModerationEnabled, "Could not enable publication moderation for the regression run.");
  settingsVersion = changed.settings.version;
}
async function restoreModerationSettings() {
  if (!originalSettings) return;
  const { settings: current } = await json<{ settings: ModerationSettings }>(await expect("GET", "/api/admin/settings", 200, { cookie: settingsCookie }));
  const same = current.commentsModerationEnabled === originalSettings.commentsModerationEnabled && current.postsModerationEnabled === originalSettings.postsModerationEnabled && current.defaultCategoryId === originalSettings.defaultCategoryId;
  if (!same) {
    assert(current.version === settingsVersion, "Moderation settings changed during the test; refusing to overwrite another editor's changes.");
    const { settings: restored } = await json<{ settings: ModerationSettings }>(await expect("PATCH", "/api/admin/settings", 200, { cookie: settingsCookie, json: { commentsModerationEnabled: originalSettings.commentsModerationEnabled, postsModerationEnabled: originalSettings.postsModerationEnabled, defaultCategoryId: originalSettings.defaultCategoryId, version: current.version } }));
    assert(restored.commentsModerationEnabled === originalSettings.commentsModerationEnabled && restored.postsModerationEnabled === originalSettings.postsModerationEnabled && restored.defaultCategoryId === originalSettings.defaultCategoryId, "Could not restore the original moderation preferences.");
  }
  originalSettings = null; settingsVersion = null;
}

class TestFailure extends Error {}
function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TestFailure(message);
}
async function test(name: string, operation: () => Promise<void>) {
  activeTest = name;
  await operation();
  console.log(`PASS ${++passed}: ${name}`);
}
type Options = { cookie?: string; json?: unknown; form?: FormData; origin?: string | null; headers?: Record<string, string> };
async function request(method: string, route: string, options: Options = {}) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (method !== "GET" && options.origin !== null) headers.set("Origin", options.origin ?? base.origin);
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) { headers.set("Content-Type", "application/json"); body = JSON.stringify(options.json); }
  return fetch(new URL(route, base), { method, headers, body, redirect: "manual", signal: AbortSignal.timeout(60_000) });
}
async function expect(method: string, route: string, status: number, options: Options = {}) {
  const response = await request(method, route, options);
  assert(response.status === status, `${method} ${route.split("?")[0]}: expected ${status}, received ${response.status}`);
  return response;
}
async function statusOnly(method: string, route: string, status: number, options: Options = {}) {
  await (await expect(method, route, status, options)).arrayBuffer();
}
async function json<T>(response: Response): Promise<T> {
  try { return await response.json() as T; }
  catch { throw new TestFailure("Expected a JSON response."); }
}
function protectedCookie(response: Response, name: string) {
  const value = response.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=`) || cookie.startsWith(`__Secure-${name}=`));
  if (!value) return null;
  assert(/;\s*HttpOnly(?:;|$)/i.test(value), "Security cookie is missing HttpOnly.");
  assert(/;\s*SameSite=(?:Lax|Strict)(?:;|$)/i.test(value), "Security cookie is missing a SameSite restriction.");
  if (base.protocol === "https:") assert(/;\s*Secure(?:;|$)/i.test(value), "HTTPS security cookie is missing Secure.");
  return value.split(";")[0];
}
function tokenPayload(token: string): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(Buffer.from(token.split(".")[0], "base64url").toString("utf8"));
    assert(payload && typeof payload === "object" && !Array.isArray(payload), "Invalid form token payload.");
    return payload as Record<string, unknown>;
  } catch { throw new TestFailure("Could not identify this test form's receipt nonce."); }
}
type Visitor = { cookie: string };
type Ticket = { token: string; nonce: string; visitorId: string; readyAt: number; visitor: Visitor };
async function issue(visitor?: Visitor): Promise<Ticket> {
  const response = await expect("GET", "/api/submissions/form", 200, { cookie: visitor?.cookie });
  assert(response.headers.get("cache-control")?.includes("no-store"), "Submission form tokens must not be cached.");
  const cookie = protectedCookie(response, "submission_visitor") || visitor?.cookie;
  assert(cookie, "The submission form must bind its token to a visitor cookie.");
  const result = await json<{ token: string; minDelayMs: number }>(response);
  assert(typeof result.token === "string" && result.minDelayMs === 3000, "Unexpected form token/minimum delay contract.");
  const payload = tokenPayload(result.token);
  assert(typeof payload.nonce === "string" && /^[a-f0-9-]{36}$/.test(payload.nonce), "The form must contain a UUID receipt nonce.");
  assert(typeof payload.visitor === "string" && /^[a-f0-9-]{36}$/.test(payload.visitor), "The form must identify its signed visitor.");
  nonces.add(payload.nonce);
  ownLimitKeys.add(`submissions:attempts:${payload.visitor}`);
  ownLimitKeys.add(`submissions:accepted:${payload.visitor}`);
  return { token: result.token, nonce: payload.nonce, visitorId: payload.visitor, readyAt: Date.now() + result.minDelayMs + 100, visitor: { cookie } };
}
async function mature(ticket: Ticket) {
  const remaining = ticket.readyAt - Date.now();
  if (remaining > 0) await delay(remaining);
}
type Photo = { bytes: Uint8Array; type?: string; name?: string };
type Payload = { title: string; content: string; senderName: string; contact: string; anonymous: string; website: string; photos: Photo[] };
function payload(label: string, photos: Photo[] = [], anonymous = false): Payload {
  return { title: `Демонстрационный тест ${label} ${runId.slice(0, 8)}`, content: `${marker}\nДемонстрационная заявка автоматической проверки: ${label}.\n${hostile}`, senderName: privateName, contact: privateContact, anonymous: String(anonymous), website: "", photos };
}
function form(ticket: Ticket, data: Payload, token: string | null = ticket.token) {
  const body = new FormData();
  if (token !== null) body.set("token", token);
  for (const key of ["title", "content", "senderName", "contact", "anonymous", "website"] as const) body.set(key, data[key]);
  for (const photo of data.photos) body.append("photos", new File([new Uint8Array(photo.bytes).buffer], photo.name || "test.png", { type: photo.type || "image/png" }));
  return body;
}
async function submit(ticket: Ticket, data: Payload, status = 201, options: Options = {}) {
  await mature(ticket);
  const response = await expect("POST", "/api/submissions", status, { cookie: ticket.visitor.cookie, form: form(ticket, data), ...options });
  if (status === 200 || status === 201) await acceptedResponse(response);
  else await response.arrayBuffer();
}
async function acceptedResponse(response: Response) {
  const body = await json<Record<string, unknown>>(response);
  assert(body.success === true && body.status === "PENDING" && typeof body.message === "string", "Successful public submission response is incorrect.");
  assert(Object.keys(body).every((key) => ["success", "status", "message"].includes(key)), "Public response exposes internal submission information.");
  const serialized = JSON.stringify(body);
  assert(!serialized.includes(privateName) && !serialized.includes(privateContact) && !serialized.includes("/media/"), "Public response leaked contact or media information.");
}
async function unfinishedMultipart(ticket: Ticket) {
  const started = Date.now();
  const boundary = `submission-deadline-${randomUUID()}`;
  return new Promise<{ status: number; elapsedMs: number }>((resolve, reject) => {
    let completed = false;
    const client = (base.protocol === "https:" ? httpsRequest : httpRequest)(new URL("/api/submissions", base), {
      method: "POST",
      headers: { Origin: base.origin, Cookie: ticket.visitor.cookie, "Content-Type": `multipart/form-data; boundary=${boundary}`, "Transfer-Encoding": "chunked" },
    });
    const finish = (error?: Error, status = 0) => {
      if (completed) return;
      completed = true;
      clearTimeout(watchdog);
      client.destroy();
      if (error) reject(error); else resolve({ status, elapsedMs: Date.now() - started });
    };
    const watchdog = setTimeout(() => finish(new TestFailure("An unfinished upload was not terminated within 96 seconds.")), 96_000);
    client.on("response", (response) => {
      response.on("error", () => finish(new TestFailure("The unfinished-upload response stream failed.")));
      response.on("end", () => finish(undefined, response.statusCode ?? 0));
      response.resume();
    });
    client.on("error", (error: NodeJS.ErrnoException) => {
      const code = error.code && /^[A-Z0-9_]+$/.test(error.code) ? ` (${error.code})` : "";
      finish(new TestFailure(`The unfinished upload connection ended without an HTTP response${code}.`));
    });
    // Intentionally never end the HTTP body. A partial, otherwise normal form
    // must be cancelled by the server's read deadline, not by the test client.
    client.write(`--${boundary}\r\nContent-Disposition: form-data; name="token"\r\n\r\n${ticket.token}\r\n--${boundary}\r\nContent-Disposition: form-data; name="content"\r\n\r\nPartial upload`);
  });
}
async function ownSubmission(ticket: Ticket) {
  const row = await scriptDb.submission.findUnique({ where: { receiptKey: ticket.nonce }, include: { images: { include: { media: true } } } });
  assert(row, "Accepted submission was not persisted for its receipt.");
  submissionIds.add(row.id);
  if (row.postId) postIds.add(row.postId);
  for (const { media } of row.images) mediaFiles.set(media.id, media.filename);
  return row;
}
type AdminSubmission = { id: string; version: number; status: string; title: string; content: string; senderName: string | null; contact: string | null; anonymous: boolean; categoryId: string | null; images: { id: string; url: string }[]; post: { id: string; slug: string; status: string } | null };
async function detail(id: string, cookie: string) {
  return (await json<{ submission: AdminSubmission }>(await expect("GET", `/api/admin/submissions/${id}`, 200, { cookie }))).submission;
}
function editorial(data: AdminSubmission) {
  return { version: data.version, title: data.title, content: data.content, categoryId: data.categoryId, imageIds: data.images.map(({ id }) => id) };
}
async function assertFileMissing(filename: string) {
  assert(/^[a-f0-9-]{36}\.webp$/.test(filename), "Unexpected test media filename.");
  const file = path.resolve(uploadDirectory, filename);
  assert(path.dirname(file) === uploadDirectory, "Unexpected test media path.");
  try { await lstat(file); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new TestFailure("Deleted private submission still has a stored image file.");
}

async function main() {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname), "Tests may only run against a local APP_URL.");
  assert(base.pathname === "/" && !base.username && !base.password, "APP_URL must be an origin without credentials.");
  const missingId = randomUUID();
  const protectedRoutes: [string, string][] = [["GET", "/api/admin/submissions"], ["GET", `/api/admin/submissions/${missingId}`], ["PATCH", `/api/admin/submissions/${missingId}`], ["POST", `/api/admin/submissions/${missingId}/approve`], ["POST", `/api/admin/submissions/${missingId}/reject`], ["DELETE", `/api/admin/submissions/${missingId}`]];
  await test("submission moderation pages and every API operation reject guests", async () => {
    for (const route of ["/admin/submissions", `/admin/submissions/${missingId}`]) {
      const response = await request("GET", route);
      assert([303, 307, 308].includes(response.status) && new URL(response.headers.get("location") || "/", base).pathname === "/admin/login", "Guest moderation page did not redirect to login.");
      await response.arrayBuffer();
    }
    for (const [method, route] of protectedRoutes) await statusOnly(method, route, 401, method === "GET" ? {} : { json: {} });
  });
  let anonymousTicket: Ticket;
  let namedTicket: Ticket;
  let deleteTicket: Ticket;
  await test("public forms issue private signed tokens and protected visitor cookies", async () => {
    [anonymousTicket, namedTicket, deleteTicket] = await Promise.all([issue(), issue(), issue()]);
    assert(new Set([anonymousTicket.nonce, namedTicket.nonce, deleteTicket.nonce]).size === 3, "Form tokens must use unique receipt nonces.");
  });
  let adminCookie = "";
  let memberCookie = "";
  await test("temporary hashed-password identities authenticate without using real credentials", async () => {
    const hash = await hashPassword(password);
    for (const identity of fixtureUsers) await scriptDb.user.create({ data: { ...identity, name: `Submission test ${runId.slice(0, 8)}`, accounts: { create: { id: randomUUID(), accountId: identity.id, providerId: "credential", password: hash } } } });
    await scriptDb.category.create({ data: category });
    for (const identity of fixtureUsers) {
      const response = await expect("POST", "/api/auth/sign-in/email", 200, { json: { email: identity.email, password } });
      const cookie = protectedCookie(response, "my-kineshma.session_token");
      assert(cookie, "Temporary test identity did not receive a session.");
      if (identity.role === "admin") adminCookie = cookie; else memberCookie = cookie;
      await response.arrayBuffer();
    }
    await useModeratedPosts(adminCookie);
  });
  await test("ordinary authenticated users and forged cookies cannot moderate", async () => {
    for (const cookie of [memberCookie, `my-kineshma.session_token=${randomBytes(32).toString("hex")}`]) {
      for (const [method, route] of protectedRoutes) await statusOnly(method, route, 401, { cookie, ...(method === "GET" ? {} : { json: {} }) });
    }
  });

  const png = await sharp({ create: { width: 5, height: 4, channels: 4, background: { r: 40, g: 160, b: 120, alpha: 1 } } }).png().toBuffer();
  const anonymousData = payload("анонимная заявка", [{ bytes: png }], true);
  const namedData = payload("публикация после модерации", [{ bytes: png }]);
  const deleteData = payload("удаление до публикации", [{ bytes: png }]);
  let anonymousId = "";
  let namedId = "";
  let deleteId = "";
  await test("anonymous submission is pending and discards supplied name and contact", async () => {
    await submit(anonymousTicket, anonymousData);
    const row = await ownSubmission(anonymousTicket);
    anonymousId = row.id;
    assert(row.status === "PENDING" && row.anonymous && row.senderName === null && row.contact === null && row.postId === null, "Anonymous submission retained identifying fields or was published.");
    assert(row.images.length === 1 && row.images[0].media.filename.endsWith(".webp"), "Submission image was not persisted as WebP.");
    assert(await scriptDb.post.count({ where: { content: { contains: marker } } }) === 0, "Submitting a story must not create a public post.");
  });
  await test("replaying the exact request is idempotent but changed payload conflicts", async () => {
    await submit(anonymousTicket, anonymousData, 200);
    await submit(anonymousTicket, { ...anonymousData, content: `${anonymousData.content}\nChanged payload` }, 409);
    assert(await scriptDb.submission.count({ where: { receiptKey: anonymousTicket.nonce } }) === 1, "A repeated receipt created duplicate submissions.");
  });
  await test("pending text and images are unavailable to visitors and ordinary users", async () => {
    const record = await ownSubmission(anonymousTicket);
    for (const { media } of record.images) {
      await statusOnly("GET", `/media/${media.id}`, 404);
      await statusOnly("GET", `/media/${media.id}`, 404, { cookie: memberCookie });
      const response = await expect("GET", `/media/${media.id}`, 200, { cookie: adminCookie });
      assert(response.headers.get("content-type") === "image/webp" && response.headers.get("cache-control")?.includes("no-store"), "Private media must be a noncached WebP.");
      const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
      assert(metadata.format === "webp" && metadata.width === 5, "Submission image is not the expected safe raster image.");
      await statusOnly("GET", `/_next/image?url=${encodeURIComponent(`/media/${media.id}`)}&w=640&q=75`, 400, { cookie: adminCookie });
    }
    const home = await expect("GET", "/", 200);
    assert(!(await home.text()).includes(marker), "Pending submission text leaked into the home page.");
  });
  await test("named submissions retain private contact only in moderation storage", async () => {
    await submit(namedTicket, namedData);
    await submit(deleteTicket, deleteData);
    const named = await ownSubmission(namedTicket);
    namedId = named.id;
    deleteId = (await ownSubmission(deleteTicket)).id;
    assert(!named.anonymous && named.senderName === privateName && named.contact === privateContact && named.status === "PENDING", "Named submission was not stored with private contact and pending status.");
    const list = await json<{ submissions: AdminSubmission[] }>(await expect("GET", "/api/admin/submissions?status=PENDING", 200, { cookie: adminCookie }));
    assert(list.submissions.some(({ id }) => id === namedId), "Administrator list is missing the new pending submission.");
    const record = await detail(namedId, adminCookie);
    assert(record.contact === privateContact && record.senderName === privateName, "Administrator cannot review submitted contact details.");
  });
  await test("missing, tampered, and browser-mismatched tokens are rejected", async () => {
    const ticket = await issue();
    await mature(ticket);
    const data = payload("защита токена");
    await statusOnly("POST", "/api/submissions", 403, { cookie: ticket.visitor.cookie, form: form(ticket, data, null) });
    await statusOnly("POST", "/api/submissions", 403, { form: form(ticket, data) });
    await statusOnly("POST", "/api/submissions", 403, { cookie: anonymousTicket.visitor.cookie, form: form(ticket, data) });
    const tampered = `${ticket.token.slice(0, -1)}${ticket.token.endsWith("a") ? "b" : "a"}`;
    await statusOnly("POST", "/api/submissions", 403, { cookie: ticket.visitor.cookie, form: form(ticket, data, tampered) });
  });
  await test("public submissions reject missing and foreign Origin headers", async () => {
    const ticket = await issue();
    await mature(ticket);
    const data = payload("защита Origin");
    for (const origin of [null, "https://untrusted.example.invalid"]) await statusOnly("POST", "/api/submissions", 403, { cookie: ticket.visitor.cookie, form: form(ticket, data), origin });
    await statusOnly("POST", "/api/submissions", 403, { cookie: ticket.visitor.cookie, form: form(ticket, data), headers: { "Sec-Fetch-Site": "cross-site" } });
  });
  await test("a fresh form enforces the minimum waiting period", async () => {
    // Earlier tests have already compiled/warmed the POST route in development.
    const ticket = await issue();
    await statusOnly("POST", "/api/submissions", 400, { cookie: ticket.visitor.cookie, form: form(ticket, payload("проверка времени заполнения")) });
    assert(await scriptDb.submissionReceipt.count({ where: { key: ticket.nonce } }) === 0, "A too-fast request created an accepted receipt.");
  });
  await test("input lengths, photo count, and honeypot are validated before storage", async () => {
    const basePayload = payload("невалидная заявка");
    const invalid: Payload[] = [
      { ...basePayload, title: "", content: "", photos: [] },
      { ...basePayload, title: "x".repeat(181) },
      { ...basePayload, content: "x".repeat(20_001) },
      { ...basePayload, senderName: "x".repeat(81) },
      { ...basePayload, contact: "x".repeat(201) },
      { ...basePayload, anonymous: "not-a-boolean" },
      { ...basePayload, photos: Array.from({ length: 5 }, () => ({ bytes: png })) },
      { ...basePayload, website: "https://spam.example.invalid" },
    ];
    const tickets = await Promise.all([...invalid.map(() => issue()), issue()]);
    for (let index = 0; index < invalid.length; index++) await submit(tickets[index], invalid[index], 400);
    const extraTicket = tickets[tickets.length - 1];
    await mature(extraTicket);
    const unknownFields = form(extraTicket, basePayload);
    unknownFields.set("status", "PUBLISHED");
    unknownFields.set("postId", randomUUID());
    await statusOnly("POST", "/api/submissions", 400, { cookie: extraTicket.visitor.cookie, form: unknownFields });
    assert(await scriptDb.submission.count({ where: { receiptKey: { in: tickets.map(({ nonce }) => nonce) } } }) === 0, "An invalid request created a submission.");
  });
  await test("SVG, MIME spoofing, oversized files, and oversized requests are rejected", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const invalid: { photo: Photo; status: number }[] = [
      { photo: { bytes: svg, type: "image/svg+xml", name: "test.svg" }, status: 415 },
      { photo: { bytes: svg, type: "image/png" }, status: 415 },
      { photo: { bytes: png, type: "image/jpeg", name: "test.jpg" }, status: 415 },
      { photo: { bytes: new Uint8Array(5 * 1024 * 1024 + 1) }, status: 413 },
      { photo: { bytes: new Uint8Array(72 * 1024 * 1024 + 1) }, status: 413 },
    ];
    const tickets = await Promise.all(invalid.map(() => issue()));
    for (let index = 0; index < invalid.length; index++) await submit(tickets[index], payload("недопустимое изображение", [invalid[index].photo]), invalid[index].status);
    assert(await scriptDb.submission.count({ where: { receiptKey: { in: tickets.map(({ nonce }) => nonce) } } }) === 0, "An invalid upload created a submission.");
  });
  await test("single-character and photo-only submissions need no title or minimum text length", async () => {
    const samples = [
      { ...payload("один символ заголовка"), title: "x", content: "" },
      { ...payload("один символ текста"), title: "", content: "x" },
      { ...payload("только фотография", [{ bytes: png }]), title: "", content: "" },
    ];
    const tickets = await Promise.all(samples.map(() => issue()));
    for (const [index, data] of samples.entries()) {
      await submit(tickets[index], data);
      const row = await ownSubmission(tickets[index]);
      assert(row.status === "PENDING" && row.postId === null && row.title === data.title && row.content === data.content && row.images.length === data.photos.length, "Optional submission text was rejected, replaced, or published despite moderation.");
    }
  });
  await test("all moderator mutations require the correct Origin", async () => {
    const record = await detail(namedId, adminCookie);
    const operations: [string, string, unknown][] = [["PATCH", `/api/admin/submissions/${namedId}`, editorial(record)], ["POST", `/api/admin/submissions/${namedId}/approve`, { ...editorial(record), categoryId: category.id }], ["POST", `/api/admin/submissions/${namedId}/reject`, { version: record.version }], ["DELETE", `/api/admin/submissions/${namedId}`, { version: record.version }]];
    for (const origin of [null, "https://untrusted.example.invalid"]) for (const [method, route, body] of operations) await statusOnly(method, route, 403, { cookie: adminCookie, json: body, origin });
  });
  let named: AdminSubmission;
  await test("editing persists changes and rejects stale versions and unrelated images", async () => {
    const before = await detail(namedId, adminCookie);
    const unrelated = (await detail(anonymousId, adminCookie)).images[0].id;
    await statusOnly("PATCH", `/api/admin/submissions/${namedId}`, 400, { cookie: adminCookie, json: { ...editorial(before), imageIds: [unrelated] } });
    const edited = { ...editorial(before), title: `Демонстрация после редактора ${runId.slice(0, 8)}`, content: `${before.content}\nРедактор проверил демонстрационный текст.`, categoryId: category.id };
    await statusOnly("PATCH", `/api/admin/submissions/${namedId}`, 200, { cookie: adminCookie, json: edited });
    named = await detail(namedId, adminCookie);
    assert(named.title === edited.title && named.content === edited.content && named.categoryId === category.id && named.version === before.version + 1, "Editorial changes were not persisted with a new version.");
    await statusOnly("PATCH", `/api/admin/submissions/${namedId}`, 409, { cookie: adminCookie, json: editorial(before) });
    await statusOnly("DELETE", `/api/admin/submissions/${namedId}`, 409, { cookie: adminCookie, json: { version: before.version } });
  });
  await test("approval requires a real category and the current version", async () => {
    await statusOnly("POST", `/api/admin/submissions/${namedId}/approve`, 400, { cookie: adminCookie, json: { ...editorial(named), categoryId: null } });
    await statusOnly("POST", `/api/admin/submissions/${namedId}/approve`, 400, { cookie: adminCookie, json: { ...editorial(named), categoryId: randomUUID() } });
    await statusOnly("POST", `/api/admin/submissions/${namedId}/approve`, 409, { cookie: adminCookie, json: { ...editorial(named), version: named.version - 1 } });
    assert((await ownSubmission(namedTicket)).postId === null, "Rejected approval request unexpectedly created a post.");
  });
  let approvedBody: ReturnType<typeof editorial>;
  let publishedPost: { id: string; slug: string; version: number; status: string };
  await test("concurrent approval creates exactly one published post", async () => {
    approvedBody = editorial(named);
    const results = await Promise.all([request("POST", `/api/admin/submissions/${namedId}/approve`, { cookie: adminCookie, json: approvedBody }), request("POST", `/api/admin/submissions/${namedId}/approve`, { cookie: adminCookie, json: approvedBody })]);
    assert(results.some(({ status }) => status === 200) && results.every(({ status }) => status === 200 || status === 409), "Concurrent approval must succeed once and never produce a server error.");
    for (const result of results) await result.arrayBuffer();
    named = await detail(namedId, adminCookie);
    const row = await ownSubmission(namedTicket);
    assert(named.status === "APPROVED" && row.postId, "Approved submission has no linked post.");
    const post = await scriptDb.post.findUnique({ where: { id: row.postId } });
    assert(post && post.status === "PUBLISHED", "Approval did not publish the linked article.");
    assert(post.sourceType === "RESIDENT", "An approved reader submission must retain the RESIDENT source classification.");
    publishedPost = post;
    postIds.add(post.id);
    assert(await scriptDb.post.count({ where: { authorId: admin.id, content: { contains: marker } } }) === 1, "Repeated approval created duplicate articles.");
  });
  await test("published text is escaped and private contact never enters public output", async () => {
    const response = await expect("GET", `/news/${publishedPost.slug}`, 200);
    const html = await response.text();
    assert(html.includes(marker) && html.includes("&lt;script&gt;"), "Approved article did not render escaped submission text.");
    assert(!html.includes('<script>globalThis.__submission_xss') && !html.includes('<img src=x onerror="alert(1)">'), "Untrusted text became executable HTML.");
    assert(!html.includes(privateName) && !html.includes(privateContact), "Private sender/contact fields leaked into the article.");
    const home = await expect("GET", "/", 200);
    const homeText = await home.text();
    assert(homeText.includes(marker) && !homeText.includes(privateName) && !homeText.includes(privateContact), "Home page publication/contact visibility is incorrect.");
    for (const image of named.images) await statusOnly("GET", image.url, 200);
  });
  await test("replaying approval after unpublishing cannot republish or duplicate the post", async () => {
    await statusOnly("PATCH", `/api/admin/posts/${publishedPost.id}`, 200, { cookie: adminCookie, json: { version: publishedPost.version, status: "UNPUBLISHED" } });
    const repeat = await request("POST", `/api/admin/submissions/${namedId}/approve`, { cookie: adminCookie, json: approvedBody });
    assert([200, 409].includes(repeat.status), "Repeated approval returned an unexpected status.");
    await repeat.arrayBuffer();
    const saved = await scriptDb.post.findUnique({ where: { id: publishedPost.id } });
    assert(saved?.status === "UNPUBLISHED", "An approval replay republished an intentionally hidden article.");
    assert(await scriptDb.post.count({ where: { authorId: admin.id, content: { contains: marker } } }) === 1, "An approval replay created another article.");
    await statusOnly("GET", `/news/${publishedPost.slug}`, 404);
    for (const image of named.images) await statusOnly("GET", image.url, 404);
  });
  await test("deleting an approved application preserves its existing article and images", async () => {
    named = await detail(namedId, adminCookie);
    await statusOnly("DELETE", `/api/admin/submissions/${namedId}`, 200, { cookie: adminCookie, json: { version: named.version } });
    await statusOnly("GET", `/api/admin/submissions/${namedId}`, 404, { cookie: adminCookie });
    assert(await scriptDb.post.count({ where: { id: publishedPost.id } }) === 1, "Deleting the application deleted its published article.");
    for (const image of named.images) await statusOnly("GET", image.url, 200, { cookie: adminCookie });
  });
  await test("rejected applications stay private without creating articles", async () => {
    let record = await detail(anonymousId, adminCookie);
    const version = record.version;
    await statusOnly("POST", `/api/admin/submissions/${anonymousId}/reject`, 200, { cookie: adminCookie, json: { version } });
    record = await detail(anonymousId, adminCookie);
    assert(record.status === "REJECTED" && record.version === version + 1 && record.post === null, "Rejecting an application produced an incorrect state.");
    assert((await ownSubmission(anonymousTicket)).postId === null, "Rejecting an application created a linked article.");
    for (const image of record.images) await statusOnly("GET", image.url, 404);
    const home = await expect("GET", "/", 200);
    assert(!(await home.text()).includes(marker), "Rejected or unpublished test material remains public.");
  });
  await test("deleting a pending application removes its private images and keeps the receipt", async () => {
    const row = await ownSubmission(deleteTicket);
    const record = await detail(deleteId, adminCookie);
    await statusOnly("DELETE", `/api/admin/submissions/${deleteId}`, 200, { cookie: adminCookie, json: { version: record.version } });
    assert(await scriptDb.submission.count({ where: { id: deleteId } }) === 0, "Deleted application remains in the database.");
    assert(await scriptDb.submissionReceipt.count({ where: { key: deleteTicket.nonce } }) === 1, "The deletion removed the replay-protection receipt.");
    for (const { media } of row.images) {
      assert(await scriptDb.mediaAsset.count({ where: { id: media.id } }) === 0, "Deleted pending image still has a database record.");
      await assertFileMissing(media.filename);
      await statusOnly("GET", `/media/${media.id}`, 404, { cookie: adminCookie });
    }
    await submit(deleteTicket, deleteData, 200);
    await submit(deleteTicket, { ...deleteData, title: `${deleteData.title} changed` }, 409);
    assert(await scriptDb.submission.count({ where: { receiptKey: deleteTicket.nonce } }) === 0, "A retry recreated a deliberately deleted application.");
  });
  await test("an unfinished upload times out and releases capacity for later requests", async () => {
    const ticket = await issue();
    const result = await unfinishedMultipart(ticket);
    assert(result.status === 408, `Unfinished upload: expected HTTP 408, received ${result.status}`);
    assert(result.elapsedMs >= 89_000 && result.elapsedMs <= 95_000, "The unfinished-upload deadline must expire at approximately 90 seconds and no later than 95 seconds.");
    assert(await scriptDb.submissionReceipt.count({ where: { key: ticket.nonce } }) === 0, "An unfinished upload created a receipt.");
    await issue(ticket.visitor);
    // A complete invalid request must reach normal field validation (400), not
    // remain blocked by the earlier body reader. It creates no accepted story.
    await submit(ticket, { ...payload("после незавершённой загрузки"), title: "", content: "", photos: [] }, 400);
  });
  await test("concurrent third-request retries use one quota slot and forwarded IP cannot bypass the limit", async () => {
    const first = await issue();
    const tickets = [first];
    for (let index = 0; index < 3; index++) tickets.push(await issue(first.visitor));
    assert(tickets.every(({ visitorId }) => visitorId === first.visitorId), "A renewed form unexpectedly changed its browser identity.");
    await mature(tickets[tickets.length - 1]);
    for (let index = 0; index < 2; index++) {
      await submit(tickets[index], payload(`антиспам ${index + 1}`), 201, { headers: { "X-Forwarded-For": `203.0.113.${index + 1}` } });
      await ownSubmission(tickets[index]);
    }
    const thirdPayload = payload("антиспам 3 — параллельный повтор");
    const duplicates = await Promise.all([
      request("POST", "/api/submissions", { cookie: first.visitor.cookie, form: form(tickets[2], thirdPayload), headers: { "X-Forwarded-For": "203.0.113.3" } }),
      request("POST", "/api/submissions", { cookie: first.visitor.cookie, form: form(tickets[2], thirdPayload), headers: { "X-Forwarded-For": "203.0.113.4" } }),
    ]);
    assert(duplicates.map(({ status }) => status).sort((a, b) => a - b).join(",") === "200,201", "Concurrent duplicate at the quota boundary must return one 201 and one idempotent 200.");
    for (const response of duplicates) await acceptedResponse(response);
    await ownSubmission(tickets[2]);
    assert(await scriptDb.submission.count({ where: { receiptKey: tickets[2].nonce } }) === 1, "Concurrent retries created duplicate applications.");
    const data = payload("превышение лимита");
    await submit(tickets[3], data, 429, { headers: { "X-Forwarded-For": "203.0.113.200" } });
    await submit(tickets[3], data, 429, { headers: { "X-Forwarded-For": "198.51.100.250" } });
    assert(await scriptDb.submission.count({ where: { receiptKey: { in: tickets.map(({ nonce }) => nonce) } } }) === 3, "The browser submission limit was bypassed.");
    const persisted = await scriptDb.actionLimit.findUnique({ where: { key: `submissions:accepted:${first.visitorId}` } });
    assert(persisted?.count === 3, "Accepted-submission quota was not persisted atomically in PostgreSQL.");
  });
}

async function cleanup() {
  const users = await scriptDb.user.findMany({ where: { email: { in: fixtureUsers.map(({ email }) => email) } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const submissions = await scriptDb.submission.findMany({ where: { OR: [{ receiptKey: { in: [...nonces] } }, { content: { contains: marker } }] }, include: { images: { include: { media: true } } } });
  for (const row of submissions) {
    submissionIds.add(row.id);
    if (row.postId) postIds.add(row.postId);
    for (const { media } of row.images) mediaFiles.set(media.id, media.filename);
  }
  const posts = await scriptDb.post.findMany({ where: { OR: [{ id: { in: [...postIds] } }, { authorId: { in: userIds } }] }, include: { images: { include: { media: true } } } });
  for (const post of posts) {
    postIds.add(post.id);
    for (const { media } of post.images) mediaFiles.set(media.id, media.filename);
  }
  await scriptDb.submission.deleteMany({ where: { id: { in: [...submissionIds] } } });
  await scriptDb.post.deleteMany({ where: { id: { in: [...postIds] } } });
  await scriptDb.mediaAsset.deleteMany({ where: { id: { in: [...mediaFiles.keys()] }, posts: { none: {} }, submissions: { none: {} } } });
  const remaining = new Set((await scriptDb.mediaAsset.findMany({ where: { id: { in: [...mediaFiles.keys()] } }, select: { id: true } })).map(({ id }) => id));
  for (const [id, filename] of mediaFiles) {
    assert(/^[a-f0-9-]{36}$/.test(id) && filename === `${id}.webp`, "Refusing cleanup of an unexpected media filename.");
    if (remaining.has(id)) continue; // Never remove a file now referenced by unrelated data.
    const file = path.resolve(uploadDirectory, filename);
    assert(path.dirname(file) === uploadDirectory, "Refusing cleanup outside UPLOAD_DIR.");
    try {
      const info = await lstat(file);
      assert(info.isFile() && !info.isSymbolicLink(), "Refusing cleanup of an unexpected filesystem entry.");
      const [actualDirectory, actualFile] = await Promise.all([realpath(uploadDirectory), realpath(file)]);
      assert(path.dirname(actualFile) === actualDirectory, "Refusing cleanup outside the resolved upload directory.");
      await unlink(file);
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
    }
  }
  await scriptDb.submissionReceipt.deleteMany({ where: { key: { in: [...nonces] } } });
  await scriptDb.category.deleteMany({ where: { id: category.id, name: category.name, posts: { none: {} }, submissions: { none: {} } } });
  for (const identity of fixtureUsers) {
    ownLimitKeys.add(`login:${createHash("sha256").update(identity.email).digest("hex")}`);
    ownLimitKeys.add(`uploads:${identity.id}`);
  }
  // Shared/global counters are intentionally left untouched.
  await scriptDb.actionLimit.deleteMany({ where: { key: { in: [...ownLimitKeys] } } });
  await scriptDb.user.deleteMany({ where: { id: { in: userIds }, email: { in: fixtureUsers.map(({ email }) => email) } } });
  assert(remaining.size === 0, "An owned media file is still referenced outside the test fixtures.");
  assert(await scriptDb.submission.count({ where: { id: { in: [...submissionIds] } } }) === 0, "Test submissions remain after cleanup.");
  assert(await scriptDb.post.count({ where: { id: { in: [...postIds] } } }) === 0, "Test posts remain after cleanup.");
  assert(await scriptDb.submissionReceipt.count({ where: { key: { in: [...nonces] } } }) === 0, "Test receipts remain after cleanup.");
  assert(await scriptDb.category.count({ where: { id: category.id, name: category.name } }) === 0, "Test category remains after cleanup.");
  assert(await scriptDb.user.count({ where: { email: { in: fixtureUsers.map(({ email }) => email) } } }) === 0, "Test identities remain after cleanup.");
  console.log("PASS cleanup: owned applications, posts, media files, receipts, category, identities, and individual limits removed.");
}

try {
  await main();
  console.log(`All ${passed} submission integration/security checks passed.`);
} catch (error) {
  console.error(`FAIL ${activeTest}: ${error instanceof TestFailure ? error.message : "Unexpected test or database error; sensitive details suppressed."}`);
  process.exitCode = 1;
} finally {
  try { await restoreModerationSettings(); }
  catch (error) { console.error(error instanceof TestFailure ? `FAIL settings restore: ${error.message}` : "FAIL settings restore: could not restore the original preferences."); process.exitCode = 1; }
  try { await cleanup(); }
  catch (error) {
    console.error(error instanceof TestFailure ? `FAIL cleanup: ${error.message}` : "FAIL cleanup: could not finish removing this run's fixtures; sensitive details suppressed.");
    process.exitCode = 1;
  }
  await scriptDb.$disconnect();
}
