import { createHash, randomBytes, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import mediaInfoFactory from "mediainfo.js";
import sharp from "sharp";
import { scriptDb } from "./script-db";

// Browser QA helpers only. Never print credentials, cookies, connection strings
// or unrelated content. All deletion is bounded by this private ownership record.
const base = new URL(process.env.APP_URL || "http://127.0.0.1:3000");
const workspace = path.resolve(".");
const privateDirectory = path.join(workspace, "storage", "private");
const fixturePath = path.join(privateDirectory, "community-ui-fixture.json");
const photoPath = path.join(privateDirectory, "community-ui-photo.png");
const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || "./storage/uploads");
const protectedPosts = new Set(["a89434a7-6f03-4b69-a5bd-dd70201c2f0a"]);
const protectedSubmissions = new Set(["289db0cc-3a93-4133-90b1-313d9ecd83f5"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const checksum = /^[a-f0-9]{64}$/;

type Settings = { commentsModerationEnabled: boolean; postsModerationEnabled: boolean; defaultCategoryId: string | null; version: number };
type OwnedMedia = { id: string; filename: string; sha256: string; byteSize: number; kind: "IMAGE" | "VIDEO"; prepared: boolean };
type OwnedSubmission = { id: string; receiptKey: string; proof: "unique-photo" | "text-marker"; postId: string | null };
type OwnedPost = { id: string; slug: string; prepared: boolean; submissionId: string | null };
type Fixture = {
  format: 1; runId: string; marker: string; startedAt: string; origin: string; uploadDirectory: string;
  state: "preparing" | "prepared" | "cleaned" | "cleanup-partial";
  moderator: { id: string; email: string; name: string; password?: string };
  category: { id: string; name: string };
  photo: { path: string; pngHash: string; processedHash: string; processedBytes: number };
  posts: OwnedPost[]; submissions: OwnedSubmission[]; media: OwnedMedia[];
  commentIds: string[]; commentReceiptKeys: string[];
  originalSettings: Settings; recordedSettings: Settings;
  lastCollectedAt?: string; cleanedAt?: string; warnings?: string[];
};
class FixtureError extends Error {}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new FixtureError(message); }
function hash(data: Buffer) { return createHash("sha256").update(data).digest("hex"); }
function errorCode(error: unknown) { return error && typeof error === "object" && "code" in error ? error.code : undefined; }
function snapshot(value: Settings): Settings { return { commentsModerationEnabled: value.commentsModerationEnabled, postsModerationEnabled: value.postsModerationEnabled, defaultCategoryId: value.defaultCategoryId, version: value.version }; }
function sameChoices(a: Settings, b: Settings) { return a.commentsModerationEnabled === b.commentsModerationEnabled && a.postsModerationEnabled === b.postsModerationEnabled && a.defaultCategoryId === b.defaultCategoryId; }
function hasMarker(content: string, marker: string) { return content === marker || content.startsWith(`${marker} `) || content.startsWith(`${marker}\n`) || content.startsWith(`${marker}\r\n`); }
function mediaPath(filename: string) {
  assert(/^[a-f0-9-]{36}\.(webp|mp4|webm)$/.test(filename), "Unexpected media filename; operation refused.");
  const target = path.resolve(uploadDirectory, filename);
  assert(path.dirname(target) === uploadDirectory, "Media target escaped the configured upload directory.");
  return target;
}
async function safeFileHash(filename: string) {
  const target = mediaPath(filename);
  try {
    const info = await lstat(target);
    assert(info.isFile() && !info.isSymbolicLink() && info.size <= 50 * 1024 * 1024, "Unexpected runtime media file; operation refused.");
    const [actualRoot, actualParent] = await Promise.all([realpath(uploadDirectory), realpath(path.dirname(target))]);
    assert(actualRoot === actualParent, "Media parent is outside the configured runtime directory.");
    return hash(await readFile(target));
  } catch (error) { if (errorCode(error) === "ENOENT") return null; throw error; }
}
async function save(fixture: Fixture, exclusive = false) {
  await writeFile(fixturePath, JSON.stringify(fixture, null, 2), { flag: exclusive ? "wx" : "w", mode: 0o600 });
}
async function load() {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as Fixture;
  assert(fixture.format === 1 && uuid.test(fixture.runId) && fixture.marker === `UI_COMMUNITY_${fixture.runId}`, "Invalid fixture identity.");
  assert(fixture.origin === base.origin && fixture.uploadDirectory === uploadDirectory && fixture.photo.path === photoPath, "Fixture belongs to a different local environment.");
  assert(Number.isFinite(Date.parse(fixture.startedAt)) && uuid.test(fixture.category.id) && fixture.category.name === "Город", "Invalid fixture start/category.");
  assert(uuid.test(fixture.moderator.id) && fixture.moderator.email === `community-ui-${fixture.runId}@example.invalid` && fixture.moderator.name === "Тестовый модератор интерфейса", "Unexpected moderator identity.");
  assert([fixture.photo.pngHash, fixture.photo.processedHash].every(value => checksum.test(value)), "Invalid fixture image fingerprints.");
  assert(Array.isArray(fixture.posts) && Array.isArray(fixture.submissions) && Array.isArray(fixture.media), "Invalid fixture record lists.");
  for (const post of fixture.posts) assert(uuid.test(post.id) && !protectedPosts.has(post.id) && (!post.submissionId || uuid.test(post.submissionId)), "A protected or invalid post appeared in fixture records.");
  for (const submission of fixture.submissions) assert(uuid.test(submission.id) && !protectedSubmissions.has(submission.id) && uuid.test(submission.receiptKey), "A protected or invalid submission appeared in fixture records.");
  for (const asset of fixture.media) assert(uuid.test(asset.id) && asset.filename.startsWith(`${asset.id}.`) && checksum.test(asset.sha256), "Invalid owned media proof.");
  for (const settings of [fixture.originalSettings, fixture.recordedSettings]) assert(typeof settings.commentsModerationEnabled === "boolean" && typeof settings.postsModerationEnabled === "boolean" && Number.isInteger(settings.version) && settings.version > 0 && (!settings.defaultCategoryId || uuid.test(settings.defaultCategoryId)), "Invalid settings snapshot.");
  return fixture;
}
function printLocations(fixture: Fixture) {
  console.log(`Fixture file: ${fixturePath}`);
  console.log(`Photo file: ${photoPath}`);
  console.log(`Text marker: ${fixture.marker}`);
  for (const post of fixture.posts) console.log(`Publication: ${new URL(`/news/${post.slug}`, base).href}`);
}
async function convertImage(input: Buffer) {
  return sharp(input, { limitInputPixels: 20_000_000, failOn: "error", animated: false }).rotate().resize({ width: 1920, height: 1920, fit: "inside", withoutEnlargement: true }).webp({ quality: 84 }).toBuffer({ resolveWithObject: true });
}

async function prepare() {
  try { await lstat(fixturePath); throw new FixtureError("Fixture helper already exists. Inspect it; existing recovery records are never overwritten by prepare."); }
  catch (error) { if (errorCode(error) !== "ENOENT") throw error; }
  const [category, settings] = await Promise.all([
    scriptDb.category.findUnique({ where: { name: "Город" }, select: { id: true, name: true } }),
    scriptDb.siteSettings.findUnique({ where: { id: "main" } }),
  ]);
  assert(category && settings, "An existing Город category and site settings are required.");
  const runId = randomUUID(); const marker = `UI_COMMUNITY_${runId}`; const startedAt = new Date().toISOString();
  const moderator = { id: randomUUID(), email: `community-ui-${runId}@example.invalid`, name: "Тестовый модератор интерфейса", password: randomBytes(32).toString("base64url") };
  const roots = [randomUUID(), randomUUID(), randomUUID()]; const replyId = randomUUID();
  const richPost = { id: randomUUID(), slug: `community-ui-rich-${runId}`, prepared: true, submissionId: null };
  const videoPost = { id: randomUUID(), slug: `community-ui-video-${runId}`, prepared: true, submissionId: null };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600"><rect width="960" height="600" fill="#edf3f8"/><rect x="30" y="30" width="900" height="540" rx="24" fill="#ffffff" stroke="#d05050" stroke-width="8"/><text x="480" y="190" text-anchor="middle" font-family="Arial" font-size="100" font-weight="bold" fill="#a63131">TEST</text><text x="480" y="290" text-anchor="middle" font-family="Arial" font-size="36" fill="#233c59">UI PHOTO — NOT NEWS</text><text x="480" y="400" text-anchor="middle" font-family="Arial" font-size="23" fill="#526c88">${marker}</text><text x="480" y="480" text-anchor="middle" font-family="Arial" font-size="25" fill="#526c88">Temporary image for browser QA</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const expected = await convertImage(png);
  const assets: { record: OwnedMedia; data: Buffer; width: number; height: number; duration: number | null; alt: string; mimeType: string }[] = [];
  for (const name of ["city-panorama.jpg", "city-center.jpg", "city-river.jpg"]) {
    const output = await convertImage(await readFile(path.join(workspace, "public", "images", name)));
    const id = randomUUID();
    assets.push({ record: { id, filename: `${id}.webp`, sha256: hash(output.data), byteSize: output.data.length, kind: "IMAGE", prepared: true }, data: output.data, width: output.info.width, height: output.info.height, duration: null, alt: "Тестовая фотография интерфейса: вид Кинешмы, не иллюстрация новости", mimeType: "image/webp" });
  }
  const videoBytes = await readFile(path.join(workspace, "tests", "fixtures", "flower.mp4"));
  const parser = await mediaInfoFactory({ format: "object", full: false });
  let playback: { width: number; height: number; duration: number };
  try {
    const data = await parser.analyzeData(videoBytes.length, (size, offset) => videoBytes.subarray(offset, offset + size));
    const video = data.media?.track.find(track => track["@type"] === "Video");
    const general = data.media?.track.find(track => track["@type"] === "General");
    playback = { width: Number(video?.Width), height: Number(video?.Height), duration: Number(general?.Duration ?? video?.Duration) };
    assert(video?.Format === "AVC" && playback.width > 0 && playback.height > 0 && playback.duration > 0, "The known MP4 fixture could not be inspected.");
  } finally { parser.close(); }
  const videoId = randomUUID();
  assets.push({ record: { id: videoId, filename: `${videoId}.mp4`, sha256: hash(videoBytes), byteSize: videoBytes.length, kind: "VIDEO", prepared: true }, data: videoBytes, ...playback, alt: "Видео для проверки — не новость. Образец MDN CC0", mimeType: "video/mp4" });
  const fixture: Fixture = {
    format: 1, runId, marker, startedAt, origin: base.origin, uploadDirectory, state: "preparing", moderator, category,
    photo: { path: photoPath, pngHash: hash(png), processedHash: hash(expected.data), processedBytes: expected.data.length },
    posts: [richPost, videoPost], submissions: [], media: assets.map(item => item.record), commentIds: [...roots, replyId], commentReceiptKeys: [],
    originalSettings: snapshot(settings), recordedSettings: snapshot(settings),
  };
  await mkdir(privateDirectory, { recursive: true });
  await save(fixture, true);
  try {
    await writeFile(photoPath, png, { flag: "wx", mode: 0o600 });
    await mkdir(uploadDirectory, { recursive: true });
    for (const asset of assets) await writeFile(mediaPath(asset.record.filename), asset.data, { flag: "wx" });
    const passwordHash = await hashPassword(moderator.password);
    const paragraphs = [
      `${marker}\nТЕСТОВАЯ ПУБЛИКАЦИЯ. Это запись для проверки нового интерфейса, а не реальная новость Кинешмы. После проверки она и временные комментарии будут удалены.`,
      "Здесь проверяется длинный текст публикации. На первом экране видна только его начальная часть, а кнопка «Показать ещё» раскрывает продолжение без перехода на отдельную страницу. Никаких заявлений о событиях, решениях городских служб или расписаниях этот текст не содержит.",
      "Следующий абзац нужен для проверки удобства чтения. Важно, чтобы строки не растягивались слишком широко, расстояния между ними оставались спокойными, а на телефоне текст помещался в карточку без горизонтальной прокрутки. Этот материал намеренно подписан как тестовый и не предназначен для информирования жителей о текущих событиях.",
      "К записи прикреплены три фотографии из уже используемых материалов оформления сайта. Они позволяют проверить сетку изображений, сохранение пропорций и перелистывание в галерее. Сами изображения не подтверждают никакую новость: в этом сценарии они являются только образцами для визуальной проверки.",
      "Под карточкой находятся настоящие тестовые комментарии, которые хранятся в базе временно. Можно раскрыть обсуждение, написать ответ, поставить и снять лайк, а затем проверить изменение состояния. Все действия выполняются именно с этой явно помеченной записью, а пользовательские материалы остаются вне проверки.",
      "Завершение проверочного текста. Эта часть подтверждает, что раскрытие длинной записи показывает все абзацы, а элементы управления и комментарии продолжают относиться к одной публикации. После завершения проверки специальная команда удалит только записи, принадлежащие этому тестовому запуску.",
    ];
    const content = paragraphs.join("\n\n");
    assert(content.length > 900, "Long text fixture is unexpectedly short.");
    await scriptDb.$transaction(async tx => {
      await tx.user.create({ data: { id: moderator.id, email: moderator.email, name: moderator.name, role: "admin", accounts: { create: { id: randomUUID(), accountId: moderator.id, providerId: "credential", password: passwordHash } } } });
      for (const asset of assets) await tx.mediaAsset.create({ data: { id: asset.record.id, filename: asset.record.filename, byteSize: asset.record.byteSize, kind: asset.record.kind, width: asset.width, height: asset.height, duration: asset.duration, alt: asset.alt, mimeType: asset.mimeType, uploadedById: moderator.id } });
      await tx.post.create({ data: { id: richPost.id, slug: richPost.slug, title: "ТЕСТ: публикация, галерея и обсуждение", content, excerpt: "Тестовая запись интерфейса. Это не реальная новость Кинешмы.", authorId: moderator.id, categoryId: category.id, status: "PUBLISHED", publishedAt: new Date(), images: { create: assets.slice(0, 3).map((asset, order) => ({ mediaId: asset.record.id, order })) } } });
      await tx.post.create({ data: { id: videoPost.id, slug: videoPost.slug, title: "Видео для проверки — не новость", content: `${marker}\nЭто тестовая публикация видеоплеера. Короткое видео цветов — образец MDN CC0, не событие Кинешмы.\nИсточник: https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4`, excerpt: "Тест видеоплеера. Образец MDN CC0 — не новость Кинешмы.", authorId: moderator.id, categoryId: category.id, status: "PUBLISHED", publishedAt: new Date(Date.now() - 1000), images: { create: { mediaId: videoId, order: 0 } } } });
      for (const [index, id] of roots.entries()) await tx.comment.create({ data: { id, postId: richPost.id, displayName: `Тестовый читатель ${index + 1}`, content: `${marker}\nТестовый комментарий ${index + 1}. Проверяем чтение, ответы и лайки. Это подготовленный сценарий, не мнение настоящего посетителя.`, status: "APPROVED", createdAt: new Date(Date.now() - (4 - index) * 1000) } });
      await tx.comment.create({ data: { id: replyId, postId: richPost.id, parentId: roots[0], displayName: "Тестовый собеседник", content: `${marker}\nТестовый ответ: проверяем один уровень вложенности.`, status: "APPROVED" } });
    });
    fixture.state = "prepared";
    await save(fixture);
    printLocations(fixture);
  } catch (error) {
    try { await cleanup(fixture); } catch { /* Recovery record remains available. */ }
    throw error;
  }
}

async function collect(fixture: Fixture, persist = true) {
  assert(fixture.state !== "cleaned", "This fixture has already been cleaned.");
  const since = new Date(fixture.startedAt);
  const known = new Map(fixture.submissions.map(item => [item.id, item]));
  const candidates = await scriptDb.submission.findMany({
    where: { OR: [{ id: { in: [...known.keys()] } }, { createdAt: { gte: since }, content: { startsWith: fixture.marker } }, { createdAt: { gte: since }, title: "", content: "", images: { some: { media: { kind: "IMAGE", byteSize: fixture.photo.processedBytes } } } }] },
    take: 501,
    include: { images: { include: { media: true } }, post: { select: { id: true, slug: true, createdAt: true } } },
  });
  assert(candidates.length <= 500, "Too many fixture candidates; refusing broad collection.");
  for (const submission of candidates) {
    if (protectedSubmissions.has(submission.id) || (submission.postId && protectedPosts.has(submission.postId))) continue;
    const previous = known.get(submission.id);
    if (previous) assert(previous.receiptKey === submission.receiptKey, "A recorded submission changed identity.");
    let proof = previous?.proof;
    if (!proof && submission.createdAt >= since && hasMarker(submission.content, fixture.marker)) proof = "text-marker";
    if (!proof && submission.createdAt >= since && !submission.title && !submission.content && submission.images.length === 1) {
      const media = submission.images[0].media;
      if (media.kind === "IMAGE" && media.mimeType === "image/webp" && media.byteSize === fixture.photo.processedBytes && await safeFileHash(media.filename) === fixture.photo.processedHash) proof = "unique-photo";
    }
    if (!proof) continue;
    const owned: OwnedSubmission = { id: submission.id, receiptKey: submission.receiptKey, proof, postId: submission.postId };
    known.set(owned.id, owned);
    for (const { media } of submission.images) {
      if (fixture.media.some(item => item.id === media.id)) continue;
      const digest = await safeFileHash(media.filename);
      assert(digest, "An owned submission attachment is missing before collection.");
      fixture.media.push({ id: media.id, filename: media.filename, sha256: digest, byteSize: media.byteSize, kind: media.kind, prepared: false });
    }
    if (submission.post && !fixture.posts.some(post => post.id === submission.post!.id)) {
      assert(submission.post.createdAt >= since, "A fixture submission links to a pre-existing publication.");
      fixture.posts.push({ id: submission.post.id, slug: submission.post.slug, prepared: false, submissionId: submission.id });
    }
  }
  fixture.submissions = [...known.values()];
  const postIds = fixture.posts.map(post => post.id);
  const [comments, receipts] = await Promise.all([
    scriptDb.comment.findMany({ where: { postId: { in: postIds } }, select: { id: true } }),
    scriptDb.commentReceipt.findMany({ where: { postId: { in: postIds } }, select: { key: true } }),
  ]);
  fixture.commentIds = [...new Set([...fixture.commentIds, ...comments.map(item => item.id)])];
  fixture.commentReceiptKeys = [...new Set([...fixture.commentReceiptKeys, ...receipts.map(item => item.key)])];
  fixture.lastCollectedAt = new Date().toISOString();
  if (persist) await save(fixture);
  return fixture;
}

async function recordSettings(fixture: Fixture) {
  assert(fixture.state === "prepared", "Only an active fixture can record an explicitly tested settings state.");
  const current = await scriptDb.siteSettings.findUniqueOrThrow({ where: { id: "main" } });
  fixture.recordedSettings = snapshot(current);
  await save(fixture);
  console.log(`Recorded settings snapshot: ${fixturePath}`);
}

async function cleanup(fixture: Fixture) {
  if (fixture.state === "cleaned") { console.log(`Cleaned fixture: ${fixturePath}`); return; }
  const warnings: string[] = [];
  try { await collect(fixture); } catch { warnings.push("Collection was incomplete; only previously verified records are eligible for removal."); }
  const since = new Date(fixture.startedAt);
  const postIds: string[] = []; const submissionIds: string[] = [];
  for (const owned of fixture.posts) {
    assert(!protectedPosts.has(owned.id), "Refusing to remove a protected user publication.");
    const post = await scriptDb.post.findUnique({ where: { id: owned.id }, select: { id: true, slug: true, authorId: true, createdAt: true, submission: { select: { id: true, receiptKey: true } } } });
    if (!post) { postIds.push(owned.id); continue; }
    const submission = fixture.submissions.find(item => item.id === owned.submissionId);
    const valid = owned.prepared ? post.authorId === fixture.moderator.id && post.slug === owned.slug : Boolean(submission && (post.submission?.id === submission.id || !post.submission) && post.slug === owned.slug && post.createdAt >= since);
    if (valid) postIds.push(post.id); else warnings.push("A recorded publication changed ownership; it was left untouched.");
  }
  for (const owned of fixture.submissions) {
    assert(!protectedSubmissions.has(owned.id), "Refusing to remove a protected user submission.");
    const submission = await scriptDb.submission.findUnique({ where: { id: owned.id }, select: { receiptKey: true, createdAt: true, postId: true } });
    if (!submission || (submission.receiptKey === owned.receiptKey && submission.createdAt >= since && (!submission.postId || postIds.includes(submission.postId)))) submissionIds.push(owned.id);
    else warnings.push("A recorded submission changed identity or references an unrelated publication; it was left untouched.");
  }
  const removableFiles: OwnedMedia[] = [];
  await scriptDb.$transaction(async tx => {
    await tx.submission.deleteMany({ where: { id: { in: submissionIds } } });
    await tx.post.deleteMany({ where: { id: { in: postIds } } });
    await tx.submissionReceipt.deleteMany({ where: { key: { in: fixture.submissions.filter(item => submissionIds.includes(item.id)).map(item => item.receiptKey) }, submission: { is: null } } });
    for (const asset of fixture.media) {
      const row = await tx.mediaAsset.findUnique({ where: { id: asset.id }, select: { filename: true, uploadedById: true, posts: { select: { postId: true } }, submissions: { select: { submissionId: true } } } });
      if (!row) { removableFiles.push(asset); continue; }
      if (row.filename !== asset.filename || row.posts.length || row.submissions.length || (asset.prepared && row.uploadedById !== fixture.moderator.id)) {
        warnings.push("An attachment is still referenced or changed ownership; it was retained."); continue;
      }
      const removed = await tx.mediaAsset.deleteMany({ where: { id: asset.id, filename: asset.filename, posts: { none: {} }, submissions: { none: {} } } });
      if (removed.count) removableFiles.push(asset);
    }
    const user = await tx.user.findUnique({ where: { id: fixture.moderator.id }, select: { id: true, email: true, name: true, role: true, _count: { select: { posts: true, uploads: true, reviewedSubmissions: true } } } });
    if (user && user.email === fixture.moderator.email && user.name === fixture.moderator.name && user.role === "admin" && !user._count.posts && !user._count.uploads && !user._count.reviewedSubmissions) {
      await tx.user.delete({ where: { id: user.id } });
      await tx.actionLimit.deleteMany({ where: { key: `login:${createHash("sha256").update(fixture.moderator.email).digest("hex")}` } });
    } else if (user) warnings.push("The temporary moderator has unrelated or retained records; the account was not removed.");
    const current = await tx.siteSettings.findUnique({ where: { id: "main" } });
    if (current && !sameChoices(current, fixture.originalSettings)) {
      if (current.version === fixture.recordedSettings.version && sameChoices(current, fixture.recordedSettings)) {
        const restored = await tx.siteSettings.updateMany({ where: { id: "main", version: current.version }, data: { commentsModerationEnabled: fixture.originalSettings.commentsModerationEnabled, postsModerationEnabled: fixture.originalSettings.postsModerationEnabled, defaultCategoryId: fixture.originalSettings.defaultCategoryId, version: { increment: 1 } } });
        if (!restored.count) warnings.push("Settings changed concurrently; newer choices were not overwritten.");
      } else warnings.push("Settings changed after the recorded snapshot; newer choices were not overwritten. Record only changes explicitly made during this QA run.");
    }
  });
  for (const asset of removableFiles) {
    try {
      if (await scriptDb.mediaAsset.findUnique({ where: { filename: asset.filename }, select: { id: true } })) continue;
      const digest = await safeFileHash(asset.filename);
      if (digest === null) continue;
      if (digest !== asset.sha256) { warnings.push("A runtime file no longer matches its recorded checksum; it was retained."); continue; }
      await unlink(mediaPath(asset.filename));
    } catch { warnings.push("An owned runtime file could not be removed; retry cleanup after inspection."); }
  }
  const remaining = await Promise.all([
    scriptDb.post.count({ where: { id: { in: fixture.posts.map(post => post.id) } } }),
    scriptDb.submission.count({ where: { id: { in: fixture.submissions.map(item => item.id) } } }),
    scriptDb.mediaAsset.count({ where: { id: { in: fixture.media.map(asset => asset.id) } } }),
    scriptDb.user.count({ where: { id: fixture.moderator.id } }),
  ]);
  fixture.moderator.password = undefined;
  fixture.warnings = [...new Set(warnings)];
  fixture.state = remaining.some(Boolean) || warnings.length ? "cleanup-partial" : "cleaned";
  fixture.cleanedAt = new Date().toISOString();
  await save(fixture);
  console.log(`Cleanup record: ${fixturePath}`);
  if (warnings.length) { for (const warning of fixture.warnings) console.warn(warning); process.exitCode = 1; }
  assert(!remaining.some(Boolean), "Some verified fixture records remain; inspect the private recovery file. No unrelated records were removed.");
}

try {
  assert(["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) && base.pathname === "/" && !base.username && !base.password, "UI fixtures are restricted to a local APP_URL origin.");
  const commands = ["--prepare", "--collect", "--record-settings", "--cleanup"];
  const selected = commands.filter(command => process.argv.includes(command));
  if (process.argv.includes("--help") || !selected.length) {
    console.log("tsx scripts/community-ui-fixture.ts --prepare | --collect | --record-settings | --cleanup");
    console.log(`Private recovery file: ${fixturePath}`);
  } else {
    assert(selected.length === 1, "Choose exactly one fixture operation.");
    if (selected[0] === "--prepare") await prepare();
    else {
      const fixture = await load();
      if (selected[0] === "--collect") printLocations(await collect(fixture));
      else if (selected[0] === "--record-settings") await recordSettings(fixture);
      else await cleanup(fixture);
    }
  }
} catch (error) {
  console.error(error instanceof FixtureError ? error.message : "Fixture operation failed. Sensitive details suppressed; inspect the private recovery file if it exists.");
  process.exitCode = 1;
} finally { await scriptDb.$disconnect(); }
