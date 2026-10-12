// node apps-script/tests/sys-tests.js — SystemSync.gs: система → таблиця
const fs = require("fs");
const vm = require("vm");

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); console.log("  ок   " + name); pass++; }
  catch (e) { console.log("  ЗБІЙ " + name + "\n       " + e.message); fail++; }
}
function eq(a, b, what) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((what || "") + " очікували " + JSON.stringify(b) + ", дали " + JSON.stringify(a));
  }
}

/** Рядок аркуша: 26 колонок, TG-блок з 21-ї. */
function sheetRow(id, tg) {
  const r = new Array(26).fill("");
  r[0] = id; r[2] = "Іван"; r[6] = "0671112233"; r[4] = "Волинська"; r[10] = "Захарчук";
  (tg || []).forEach((v, i) => { r[20 + i] = v; });
  return r;
}

function makeEnv(opts) {
  const rows = opts.rows;            // дані з 5-го рядка
  const log = (opts.log || []).slice();
  const synced = [];
  const sheet = {
    getRange: (row, col, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let r = 0; r < (nr || 1); r++) out.push(rows[row - 5 + r].slice(col - 1, col - 1 + (nc || 1)));
        return out;
      },
      setValues: (v) => { v[0].forEach((x, i) => { rows[row - 5][col - 1 + i] = x; }); },
      setNote: () => {},
    }),
  };
  const logSheet = {
    getLastRow: () => log.length + 1,
    getRange: (row, col, nr, nc) => ({
      getValues: () => log.slice(row - 2, row - 2 + nr).map((l) => l.slice(col - 1, col - 1 + nc)),
    }),
  };
  const sandbox = {
    Logger: { log: () => {} },
    Session: { getScriptTimeZone: () => "Europe/Kyiv" },
    Utilities: {
      formatDate: (d) => {
        const p = (n) => String(n).padStart(2, "0");
        return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear() + " " +
               p(d.getHours()) + ":" + p(d.getMinutes());
      },
    },
    ContentService: { createTextOutput: (t) => ({ setMimeType: () => t }), MimeType: { JSON: 1 } },
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(`
    var MAIN_FILE_ID = "main", TG_LOG_SHEET = "_tg_log", DATA_START = 5;
    var COL = {ID:1, NAME:3, REGION:5, PHONE:7, MANAGER:11, DUPS:16};
    var TG_MAIN_STATUS = 21, TG_MAIN_DATE = 22, TG_MAIN_LINK = 23, TG_MAIN_NICK = 24,
        TG_MAIN_JOINED = 25, TG_MAIN_TGID = 26, TG_MAIN_LAST = 26, TG_BLOCK = 6;
    var TG_STATUS_SENT = "✅ Надіслано", TG_STATUS_BOT = "💬 У боті",
        TG_STATUS_JOINED = "👤 Приєднався", TG_STATUS_LEFT = "🚪 Відписався",
        TG_STATUS_BLOCKED = "⛔ Заблокував бота";
    function tgStr_(v) { return (v === null || v === undefined) ? "" : String(v).trim(); }
    function tgEcoStatusIsOurs_(s) { s = tgStr_(s); return !s || s === TG_STATUS_SENT ||
      s === TG_STATUS_BOT || s === TG_STATUS_JOINED || s === TG_STATUS_LEFT || s === TG_STATUS_BLOCKED; }
    function tgSheetForId_() { return SHEET_; }
    function tgFindRow_(sh, c, s, id) { for (var i = 0; i < ROWS_.length; i++) if (ROWS_[i][0] === id) return 5 + i; return -1; }
    function tgSS_() { return { getSheetByName: function () { return LOGSHEET_; } }; }
    function tgLogAppend_(r) { LOG_.push(r); }
    function tgSyncToManager_(m, id, v) { SYNCED_.push([m, id, v[0]]); }
    function tgTwinFromDups_() { return ""; }
    function tgLinkSecret_() { return "s"; }
    function tgHmac12_(d, v) { return "SIG:" + v; }
  `, ctx);
  Object.assign(sandbox, { SHEET_: sheet, ROWS_: rows, LOGSHEET_: logSheet, LOG_: log, SYNCED_: synced });
  vm.runInContext(fs.readFileSync(__dirname + "/../SystemSync.gs", "utf8"), ctx, { filename: "SystemSync.gs" });
  const mkDate = vm.runInContext("(function(ms){return new Date(ms)})", ctx);
  for (const l of log) if (l[0] instanceof Date) l[0] = mkDate(l[0].getTime());
  return {
    rows, log, synced,
    apply: (id, ev, at, src) => vm.runInContext(
      `tgApplySysEvent_(${JSON.stringify(id)}, ${JSON.stringify(ev)}, ${JSON.stringify(at)}, ${JSON.stringify(src || "card")})`, ctx),
    event: (p) => JSON.parse(vm.runInContext(`tgSysEvent_(${JSON.stringify(p)})`, ctx)),
  };
}

const AT = "2026-10-12T07:00:00.000Z";

console.log("\nСистема → таблиця (SystemSync.gs)");
test("надіслано з картки: статус, дата, «вперше» в журнал, файл менеджера", () => {
  const env = makeEnv({ rows: [sheetRow("1C-1")] });
  env.apply("1C-1", "sent_first", AT, "card_viber");
  eq(env.rows[0][20], "✅ Надіслано", "статус");
  if (!env.rows[0][21]) throw new Error("немає дати надсилання");
  eq(env.log.length, 1, "рядків журналу");
  eq([env.log[0][7], env.log[0][8]], ["система: картка", "вперше"], "журнал");
  eq(env.synced[0], ["Захарчук", "1C-1", "✅ Надіслано"], "файл менеджера");
});

test("рядку вже надсилали з таблиці — у журнал «повторно», дату не чіпаємо", () => {
  const env = makeEnv({ rows: [sheetRow("1C-1", ["✅ Надіслано", "01.10.2026 10:00"])] });
  env.apply("1C-1", "sent_first", AT);
  eq(env.rows[0][21], "01.10.2026 10:00", "дата");
  eq(env.log[0][8], "повторно", "журнал");
});

test("«Не потрібно» менеджера — у таблицю; приєднаного не чіпає", () => {
  const env = makeEnv({ rows: [sheetRow("1C-1", ["✅ Надіслано"]), sheetRow("1C-2", ["👤 Приєднався"])] });
  env.apply("1C-1", "not_needed", AT);
  env.apply("1C-2", "refused", AT);
  eq(env.rows[0][20], "🚫 Не потрібно", "1");
  eq(env.rows[1][20], "👤 Приєднався", "2");
  eq(env.log.length, 0, "ручні позначки не рахуються як події звіту");
});

test("вже «Приєднався» — другий вступ у журнал не пишемо", () => {
  const env = makeEnv({ rows: [sheetRow("1C-1", ["👤 Приєднався", "", "", "", "05.10.2026 10:00"])] });
  env.apply("1C-1", "joined", AT, "bot");
  eq(env.log.length, 0, "журнал");
  eq(env.rows[0][24], "05.10.2026 10:00", "дата вступу не переписана");
});

test("відкриття бота, яке старий шлях уже записав за 10 хв, — без дубля", () => {
  const env = makeEnv({
    rows: [sheetRow("1C-1", ["💬 У боті"])],
    log: [[new Date(AT), "1C-1", "", "", "", "", "", "бот системи", "відкрив бота: @ivan"]],
  });
  env.apply("1C-1", "bot_opened", "2026-10-12T07:03:00.000Z", "bot");
  eq(env.log.length, 1, "журнал");
});

test("новий клієнт: ручне «Приєднався» менеджера ставить статус і дату", () => {
  const env = makeEnv({ rows: [sheetRow("LTEX-20261001-0001", ["✅ Надіслано"])] });
  env.apply("LTEX-20261001-0001", "joined_manual", AT);
  eq(env.rows[0][20], "👤 Приєднався", "статус");
  if (!env.rows[0][24]) throw new Error("немає дати вступу");
  eq(env.log[0][8], "приєднався: (позначив менеджер)", "журнал");
});

test("рядка немає — нічого не ламаємо", () => {
  const env = makeEnv({ rows: [sheetRow("1C-1")] });
  eq(env.apply("1C-9", "sent_first", AT), "not-found", "відповідь");
});

test("підроблений підпис не приймається", () => {
  const env = makeEnv({ rows: [sheetRow("1C-1")] });
  const bad = env.event({ id: "1C-1", ev: "sent_first", at: AT, sig: "чужий" });
  eq(bad.ok, false, "чужий підпис");
  const good = env.event({ id: "1C-1", ev: "sent_first", at: AT, sig: "SIG:sys|1C-1|sent_first|" + AT });
  eq(good.ok, true, "свій підпис");
  eq(env.rows[0][20], "✅ Надіслано", "застосовано");
});

console.log("\n" + (fail ? "ЗБОЇВ: " + fail : "усе ок") + ", перевірок: " + (pass + fail));
process.exit(fail ? 1 : 0);
