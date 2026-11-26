import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { scriptDb } from "./script-db";

async function main() {
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let email: string;
  try {
    email = (await input.question("Почта администратора для смены пароля: "))
      .trim()
      .toLowerCase();
  } finally {
    input.close();
  }
  const user = await scriptDb.user.findUnique({ where: { email } });
  if (!user || user.role !== "admin")
    throw new Error("Администратор не найден.");
  const password = randomBytes(24).toString("base64url");
  const hash = await hashPassword(password);
  const directory = path.resolve("storage/private");
  await mkdir(directory, { recursive: true });
  const file = path.join(directory, `password-reset-${Date.now()}.txt`);
  await writeFile(
    file,
    `Адрес: ${process.env.APP_URL}/admin/login\nПочта: ${email}\nНовый пароль: ${password}\n`,
    { flag: "wx", mode: 0o600 },
  );
  await scriptDb.$transaction(async (tx) => {
    await tx.account.update({
      where: {
        providerId_accountId: { providerId: "credential", accountId: user.id },
      },
      data: { password: hash },
    });
    await tx.session.deleteMany({ where: { userId: user.id } });
  });
  console.log(
    `Пароль обновлён, все сессии этого администратора завершены. Новый пароль: ${file}`,
  );
}
main()
  .catch(() => {
    console.error(
      "Не удалось сменить пароль. Проверьте почту администратора и доступность базы.",
    );
    process.exitCode = 1;
  })
  .finally(() => scriptDb.$disconnect());
