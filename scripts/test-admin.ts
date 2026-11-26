import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, realpath, unlink } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import sharp from "sharp";
import { scriptDb } from "./script-db";

// Run against the local application with `npm run test:admin`.
// Every database/file fixture belongs to random, temporary users. Real admin
// passwords, cookies, connection strings, and response bodies are never logged.
const base = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
const runId = randomUUID();
const tag = runId.slice(0, 8);
const admin = {
  id: randomUUID(),
  email: `integration-admin-${runId}@example.invalid`,
  role: "admin",
};
const member = {
  id: randomUUID(),
  email: `integration-user-${runId}@example.invalid`,
  role: "user",
};
const limitedEmail = `integration-limited-${runId}@example.invalid`;
const fixtureUsers = [admin, member];
const categoryNames = new Set<string>();
const uploadDirectory = path.resolve(
  process.env.UPLOAD_DIR || "./storage/uploads",
);
const password = randomBytes(32).toString("base64url");
const marker = `INTEGRATION_PRIVATE_CONTENT_${runId}`;
const hostile =
  '<script>globalThis.__kineshma_test_xss = true</script><img src=x onerror="alert(1)">';
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
  originalSettings = settings;
  settingsVersion = settings.version + 1;
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
  passed++;
  console.log(`PASS ${passed}: ${name}`);
}

type RequestOptions = {
  cookie?: string;
  json?: unknown;
  form?: FormData;
  origin?: string | null;
  headers?: Record<string, string>;
};
async function request(
  method: string,
  route: string,
  options: RequestOptions = {},
) {
  const headers = new Headers(options.headers);
  if (options.cookie) headers.set("Cookie", options.cookie);
  if (method !== "GET" && options.origin !== null)
    headers.set("Origin", options.origin ?? base.origin);
  let body: BodyInit | undefined;
  if (options.form) body = options.form;
  else if (options.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(options.json);
  }
  return fetch(new URL(route, base), {
    method,
    headers,
    body,
    redirect: "manual",
    signal: AbortSignal.timeout(60_000),
  });
}
async function expect(
  method: string,
  route: string,
  status: number,
  options: RequestOptions = {},
) {
  const response = await request(method, route, options);
  assert(
    response.status === status,
    `${method} ${route.split("?")[0]}: expected ${status}, received ${response.status}`,
  );
  return response;
}
async function statusOnly(
  method: string,
  route: string,
  status: number,
  options: RequestOptions = {},
) {
  const response = await expect(method, route, status, options);
  await response.arrayBuffer();
}
async function json<T>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    throw new TestFailure("Expected a valid JSON response.");
  }
}
function cookieFrom(response: Response) {
  const cookies = response.headers.getSetCookie();
  const sessionCookie = cookies.find((value) =>
    /^(?:__Secure-)?my-kineshma\.session_token=/.test(value),
  );
  assert(sessionCookie, "Sign-in did not set the session cookie.");
  assert(
    /;\s*HttpOnly(?:;|$)/i.test(sessionCookie),
    "Session cookie must be HttpOnly.",
  );
  assert(
    /;\s*SameSite=Lax(?:;|$)/i.test(sessionCookie),
    "Session cookie must be SameSite=Lax.",
  );
  if (base.protocol === "https:")
    assert(
      /;\s*Secure(?:;|$)/i.test(sessionCookie),
      "HTTPS session cookie must be Secure.",
    );
  return sessionCookie.split(";")[0];
}
function photoForm(
  bytes: Uint8Array,
  mime = "image/png",
  filename = "test.png",
) {
  const form = new FormData();
  form.set(
    "file",
    new File([new Uint8Array(bytes).buffer], filename, { type: mime }),
  );
  return form;
}

type Post = {
  id: string;
  slug: string;
  title: string;
  content: string;
  status: string;
  version: number;
  publishedAt: string | null;
  images: { id: string; url: string }[];
};
type Category = { id: string; name: string; postCount: number };
type Media = { id: string; url: string; width: number; height: number };

async function main() {
  assert(
    ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname),
    "Integration tests may run only against a local APP_URL.",
  );
  assert(
    base.pathname === "/" && !base.username && !base.password,
    "APP_URL must be an origin without credentials.",
  );
  const unknownId = randomUUID();
  const protectedRoutes: [string, string][] = [
    ["GET", "/api/admin/overview"],
    ["GET", "/api/admin/posts"],
    ["GET", `/api/admin/posts/${unknownId}`],
    ["POST", "/api/admin/posts"],
    ["PATCH", `/api/admin/posts/${unknownId}`],
    ["DELETE", `/api/admin/posts/${unknownId}`],
    ["GET", "/api/admin/categories"],
    ["POST", "/api/admin/categories"],
    ["PATCH", `/api/admin/categories/${unknownId}`],
    ["DELETE", `/api/admin/categories/${unknownId}`],
    ["POST", "/api/admin/uploads"],
    ["GET", "/api/admin/settings"],
    ["PATCH", "/api/admin/settings"],
  ];

  await test("anonymous administrator pages redirect to login", async () => {
    for (const route of [
      "/admin",
      "/admin/posts",
      "/admin/posts/new",
      `/admin/posts/${unknownId}`,
      "/admin/categories",
      "/admin/settings",
    ]) {
      const response = await request("GET", route);
      assert(
        [303, 307, 308].includes(response.status),
        `${route}: expected a login redirect, received ${response.status}`,
      );
      assert(
        new URL(response.headers.get("Location") || "/", base).pathname ===
          "/admin/login",
        `${route}: incorrect login redirect`,
      );
      await response.arrayBuffer();
    }
    await statusOnly("GET", "/admin/login", 200);
  });
  await test("every protected API operation denies anonymous visitors", async () => {
    for (const [method, route] of protectedRoutes)
      await statusOnly(
        method,
        route,
        401,
        method === "GET" ? {} : { json: {} },
      );
  });
  await test("forged session cookies cannot authenticate", async () => {
    for (const [method, route] of protectedRoutes)
      await statusOnly(method, route, 401, {
        cookie: `my-kineshma.session_token=${randomBytes(32).toString("hex")}`,
        ...(method === "GET" ? {} : { json: {} }),
      });
  });
  await test("public registration and account management endpoints are disabled", async () => {
    for (const route of [
      "sign-up/email",
      "request-password-reset",
      "reset-password",
      "change-password",
      "change-email",
      "update-user",
      "delete-user",
    ]) {
      await statusOnly("POST", `/api/auth/${route}`, 404, {
        json: {
          email: admin.email,
          password,
          name: "Integration fixture",
          role: "admin",
        },
      });
    }
    assert(
      (await scriptDb.user.count({ where: { email: admin.email } })) === 0,
      "Public registration unexpectedly created a user.",
    );
  });
  await test("temporary test identities are created with hashed passwords", async () => {
    const passwordHash = await hashPassword(password);
    for (const fixture of fixtureUsers) {
      await scriptDb.user.create({
        data: {
          ...fixture,
          name: `Integration ${tag}`,
          accounts: {
            create: {
              id: randomUUID(),
              accountId: fixture.id,
              providerId: "credential",
              password: passwordHash,
            },
          },
        },
      });
    }
  });

  let adminCookie = "";
  let memberCookie = "";
  await test("administrator session uses protected cookies and private responses", async () => {
    const response = await expect("POST", "/api/auth/sign-in/email", 200, {
      json: { email: admin.email, password },
    });
    adminCookie = cookieFrom(response);
    assert(
      response.headers.get("cache-control")?.includes("no-store"),
      "Sign-in response must not be cached.",
    );
    await response.arrayBuffer();
    const overview = await expect("GET", "/api/admin/overview", 200, {
      cookie: adminCookie,
    });
    assert(
      overview.headers.get("cache-control")?.includes("no-store"),
      "Admin API must not be cached.",
    );
    await overview.arrayBuffer();
    await useModeratedPosts(adminCookie);
  });
  await test("an authenticated ordinary user cannot read or mutate administration data", async () => {
    const response = await expect("POST", "/api/auth/sign-in/email", 200, {
      json: { email: member.email, password },
    });
    memberCookie = cookieFrom(response);
    await response.arrayBuffer();
    for (const [method, route] of protectedRoutes)
      await statusOnly(method, route, 401, {
        cookie: memberCookie,
        ...(method === "GET" ? {} : { json: {} }),
      });
    const page = await request("GET", "/admin", { cookie: memberCookie });
    assert(
      [303, 307, 308].includes(page.status) &&
        new URL(page.headers.get("location") || "/", base).pathname ===
          "/admin/login",
      "Ordinary user must be redirected out of administration.",
    );
    await page.arrayBuffer();
  });

  let category: Category;
  const categoryName = `INTEGRATION ${runId}`;
  categoryNames.add(categoryName);
  await test("administrator creates and renames categories", async () => {
    category = (
      await json<{ category: Category }>(
        await expect("POST", "/api/admin/categories", 201, {
          cookie: adminCookie,
          json: { name: categoryName },
        }),
      )
    ).category;
    assert(typeof category.id === "string", "Category identifier is missing.");
    const name = `${categoryName} renamed`;
    categoryNames.add(name);
    category = (
      await json<{ category: Category }>(
        await expect("PATCH", `/api/admin/categories/${category.id}`, 200, {
          cookie: adminCookie,
          json: { name },
        }),
      )
    ).category;
    assert(category.name === name, "Category rename was not saved.");
  });
  await test("category names are unique without regard to letter case", async () => {
    const duplicateName = category.name.toUpperCase();
    categoryNames.add(duplicateName);
    await statusOnly("POST", "/api/admin/categories", 409, {
      cookie: adminCookie,
      json: { name: duplicateName },
    });
  });

  const png = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 25, g: 150, b: 100, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  let media: Media;
  await test("safe image upload converts PNG into an actual WebP", async () => {
    media = (
      await json<{ image: Media }>(
        await expect("POST", "/api/admin/uploads", 201, {
          cookie: adminCookie,
          form: photoForm(png),
        }),
      )
    ).image;
    assert(
      media.width === 4 &&
        media.height === 4 &&
        media.url === `/media/${media.id}`,
      "Uploaded image metadata is incorrect.",
    );
    const response = await expect("GET", media.url, 200, {
      cookie: adminCookie,
    });
    assert(
      response.headers.get("content-type") === "image/webp",
      "Uploaded image must be served as WebP.",
    );
    const metadata = await sharp(
      Buffer.from(await response.arrayBuffer()),
    ).metadata();
    assert(
      metadata.format === "webp" && metadata.width === 4,
      "Uploaded bytes are not the expected WebP image.",
    );
  });
  await test("SVG, forged MIME types, and oversized uploads are rejected", async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    await statusOnly("POST", "/api/admin/uploads", 415, {
      cookie: adminCookie,
      form: photoForm(svg, "image/svg+xml", "test.svg"),
    });
    await statusOnly("POST", "/api/admin/uploads", 415, {
      cookie: adminCookie,
      form: photoForm(svg, "image/png"),
    });
    await statusOnly("POST", "/api/admin/uploads", 415, {
      cookie: adminCookie,
      form: photoForm(png, "image/jpeg", "test.jpg"),
    });
    await statusOnly("POST", "/api/admin/uploads", 413, {
      cookie: adminCookie,
      form: photoForm(new Uint8Array(5 * 1024 * 1024 + 1)),
    });
  });
  await test("unpublished media is available only to an administrator", async () => {
    await statusOnly("GET", media.url, 404);
    await statusOnly("GET", media.url, 404, { cookie: memberCookie });
    await statusOnly("GET", media.url, 200, { cookie: adminCookie });
    await statusOnly(
      "GET",
      `/_next/image?url=${encodeURIComponent(media.url)}&w=640&q=75`,
      400,
      { cookie: adminCookie },
    );
  });

  let post: Post;
  await test("administrator creates and retrieves an image-backed draft", async () => {
    const body = {
      title: `Демонстрация интеграционного теста ${tag}`,
      content: `${marker}\nДемонстрационный материал автоматической проверки.\n${hostile}`,
      categoryId: category.id,
      imageIds: [media.id],
      status: "DRAFT",
    };
    post = (
      await json<{ post: Post }>(
        await expect("POST", "/api/admin/posts", 201, {
          cookie: adminCookie,
          json: body,
        }),
      )
    ).post;
    assert(
      post.status === "DRAFT" &&
        post.version === 1 &&
        post.publishedAt === null &&
        post.images[0]?.id === media.id,
      "Draft creation did not persist the expected state.",
    );
    const saved = (
      await json<{ post: Post }>(
        await expect("GET", `/api/admin/posts/${post.id}`, 200, {
          cookie: adminCookie,
        }),
      )
    ).post;
    assert(
      saved.content === body.content,
      "Draft text was not persisted exactly.",
    );
    const list = await json<{ posts: Post[]; total: number }>(
      await expect(
        "GET",
        `/api/admin/posts?q=${encodeURIComponent(marker)}&status=DRAFT`,
        200,
        { cookie: adminCookie },
      ),
    );
    assert(
      list.total === 1 && list.posts[0]?.id === post.id,
      "Draft list/search does not find the saved publication.",
    );
  });
  await test("draft text and media do not leak through public pages", async () => {
    await statusOnly("GET", `/news/${post.slug}`, 404);
    await statusOnly("GET", `/news/${post.slug}`, 404, { cookie: adminCookie });
    const home = await expect("GET", "/", 200);
    assert(
      !(await home.text()).includes(marker),
      "Draft content leaked into the home page.",
    );
    await statusOnly("GET", media.url, 404);
  });
  await test("authenticated mutations require the correct Origin and reject cross-site requests", async () => {
    const rejectedName = `${categoryName} csrf`;
    categoryNames.add(rejectedName);
    const operations: [string, string, unknown][] = [
      [
        "POST",
        "/api/admin/posts",
        {
          title: `Demo CSRF ${tag}`,
          content: marker,
          categoryId: category.id,
          imageIds: [],
          status: "DRAFT",
        },
      ],
      [
        "PATCH",
        `/api/admin/posts/${post.id}`,
        { version: post.version, title: `Demo CSRF ${tag}` },
      ],
      ["DELETE", `/api/admin/posts/${post.id}`, { version: post.version }],
      ["POST", "/api/admin/categories", { name: rejectedName }],
      ["PATCH", `/api/admin/categories/${category.id}`, { name: rejectedName }],
      ["DELETE", `/api/admin/categories/${category.id}`, {}],
    ];
    for (const options of [
      { origin: null },
      { origin: "https://untrusted.example.invalid" },
      { headers: { "Sec-Fetch-Site": "cross-site" } },
    ]) {
      for (const [method, route, body] of operations)
        await statusOnly(method, route, 403, {
          cookie: adminCookie,
          json: body,
          ...options,
        });
      await statusOnly("POST", "/api/admin/uploads", 403, {
        cookie: adminCookie,
        form: photoForm(png),
        ...options,
      });
    }
    await statusOnly("POST", "/api/auth/sign-out", 403, {
      cookie: adminCookie,
      json: {},
      origin: null,
    });
    await statusOnly("POST", "/api/auth/sign-in/email", 403, {
      json: { email: admin.email, password },
      origin: "https://untrusted.example.invalid",
    });
  });
  await test("validation prevents invalid publications and deleting an occupied category", async () => {
    await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 400, {
      cookie: adminCookie,
      json: { version: post.version, title: "x".repeat(181) },
    });
    await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 400, {
      cookie: adminCookie,
      json: { version: post.version, unexpected: "field" },
    });
    await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 400, {
      cookie: adminCookie,
      json: { version: post.version, title: "", content: "", imageIds: [], videoIds: [], videoUrl: null, status: "PUBLISHED" },
    });
    await statusOnly("DELETE", `/api/admin/categories/${category.id}`, 409, {
      cookie: adminCookie,
      json: {},
    });
  });
  await test("single-character and photo-only publications retain optional text fields", async () => {
    for (const input of [
      { title: "x", content: "", imageIds: [] as string[] },
      { title: "", content: "x", imageIds: [] as string[] },
      { title: "", content: "", imageIds: [media.id] },
    ]) {
      const { post: small } = await json<{ post: Post }>(await expect("POST", "/api/admin/posts", 201, { cookie: adminCookie, json: { ...input, categoryId: category.id, status: "PUBLISHED", sourceName: `Демонстрационный тест ${tag}` } }));
      assert(small.title === input.title && small.content === input.content && small.status === "PUBLISHED" && small.images.length === input.imageIds.length, "Optional publication text was rejected or replaced unexpectedly.");
      await statusOnly("GET", `/news/${small.slug}`, 200);
      await statusOnly("DELETE", `/api/admin/posts/${small.id}`, 200, { cookie: adminCookie, json: { version: small.version } });
    }
  });
  await test("draft editing persists changes and rejects stale edits and deletions", async () => {
    const staleVersion = post.version;
    const newTitle = `Демонстрация: обновлённый тест ${tag}`;
    post = (
      await json<{ post: Post }>(
        await expect("PATCH", `/api/admin/posts/${post.id}`, 200, {
          cookie: adminCookie,
          json: { version: staleVersion, title: newTitle },
        }),
      )
    ).post;
    assert(
      post.version === staleVersion + 1 && post.title === newTitle,
      "Editing must save text and increment the version.",
    );
    await statusOnly("PATCH", `/api/admin/posts/${post.id}`, 409, {
      cookie: adminCookie,
      json: { version: staleVersion, title: "Stale edit must fail" },
    });
    await statusOnly("DELETE", `/api/admin/posts/${post.id}`, 409, {
      cookie: adminCookie,
      json: { version: staleVersion },
    });
    const saved = (
      await json<{ post: Post }>(
        await expect("GET", `/api/admin/posts/${post.id}`, 200, {
          cookie: adminCookie,
        }),
      )
    ).post;
    assert(
      saved.title === newTitle && saved.version === post.version,
      "A stale request changed the publication.",
    );
  });
  await test("publishing displays the article with hostile text safely escaped", async () => {
    post = (
      await json<{ post: Post }>(
        await expect("PATCH", `/api/admin/posts/${post.id}`, 200, {
          cookie: adminCookie,
          json: { version: post.version, status: "PUBLISHED" },
        }),
      )
    ).post;
    assert(
      post.status === "PUBLISHED" && post.publishedAt,
      "Publication status/date were not saved.",
    );
    const article = await expect("GET", `/news/${post.slug}`, 200);
    const html = await article.text();
    assert(
      html.includes(marker),
      "Published article does not contain its text.",
    );
    assert(
      html.includes("&lt;script&gt;") &&
        !html.includes("<script>globalThis.__kineshma_test_xss") &&
        !html.includes('<img src=x onerror="alert(1)">'),
      "Publication text was inserted as executable HTML.",
    );
    const home = await expect("GET", "/", 200);
    assert(
      (await home.text()).includes(marker),
      "Published article is missing from the home page.",
    );
  });
  await test("published media is public but excluded from Next.js image caching", async () => {
    const response = await expect("GET", media.url, 200);
    assert(
      response.headers.get("content-type") === "image/webp" &&
        response.headers.get("cache-control")?.includes("no-store"),
      "Published media must retain safe no-store headers.",
    );
    await response.arrayBuffer();
    await statusOnly(
      "GET",
      `/_next/image?url=${encodeURIComponent(media.url)}&w=640&q=75`,
      400,
    );
  });
  await test("unpublishing immediately hides the article and its image", async () => {
    post = (
      await json<{ post: Post }>(
        await expect("PATCH", `/api/admin/posts/${post.id}`, 200, {
          cookie: adminCookie,
          json: { version: post.version, status: "UNPUBLISHED" },
        }),
      )
    ).post;
    assert(post.status === "UNPUBLISHED", "Unpublish status was not saved.");
    await statusOnly("GET", `/news/${post.slug}`, 404);
    await statusOnly("GET", media.url, 404);
    await statusOnly("GET", media.url, 200, { cookie: adminCookie });
    const home = await expect("GET", "/", 200);
    assert(
      !(await home.text()).includes(marker),
      "Unpublished text remains on the home page.",
    );
  });
  await test("administrator deletes a publication and its now-empty category", async () => {
    await statusOnly("DELETE", `/api/admin/posts/${post.id}`, 200, {
      cookie: adminCookie,
      json: { version: post.version },
    });
    await statusOnly("GET", `/api/admin/posts/${post.id}`, 404, {
      cookie: adminCookie,
    });
    assert(
      (await scriptDb.post.count({ where: { id: post.id } })) === 0,
      "Deleted publication remains in the database.",
    );
    await statusOnly("DELETE", `/api/admin/categories/${category.id}`, 200, {
      cookie: adminCookie,
      json: {},
    });
    assert(
      (await scriptDb.category.count({ where: { id: category.id } })) === 0,
      "Deleted category remains in the database.",
    );
  });
  await test("logout revokes the old session on the server", async () => {
    await restoreModerationSettings();
    await statusOnly("POST", "/api/auth/sign-out", 200, {
      cookie: adminCookie,
      json: {},
    });
    for (const [method, route] of protectedRoutes)
      await statusOnly(method, route, 401, {
        cookie: adminCookie,
        ...(method === "GET" ? {} : { json: {} }),
      });
    assert(
      (await scriptDb.session.count({ where: { userId: admin.id } })) === 0,
      "Logout did not delete the administrator session.",
    );
  });
  await test("persisted login throttling survives changing X-Forwarded-For", async () => {
    let throttled = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const response = await request("POST", "/api/auth/sign-in/email", {
        json: { email: limitedEmail, password },
        headers: { "X-Forwarded-For": `203.0.113.${attempt}` },
      });
      assert(
        [401, 429].includes(response.status),
        `Invalid login should be rejected or throttled, received ${response.status}`,
      );
      await response.arrayBuffer();
      if (response.status === 429) {
        throttled = true;
        break;
      }
    }
    assert(throttled, "Repeated failed logins were not throttled.");
    const key = `login:${createHash("sha256").update(limitedEmail).digest("hex")}`;
    const persisted = await scriptDb.actionLimit.findUnique({ where: { key } });
    assert(
      persisted && persisted.count > 8,
      "The per-email throttle was not persisted in PostgreSQL.",
    );
    await statusOnly("POST", "/api/auth/sign-in/email", 429, {
      json: { email: limitedEmail, password },
      headers: { "X-Forwarded-For": "198.51.100.250" },
    });
  });
}

async function cleanup() {
  // The full random UUID in each email also covers a signup regression: if the
  // disabled endpoint unexpectedly creates a different user id, clean up that
  // exact test identity before reporting the security failure.
  const fixtureEmails = fixtureUsers.map(({ email }) => email);
  const ownedUsers = await scriptDb.user.findMany({
    where: { email: { in: fixtureEmails } },
    select: { id: true },
  });
  const ids = ownedUsers.map(({ id }) => id);
  const media = await scriptDb.mediaAsset.findMany({
    where: { uploadedById: { in: ids } },
    select: { id: true, filename: true },
  });
  await scriptDb.post.deleteMany({ where: { authorId: { in: ids } } });
  // The database record establishes ownership; the name/path checks prevent a
  // bad filename or symlink from turning fixture cleanup into an arbitrary delete.
  for (const asset of media) {
    assert(
      /^[a-f0-9-]{36}$/.test(asset.id) && asset.filename === `${asset.id}.webp`,
      "Refusing to clean up an unexpected media filename.",
    );
    const file = path.resolve(uploadDirectory, asset.filename);
    assert(
      path.dirname(file) === uploadDirectory,
      "Refusing to clean up a file outside UPLOAD_DIR.",
    );
    try {
      const info = await lstat(file);
      assert(
        info.isFile() && !info.isSymbolicLink(),
        "Refusing to clean up an unexpected filesystem entry.",
      );
      const [actualDirectory, actualFile] = await Promise.all([
        realpath(uploadDirectory),
        realpath(file),
      ]);
      assert(
        path.dirname(actualFile) === actualDirectory,
        "Refusing to clean up a file outside the resolved UPLOAD_DIR.",
      );
      await unlink(file);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
  }
  await scriptDb.mediaAsset.deleteMany({
    where: { uploadedById: { in: ids } },
  });
  await scriptDb.category.deleteMany({
    where: { name: { in: [...categoryNames] }, posts: { none: {} } },
  });
  const ownLimits = [
    ...fixtureUsers.map(({ id }) => `uploads:${id}`),
    ...[admin.email, member.email, limitedEmail].map(
      (email) => `login:${createHash("sha256").update(email).digest("hex")}`,
    ),
  ];
  await scriptDb.actionLimit.deleteMany({ where: { key: { in: ownLimits } } });
  // Do not touch shared/global counters or anyone else's sessions or records.
  await scriptDb.user.deleteMany({
    where: { id: { in: ids }, email: { in: fixtureEmails } },
  });
  assert(
    (await scriptDb.post.count({ where: { authorId: { in: ids } } })) === 0,
    "Test publications remain after cleanup.",
  );
  assert(
    (await scriptDb.mediaAsset.count({
      where: { uploadedById: { in: ids } },
    })) === 0,
    "Test media records remain after cleanup.",
  );
  assert(
    (await scriptDb.category.count({
      where: { name: { in: [...categoryNames] } },
    })) === 0,
    "Test categories remain after cleanup.",
  );
  assert(
    (await scriptDb.user.count({ where: { email: { in: fixtureEmails } } })) ===
      0,
    "Test identities remain after cleanup.",
  );
  console.log(
    "PASS cleanup: temporary users, publications, categories, media files, and owned limits removed.",
  );
}

try {
  await main();
  console.log(
    `All ${passed} administrator integration/security checks passed.`,
  );
} catch (error) {
  const detail =
    error instanceof TestFailure
      ? error.message
      : "Unexpected test or database error; details suppressed to protect local credentials.";
  console.error(`FAIL ${activeTest}: ${detail}`);
  process.exitCode = 1;
} finally {
  try { await restoreModerationSettings(); }
  catch (error) { console.error(error instanceof TestFailure ? `FAIL settings restore: ${error.message}` : "FAIL settings restore: could not restore the original preferences."); process.exitCode = 1; }
  try {
    await cleanup();
  } catch (error) {
    console.error(
      error instanceof TestFailure
        ? `FAIL cleanup: ${error.message}`
        : "FAIL cleanup: could not finish removing this run's fixtures; credentials suppressed.",
    );
    process.exitCode = 1;
  }
  await scriptDb.$disconnect();
}
