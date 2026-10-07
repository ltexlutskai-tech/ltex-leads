// node apps-script/tests/tgx-tests.js
const { makeEnv } = require("./tgx-harness");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ок   " + name); pass++; }
  catch (e) { console.log("  ЗБІЙ " + name + "\n       " + e.message); fail++; }
}
/** Перший рядок ЗВІТУ (останній виклик Logger.log), а не першого повідомлення. */
function reportHead(env) {
  return String(env.log[env.log.length - 1] || "").split("\n")[0];
}
function eq(a, b, what) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((what || "") + " очікували " + JSON.stringify(b) + ", дали " + JSON.stringify(a));
  }
}

const D = (s) => new Date(s);
/** Рядок журналу: Дата, ID, ПІБ, Телефон, Область, Менеджер, Посилання, Джерело, Примітка */
function row(date, id, note, extra = {}) {
  return [date, id, extra.name || "Іван", extra.phone || "0671112233",
          extra.region || "Волинська", extra.mgr || "Захарчук",
          extra.link || "", extra.source || "Кнопка в картці", note];
}

console.log("\nЯкі аркуші бере перенос колонок");
test("архів журналу не плутаємо з аркушем роботи", () => {
  // Інцидент: «_tg_log_архів_12.09.2026_14-07» містить «2026» і потрапляв у
  // список аркушів із клієнтами. Перенос ішов по журналу як по базі.
  const { run } = makeEnv({ sheets: [] });
  eq(run('tgxWanted_("🔒 2026")'), true, "аркуш року");
  eq(run('tgxWanted_("🏭 Клієнти 1С")'), true, "клієнти 1С");
  eq(run('tgxWanted_("_tg_log")'), false, "журнал");
  eq(run('tgxWanted_("_tg_log_архів_12.09.2026_14-07")'), false, "архів журналу");
  eq(run('tgxWanted_("_службовий 2026")'), false, "службовий");
  eq(run('tgxWanted_("Довідник")'), false, "довідник");
});

console.log("\nЯкі аркуші бере перенос журналу");
test("беремо і чинний журнал, і всі його архіви", () => {
  // Журнал періодично відкладали вбік. Якби ми читали лише чинний, у звіт не
  // доїхали б найстаріші місяці — саме ті, через які цифри й виглядали
  // заниженими.
  const { run } = makeEnv({
    sheets: [
      { name: "🔒 2026", rows: [] },
      { name: "_tg_log", rows: [] },
      { name: "_tg_log_архів_12.09.2026_14-07", rows: [] },
      { name: "_tg_log_архів_01.08.2026_09-00", rows: [] },
      { name: "Довідник", rows: [] },
    ],
  });
  eq(run("tgxLogSheets_().map(function(s){return s.getName()})"), [
    "_tg_log",
    "_tg_log_архів_12.09.2026_14-07",
    "_tg_log_архів_01.08.2026_09-00",
  ]);
});

console.log("\nЩо саме їде з журналу");
test("дата їде як ISO, щоб подія лягла в свій місяць", () => {
  const { run } = makeEnv({
    sheets: [{ name: "_tg_log", rows: [row(D("2026-09-18T08:03:00Z"), "1C-4741", "вперше")] }],
  });
  const out = run('tgxReadLog_(tgxLogSheets_()[0], 2, 10)');
  eq(out.length, 1);
  eq(out[0].at, "2026-09-18T08:03:00.000Z");
  eq(out[0].note, "вперше");
});

test("«1C-4741» — ключ картки, «LTEX-…» — рядок лідів", () => {
  // Один стовпчик ID несе дві різні речі. Якби ми слали їх однаково, половина
  // рядків не знайшла б картки й осіла в «не знайшли».
  const { run } = makeEnv({
    sheets: [{ name: "_tg_log", rows: [
      row(D("2026-09-18T08:03:00Z"), "1C-4741", "вперше"),
      row(D("2026-09-18T08:04:00Z"), "LTEX-20260817-1234", "вперше"),
    ] }],
  });
  const out = run('tgxReadLog_(tgxLogSheets_()[0], 2, 10)');
  eq(out[0].code1C, "1C-4741");
  eq(out[0].externalId, undefined);
  eq(out[1].externalId, "LTEX-20260817-1234");
  eq(out[1].code1C, undefined);
});

test("рядок без примітки або без дати не їде", () => {
  // Без примітки нема що записати, без дати подія осіла б не в тому місяці.
  const { run } = makeEnv({
    sheets: [{ name: "_tg_log", rows: [
      row(D("2026-09-18T08:03:00Z"), "1C-4741", ""),
      row("", "1C-4742", "вперше"),
      row(D("2026-09-18T08:05:00Z"), "1C-4743", "вперше"),
    ] }],
  });
  const out = run('tgxReadLog_(tgxLogSheets_()[0], 2, 10)');
  eq(out.length, 1);
  eq(out[0].code1C, "1C-4743");
});

test("задовга дата-текст урізається ще в таблиці", () => {
  // Двічі ловили HTTP 400 на цілу пачку з двохсот рядків через одне довге
  // значення. Різати треба тут: інакше таблиця крутиться по колу.
  const { run } = makeEnv({
    sheets: [{ name: "_tg_log", rows: [
      row("Thu Oct 01 2026 17:14:35 GMT+0300 " + "x".repeat(400), "1C-4741", "вперше"),
    ] }],
  });
  const out = run('tgxReadLog_(tgxLogSheets_()[0], 2, 10)');
  eq(out[0].at.length <= 200, true, "довжина дати");
});

console.log("\nПовний прохід журналу");
test("усі рядки доїжджають і курсор зникає", () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push(row(D("2026-09-18T08:0" + i + ":00Z"), "1C-" + i, "вперше"));
  const env = makeEnv({ sheets: [{ name: "_tg_log", rows }] });
  env.run("pushTgLogAll()");
  const sent = env.posts.reduce((a, p) => a + p.payload.rows.length, 0);
  eq(sent, 5, "рядків надіслано");
  eq(env.props.TGX_LOG_CURSOR, undefined, "курсор");
  if (env.log.join("\n").indexOf("✅ Журнал перенесено") === -1) {
    throw new Error("немає підтвердження: " + env.log.join(" | "));
  }
});

test("архіви йдуть після чинного журналу, в один потік", () => {
  const env = makeEnv({
    sheets: [
      { name: "_tg_log", rows: [row(D("2026-10-01T08:00:00Z"), "1C-1", "вперше")] },
      { name: "_tg_log_архів_12.09.2026", rows: [row(D("2026-09-01T08:00:00Z"), "1C-2", "вперше")] },
    ],
  });
  env.run("pushTgLogAll()");
  const ids = env.posts.flatMap((p) => p.payload.rows.map((r) => r.code1C));
  eq(ids, ["1C-1", "1C-2"]);
});

test("пачка не прийнята — кажемо про це, а не мовчимо «готово»", () => {
  // Тихий успіх після відмови API — найгірший з варіантів: людина думає, що
  // перенесла, і більше не вертається.
  const env = makeEnv({
    sheets: [{ name: "_tg_log", rows: [row(D("2026-09-18T08:03:00Z"), "1C-1", "вперше")] }],
    post: () => ({ code: 400, ok: false, error: "Invalid input" }),
  });
  env.run("pushTgLogAll()");
  const text = env.log.join("\n");
  if (text.indexOf("❌ Пачок не прийнято: 1") === -1) {
    throw new Error("немає рядка про відмову: " + text);
  }
});

test("ЗАГОЛОВОК не каже «перенесено», коли не прийнято нічого", () => {
  // Інцидент 07.10.2026: усі 10 пачок відбились 404, а перший рядок звіту
  // казав «✅ Журнал перенесено» — бо дивився на те, що ми дочитали аркуші до
  // кінця, а не на прийняте. Людина прочитала перший рядок і пішла далі.
  const env = makeEnv({
    sheets: [{ name: "_tg_log", rows: [row(D("2026-09-18T08:03:00Z"), "1C-1", "вперше")] }],
    post: () => ({ code: 404, ok: false }),
  });
  env.run("pushTgLogAll()");
  const head = reportHead(env);
  if (head.indexOf("✅") !== -1) {
    throw new Error("заголовок бреше: " + head);
  }
  if (head.indexOf("Нічого не перенесено") === -1) {
    throw new Error("заголовок не каже, що сталось: " + head);
  }
});

test("частина пачок не дійшла — заголовок каже «частково», не «готово»", () => {
  const env = makeEnv({
    sheets: [{ name: "_tg_log", rows: [
      row(D("2026-09-18T08:03:00Z"), "1C-1", "вперше"),
      row(D("2026-09-18T08:04:00Z"), "1C-2", "вперше"),
    ] }],
    // TGX_BATCH = 200, тож обидва рядки їдуть однією пачкою — робимо дві,
    // підмінивши розмір пачки.
    post: (p, n) => (n === 1
      ? { ok: true, received: 1, created: 1, ignored: 0, unmatched: 0, duplicates: 0, skipped: 0 }
      : { code: 500, ok: false }),
  });
  env.run("TGX_BATCH = 1; pushTgLogAll()");
  const head = reportHead(env);
  if (head.indexOf("частково") === -1) {
    throw new Error("заголовок: " + head);
  }
});

test("502 — чекаємо на перезапуск, а не палимо пачки підряд", () => {
  // Інцидент 07.10.2026: pushTgLogAll() запустили, коли деплой ще йшов.
  // Cloudflare віддавав 502, скрипт за сім секунд спалив усі десять пачок і
  // відзвітував «нічого не перенесено» — хоча достатньо було почекати.
  let hit = 0;
  const env = makeEnv({
    sheets: [{ name: "_tg_log", rows: [row(D("2026-09-18T08:03:00Z"), "1C-1", "вперше")] }],
    post: () => (++hit < 3
      ? { code: 502, ok: false }
      : { ok: true, received: 1, created: 1, ignored: 0, unmatched: 0, duplicates: 0, skipped: 0 }),
  });
  env.run("pushTgLogAll()");
  eq(env.waits.length, 2, "скільки разів чекали");
  eq(reportHead(env), "✅ Журнал перенесено", "заголовок");
});

test("сервер так і не піднявся — кажемо почекати й запустити ще раз", () => {
  const env = makeEnv({
    sheets: [{ name: "_tg_log", rows: [row(D("2026-09-18T08:03:00Z"), "1C-1", "вперше")] }],
    post: () => ({ code: 502, ok: false }),
  });
  env.run("pushTgLogAll()");
  const text = env.log.join("\n");
  if (reportHead(env).indexOf("✅") !== -1) {
    throw new Error("заголовок бреше: " + reportHead(env));
  }
  if (text.indexOf("перезапускався") === -1) {
    throw new Error("не назвали причину: " + text);
  }
  // Не вічно: інакше запуск висить до 6-хвилинного ліміту Apps Script і
  // людина не бачить навіть звіту.
  eq(env.waits.length, 3, "спроб чекання");
});

test("404 читається з першого погляду і каже, що робити", () => {
  // Сервер віддає сторінку «не знайдено»: кілобайт HTML на кожну пачку — це
  // десять екранів розмітки замість одного рядка, з якого видно причину.
  const env = makeEnv({
    sheets: [{ name: "_tg_log", rows: [row(D("2026-09-18T08:03:00Z"), "1C-1", "вперше")] }],
    post: () => ({ code: 404, ok: false }),
  });
  env.run("pushTgLogAll()");
  const text = env.log.join("\n");
  if (text.indexOf("такої адреси на сервері немає") === -1) {
    throw new Error("не назвали причину: " + text);
  }
  if (text.indexOf("deploy.ps1") === -1) {
    throw new Error("не сказали, що робити: " + text);
  }
  // 404 — чекати немає сенсу: адреси немає, і за 15 секунд вона не зʼявиться.
  eq(env.waits.length, 0, "чекання на 404");
});

test("HTML у відповіді не заливає журнал розміткою", () => {
  const { run } = makeEnv({ sheets: [] });
  eq(run('tgxBrief_("<!DOCTYPE html><html lang=\\"uk\\">" + "x".repeat(5000))'),
     "(сторінка HTML, не відповідь API)");
  eq(run('tgxBrief_("{\\"error\\":\\"Invalid input\\"}")'),
     '{"error":"Invalid input"}');
});

test("скрипт переказує, що саме система пропустила", () => {
  const env = makeEnv({
    sheets: [{ name: "_tg_log", rows: [row(D("2026-09-18T08:03:00Z"), "1C-1", "вперше")] }],
    post: (p) => ({ ok: true, received: 1, created: 0, ignored: 0, unmatched: 0,
                    duplicates: 0, skipped: 1, problem: "at: задовге" }),
  });
  env.run("pushTgLogAll()");
  const text = env.log.join("\n");
  if (text.indexOf("at: задовге") === -1) {
    throw new Error("не переказали причину: " + text);
  }
});

test("скидання курсора дає перечитати журнал з початку", () => {
  const env = makeEnv({ sheets: [{ name: "_tg_log", rows: [] }],
                        props: { TGX_LOG_CURSOR: "_tg_log|1200" } });
  env.run("pushTgLogReset()");
  eq(env.props.TGX_LOG_CURSOR, undefined);
});

console.log("\n" + (fail ? "ЗБОЇВ: " + fail : "усе ок") + ", перевірок: " + (pass + fail));
process.exit(fail ? 1 : 0);
