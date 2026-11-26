import { randomUUID, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { scriptDb } from "./script-db";

async function main() {
  const initial = process.argv.includes("--initial");
  let email: string;
  let name: string;
  if (initial) {
    if (await scriptDb.user.count({ where: { role: "admin" } }))
      throw new Error(
        "Администратор уже существует. Начальная учётная запись не изменена.",
      );
    email = "admin@my-kineshma.local";
    name = "Редактор";
  } else {
    const input = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    try {
      email = (await input.question("Почта для входа: ")).trim().toLowerCase();
      name = (await input.question("Имя редактора: ")).trim();
    } finally {
      input.close();
    }
  }
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    name.length < 2 ||
    name.length > 100
  )
    throw new Error("Проверьте почту и имя.");
  if (await scriptDb.user.findUnique({ where: { email } }))
    throw new Error("Аккаунт с этой почтой уже существует.");
  const id = randomUUID();
  const password = randomBytes(24).toString("base64url");
  const directory = path.resolve("storage/private");
  await mkdir(directory, { recursive: true });
  const credentialFile = path.join(
    directory,
    initial ? "first-admin.txt" : `admin-${id}.txt`,
  );
  // The generated password is written to a local ignored file, never to stdout or arguments.
  await writeFile(
    credentialFile,
    `Моя Кинешма — доступ администратора\n\nАдрес: ${process.env.APP_URL}/admin/login\nПочта: ${email}\nПароль: ${password}\n\nФайл содержит пароль. Храните его только на своём компьютере.\nВ базе хранится только хеш пароля.\nДля смены пароля: npm.cmd run admin:reset\n`,
    { flag: "wx", mode: 0o600 },
  );
  const hash = await hashPassword(password);
  await scriptDb.$transaction(async (tx) => {
    await tx.user.create({
      data: { id, name, email, role: "admin", emailVerified: false },
    });
    await tx.account.create({
      data: {
        id: randomUUID(),
        userId: id,
        accountId: id,
        providerId: "credential",
        password: hash,
      },
    });
  });
  console.log(
    `Администратор создан. Данные для входа сохранены только в локальном файле: ${credentialFile}`,
  );
}
main()
  .catch((error) => {
    console.error(
      error instanceof Error && !error.message.includes("prisma")
        ? error.message
        : "Не удалось создать администратора. Проверьте подключение к базе.",
    );
    process.exitCode = 1;
  })
  .finally(() => scriptDb.$disconnect());
