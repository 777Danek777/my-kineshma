import { scriptDb } from "./script-db";

const initial = [
  ["Новости города", "novosti-goroda"],
  ["Происшествия", "proisshestviya"],
  ["Общество", "obschestvo"],
  ["Город", "gorod"],
  ["ЖКХ", "zhkh"],
  ["Транспорт", "transport"],
  ["Афиша", "afisha"],
  ["Спорт", "sport"],
  ["Объявления", "obyavleniya"],
];
try {
  // Never recreate categories an editor intentionally removed on subsequent runs.
  if ((await scriptDb.category.count()) === 0) {
    await scriptDb.category.createMany({
      data: initial.map(([name, slug]) => ({ name, slug })),
    });
    console.log(
      "Начальные категории созданы. Демонстрационные новости в базу не добавлялись.",
    );
  } else console.log("Категории уже есть; данные редакции сохранены.");
} finally {
  await scriptDb.$disconnect();
}
