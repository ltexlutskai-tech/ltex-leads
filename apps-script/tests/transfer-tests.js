const assert = require("assert");
const { makeEnv } = require("./transfer-harness.js");

// Рядок головної: [ID, дата, ПІБ, кат, обл, місто, тел, ... менеджер у 11-й]
function row(id, name, manager) {
  const r = new Array(19).fill("");
  r[0] = id; r[2] = name; r[6] = "0670000000"; r[10] = manager;
  return r;
}

const BASE = {
  files: { "Гуменюк Євген": ["A1", "A2", "A3"], "Захарчук Олександра": [] },
  main: [row("A1", "Рома", "Захарчук Олександра"),
         row("A2", "Галя", "Захарчук Олександра"),
         row("A3", "Надя", "Захарчук Олександра")],
};

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  ✓ " + name); }
  catch (e) { console.log("  ✗ " + name + "\n      " + e.message); process.exitCode = 1; }
}

function editEvent(env, rowNum, oldValue) {
  return {
    range: {
      getSheet: () => env.mainSheet,
      getColumn: () => 11, getLastColumn: () => 11,
      getRow: () => rowNum, getLastRow: () => rowNum,
      getNumRows: () => 1, getNumColumns: () => 1,
    },
    oldValue,
  };
}

console.log("Перенос при вільній системі");
test("рядок переїжджає і керівники отримують запис", () => {
  const env = makeEnv(BASE);
  env.sandbox.onMainEditTransfer(editEvent(env, 5, "Гуменюк Євген"));
  assert.deepStrictEqual(env.files["Гуменюк Євген"], ["A2", "A3"]);
  assert.deepStrictEqual(env.files["Захарчук Олександра"], ["A1"]);
  assert.strictEqual(env.owners.length, 1, "керівники мали отримати запис");
});

console.log("\nСистема зайнята — те, що зламалось у бою");
test("рядок НЕ зникає, а лягає в чергу", () => {
  const env = makeEnv({ ...BASE, lockBusy: () => true });
  env.sandbox.onMainEditTransfer(editEvent(env, 5, "Гуменюк Євген"));
  assert.deepStrictEqual(Object.keys(env.props), ["TRPEND_A1"],
    "рядок мав опинитись у черзі, а не зникнути");
});

test("хвилинний тригер доводить його до кінця", () => {
  let busy = true;
  const env = makeEnv({ ...BASE, lockBusy: () => busy });
  env.sandbox.onMainEditTransfer(editEvent(env, 5, "Гуменюк Євген"));
  busy = false;                       // система звільнилась
  env.sandbox.processTransferQueue();
  assert.deepStrictEqual(env.files["Захарчук Олександра"], ["A1"]);
  assert.deepStrictEqual(Object.keys(env.props), [], "черга мала спорожніти");
  assert.strictEqual(env.owners.length, 1);
});

test("десять змін підряд: жодна не губиться", () => {
  // Кожен третій замок вдається — рівно та картина, що була 25.09.
  let n = 0;
  const files = { "Гуменюк Євген": [], "Захарчук Олександра": [] };
  const main = [];
  for (let i = 1; i <= 10; i++) {
    files["Гуменюк Євген"].push("ID" + i);
    main.push(row("ID" + i, "Клієнт " + i, "Захарчук Олександра"));
  }
  const env = makeEnv({ files, main, lockBusy: () => (++n % 3 !== 0) });
  for (let i = 0; i < 10; i++) {
    env.sandbox.onMainEditTransfer(editEvent(env, 5 + i, "Гуменюк Євген"));
  }
  // Доганяємо чергу, поки є що доганяти.
  for (let pass = 0; pass < 20 && Object.keys(env.props).length; pass++) {
    env.sandbox.processTransferQueue();
  }
  assert.strictEqual(env.files["Захарчук Олександра"].length, 10,
    "усі 10 мали переїхати, переїхало " + env.files["Захарчук Олександра"].length);
  assert.strictEqual(env.files["Гуменюк Євген"].length, 0);
  assert.strictEqual(env.owners.length, 10, "керівники мали побачити 10 записів");
});

test("рядок, який зник із головної, не висить у черзі вічно", () => {
  const env = makeEnv({ ...BASE, lockBusy: () => true });
  env.sandbox.onMainEditTransfer(editEvent(env, 5, "Гуменюк Євген"));
  env.main.length = 0;                // рядок видалили з таблиці
  env.sandbox.processTransferQueue();
  assert.deepStrictEqual(Object.keys(env.props), []);
});

test("після десятої невдачі керівники дізнаються, а не мовчанка", () => {
  const env = makeEnv({ ...BASE, lockBusy: () => true });
  env.sandbox.onMainEditTransfer(editEvent(env, 5, "Гуменюк Євген"));
  for (let i = 0; i < 12; i++) env.sandbox.processTransferQueue();
  assert.deepStrictEqual(Object.keys(env.props), []);
  assert.ok(env.owners.some((t) => t.indexOf("не вдався") !== -1),
    "мало прийти попередження керівникам");
});

console.log("\nШвидкий шлях: чистимо один файл, а не всі");
test("відомий попередній менеджер — інші файли не відкриваємо", () => {
  const files = { "Гуменюк Євген": ["A1"], "Захарчук Олександра": [],
                  "Максимюк Анна": [], "Дунас Богдан": [] };
  const env = makeEnv({ files, main: [row("A1", "Рома", "Захарчук Олександра")] });
  env.resetOpens();
  env.sandbox.onMainEditTransfer(editEvent(env, 5, "Гуменюк Євген"));
  const opened = env.openCalls.filter((id) => id.startsWith("file-"));
  assert.ok(!opened.includes("file-Максимюк Анна"),
    "чужі файли відкривати не треба: саме це й займало замок");
  assert.deepStrictEqual(env.files["Захарчук Олександра"], ["A1"]);
});

test("невідомий попередній — обходимо всі, нічого не пропускаємо", () => {
  const files = { "Гуменюк Євген": ["A1"], "Захарчук Олександра": [], "Дунас Богдан": ["A1"] };
  const env = makeEnv({ files, main: [row("A1", "Рома", "Захарчук Олександра")] });
  env.sandbox.onMainEditTransfer(editEvent(env, 5, undefined));
  assert.deepStrictEqual(env.files["Гуменюк Євген"], []);
  assert.deepStrictEqual(env.files["Дунас Богдан"], []);
});

console.log("\nЗвірка головної з файлами менеджерів");
test("бачить рядок, що лежить не в того менеджера", () => {
  const env = makeEnv(BASE);
  env.sandbox.resyncManagerAssignments(true);
  const out = env.log.join("\n");
  assert.ok(out.indexOf("не в того менеджера: 3") !== -1, out);
  assert.deepStrictEqual(env.files["Захарчук Олександра"], [], "перевірка не має нічого міняти");
});

test("виправляє розбіжності й шле сповіщення", () => {
  const env = makeEnv(BASE);
  env.sandbox.resyncManagerAssignments(false);
  assert.deepStrictEqual(env.files["Захарчук Олександра"], ["A1", "A2", "A3"]);
  assert.deepStrictEqual(env.files["Гуменюк Євген"], []);
  assert.strictEqual(env.owners.length, 3);
});

test("коли все збігається — мовчить і нічого не чіпає", () => {
  const env = makeEnv({
    files: { "Гуменюк Євген": [], "Захарчук Олександра": ["A1"] },
    main: [row("A1", "Рома", "Захарчук Олександра")],
  });
  env.sandbox.resyncManagerAssignments(false);
  assert.ok(env.log.join("\n").indexOf("Розбіжностей немає") !== -1);
  assert.strictEqual(env.owners.length, 0);
});

test("менеджер без таблиці: не мовчимо і не крутимо це вічно", () => {
  // Зингель Олена має клієнтів у головній, але файлу в неї немає — рядки
  // нікуди класти. Це не «не синхронізувалось», це «бракує таблиці».
  const env = makeEnv({
    files: { "Зингель Олена": [], "Захарчук Олександра": [] },
    noFile: ["Зингель Олена"],
    main: [row("A1", "Оксана", "Зингель Олена"), row("A2", "Марія", "Зингель Олена")],
  });
  env.sandbox.resyncManagerAssignments(false);
  const out = env.log.join("\n");
  assert.ok(out.indexOf("Менеджери БЕЗ таблиці") !== -1, out);
  assert.ok(out.indexOf("Зингель Олена — клієнтів: 2") !== -1, out);
  // Головне: їх НЕ рахуємо за виправні, інакше вони щоразу з'їдали б ліміт
  // і звірка ніколи не доходила б до тих, кого справді можна полагодити.
  assert.ok(out.indexOf("Розбіжностей до виправлення: 0") !== -1, out);
});

test("клієнти того, хто без таблиці, не блокують решту", () => {
  const files = { "Зингель Олена": [], "Гуменюк Євген": ["B1"], "Захарчук Олександра": [] };
  const main = [row("B1", "Рома", "Захарчук Олександра")];
  for (let i = 1; i <= 30; i++) main.push(row("Z" + i, "Клієнт " + i, "Зингель Олена"));
  const env = makeEnv({ files, main, noFile: ["Зингель Олена"] });
  env.sandbox.resyncManagerAssignments(false);
  assert.deepStrictEqual(env.files["Захарчук Олександра"], ["B1"],
    "справжня розбіжність мала виправитись, а не загубитись серед нездійсненних");
});

test("звірка відкриває лише той файл, що справді тримає рядок", () => {
  const files = { "Гуменюк Євген": ["A1"], "Захарчук Олександра": [],
                  "Максимюк Анна": [], "Дунас Богдан": [] };
  const env = makeEnv({ files, main: [row("A1", "Рома", "Захарчук Олександра")] });
  env.sandbox.resyncManagerAssignments(true);   // прогріли: прочитали всі файли
  env.resetOpens();
  env.sandbox.resyncManagerAssignments(false);
  // Після читання файлів для звірки нам уже відомо, хто тримає рядок, тож
  // сам перенос не має знову перебирати чужі таблиці.
  const opened = env.openCalls.filter((id) => id.startsWith("file-"));
  const afterScan = opened.slice(4);   // перші 4 — то читання для самої звірки
  assert.ok(!afterScan.includes("file-Максимюк Анна"),
    "чужі файли під замком відкривати не треба: " + afterScan.join(", "));
});

test("нічийний рядок без менеджера не вважається розбіжністю", () => {
  const env = makeEnv({
    files: { "Гуменюк Євген": [], "Захарчук Олександра": [] },
    main: [row("A1", "Рома", "")],
  });
  env.sandbox.resyncManagerAssignments(true);
  assert.ok(env.log.join("\n").indexOf("Розбіжностей немає") !== -1);
});

console.log("\nОдин файл на двох менеджерів — перенос по колу");
test("звірка не бере такі рядки у виправлення, а називає причину", () => {
  // Гуменюку й Захарчук вписали одну таблицю: «прибрати» й «додати» — це
  // той самий файл, тож перенос звітує про успіх, а рядок не рухається.
  const env = makeEnv({
    files: { "Гуменюк Євген": ["A1"], "Захарчук Олександра": [] },
    sameFile: { "Захарчук Олександра": "Гуменюк Євген" },
    main: [row("A1", "Рома", "Захарчук Олександра")],
  });
  env.sandbox.resyncManagerAssignments(true);
  const out = env.log.join("\n");
  assert.ok(out.indexOf("ОДИН ФАЙЛ НА ДВОХ МЕНЕДЖЕРІВ") !== -1, out);
  assert.ok(out.indexOf("Розбіжностей до виправлення: 0") !== -1, out);
});

test("перенос не чіпає файл, який і є файлом призначення", () => {
  const env = makeEnv({
    files: { "Гуменюк Євген": ["A1"], "Захарчук Олександра": [] },
    sameFile: { "Захарчук Олександра": "Гуменюк Євген" },
    main: [row("A1", "Рома", "Захарчук Олександра")],
  });
  env.sandbox.transferLeadRow_(env.mainSheet, 5, {});
  // Рядок лишився рівно один: ми його не видалили й не продублювали.
  assert.strictEqual(env.files["Гуменюк Євген"].length, 1,
    "рядок мав лишитись на місці, а не зникнути чи задвоїтись");
  assert.strictEqual(env.owners.length, 0,
    "не можна звітувати про перенос, якого не було");
});

console.log("\nДіагностика");
test("називає спільний файл причиною", () => {
  const env = makeEnv({
    files: { "Гуменюк Євген": ["A1"], "Захарчук Олександра": [] },
    sameFile: { "Захарчук Олександра": "Гуменюк Євген" },
    main: [row("A1", "Рома", "Захарчук Олександра")],
  });
  env.sandbox.diagnoseTransferSetup();
  const out = env.log.join("\n");
  assert.ok(out.indexOf("ПРИЧИНА ЗНАЙДЕНА: один файл") !== -1, out);
});

test("називає дубль ID з різними менеджерами причиною", () => {
  const env = makeEnv({
    files: { "Гуменюк Євген": ["A1"], "Захарчук Олександра": ["A1"] },
    main: [row("A1", "Рома", "Захарчук Олександра"), row("A1", "Рома", "Гуменюк Євген")],
  });
  env.sandbox.diagnoseTransferSetup();
  const out = env.log.join("\n");
  assert.ok(out.indexOf("один ID у кількох рядках з РІЗНИМИ менеджерами") !== -1, out);
});

test("коли обидві причини виключені — показує решту тригерів проєкту", () => {
  const env = makeEnv({
    files: { "Гуменюк Євген": [], "Захарчук Олександра": ["A1"] },
    main: [row("A1", "Рома", "Захарчук Олександра")],
    triggers: ["onMainEditTransfer", "onEdit", "nightlySyncAll"],
  });
  env.sandbox.diagnoseTransferSetup();
  const out = env.log.join("\n");
  assert.ok(out.indexOf("Обидві відомі причини виключені") !== -1, out);
  // Саме тут шукати далі: інший тригер, що теж пише у файли менеджерів.
  assert.ok(out.indexOf("nightlySyncAll") !== -1, out);
});

test("дубль у чужому файлі описується як дубль, а не як незроблений перенос", () => {
  const env = makeEnv({
    files: { "Гуменюк Євген": ["A1"], "Захарчук Олександра": ["A1"] },
    main: [row("A1", "Рома", "Захарчук Олександра")],
  });
  env.sandbox.resyncManagerAssignments(true);
  const out = env.log.join("\n");
  assert.ok(out.indexOf("Є У НЬОГО, але ЩЕ Й у: Гуменюк Євген") !== -1, out);
});

console.log("\nПройдено: " + passed);
