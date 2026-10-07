// ============================================================
// L-TEX CRM | TgHistoryExport.gs  ·  v1.0
// ------------------------------------------------------------
// ПЕРЕНОС ІСТОРІЇ TELEGRAM З ТАБЛИЦІ В СИСТЕМУ
//
// НАВІЩО
//   У бота Telegram ОДИН вебхук. Поки він вказував сюди, усі надсилання й
//   приєднання писались у таблицю, а система їх не бачила. Після перемикання
//   07.10 система пише своє — але звіт «Залучення в ресурси» за минулі місяці
//   лишався порожнім: «Надіслано 0» при сотнях реальних надсилань.
//
//   Цей файл віддає системі те, що вже лежить у колонках таблиці: статус
//   TG-посилання, дату надсилання, нік, дату приєднання, Telegram-id.
//
//   Вивантажувати .xlsx і класти його на сервер не треба: скрипт уже тут і
//   має доступ до всіх аркушів. Саме на ручному вивантаженні перенос і
//   спинявся.
//
// ЩО ЗАПУСКАТИ
//   checkTgHistoryExport()      — подивитись, скільки рядків поїде (нічого не шле)
//   pushTgHistoryAll()          — повний перенос; повторний запуск БЕЗПЕЧНИЙ
//   installTgHistoryExportTrigger() — щогодинна догонка свіжих рядків
//
//   Повний перенос тримає курсор: якщо Apps Script обірве на шостій хвилині,
//   наступний запуск продовжить з того ж місця, а не почне спочатку.
//   pushTgHistoryReset() — почати все заново.
//
// БЕЗПЕЧНО ПОВТОРЮВАТИ
//   Система не чіпає наявний статус (його поставив бот за фактом) і не
//   створює подію вдруге. Тому «запустив двічі» тут не псує цифри.
// ============================================================

// Аркуші з блоком Telegram. Назви звіряються без емодзі й регістру, тож
// «🔒 2026» і «2026» — те саме.
var TGX_SHEETS = ["2026", "Клієнти 1С", "Клієнти 1C", "2025"];

var TGX_BATCH        = 200;   // рядків в одному запиті
var TGX_MAX_PER_RUN  = 3000;  // щоб вкластись у 6 хвилин Apps Script
var TGX_FRESH_DAYS   = 3;     // «свіжі» для щогодинної догонки
var TGX_CURSOR       = "TGX_CURSOR";


// ╔══════════════════════════════════════════════════════════╗
// ║  1. ПЕРЕВІРКА — нічого не надсилає                       ║
// ╚══════════════════════════════════════════════════════════╝
function checkTgHistoryExport() {
  var out = ["=== Перенос історії Telegram ==="];
  var base = tgEcoApiBase_();
  out.push(base ? "Адреса системи: " + base : "❌ Адреси системи немає (TG_ECO_API)");
  out.push(tgEcoApiSecret_() ? "Ключ: є" : "❌ Ключа немає (TG_API_SECRET)");

  var sheets = tgxSheets_();
  if (!sheets.length) {
    out.push("❌ Не знайшов жодного аркуша з блоком Telegram.");
    Logger.log(out.join("\n"));
    return;
  }

  var total = 0;
  out.push("");
  for (var i = 0; i < sheets.length; i++) {
    var n = tgxCountRows_(sheets[i]);
    total += n.withTg;
    out.push("  " + sheets[i].getName() + " — рядків: " + n.rows +
             ", з даними Telegram: " + n.withTg);
  }
  out.push("");
  out.push("Разом поїде: " + total);
  out.push("Курсор: " + (tgProp_(TGX_CURSOR) || "на початку"));
  out.push("");
  out.push("Перенести: pushTgHistoryAll()");
  Logger.log(out.join("\n"));
}


// ╔══════════════════════════════════════════════════════════╗
// ║  2. ПОВНИЙ ПЕРЕНОС                                       ║
// ╚══════════════════════════════════════════════════════════╝
function pushTgHistoryAll() {
  if (!tgEcoApiBase_() || !tgEcoApiSecret_()) {
    Logger.log("❌ Спершу: tgSetProp_(\"TG_ECO_API\", \"https://new.ltex.com.ua\")");
    return;
  }
  var sheets = tgxSheets_();
  if (!sheets.length) { Logger.log("❌ Аркушів з блоком Telegram немає."); return; }

  // Курсор: «аркуш|рядок». Шестихвилинний ліміт тут не виняток, а правило —
  // рядків тисячі, тож продовжувати з місця зупинки має бути нормою, а не
  // аварійним режимом.
  var cur    = tgxCursor_();
  var sent   = 0, batches = 0, acc = tgxAccNew_();
  var buffer = [];
  var done   = true;

  for (var i = 0; i < sheets.length; i++) {
    var sh   = sheets[i];
    var name = sh.getName();
    if (cur.sheet && name !== cur.sheet && !cur.passed) continue;
    cur.passed = true;

    var startRow = (name === cur.sheet && cur.row) ? cur.row : DATA_START;
    var last     = sh.getLastRow();
    if (last < startRow) { cur.sheet = ""; cur.row = 0; continue; }

    for (var r = startRow; r <= last; r += TGX_BATCH) {
      if (sent >= TGX_MAX_PER_RUN) {
        tgxSaveCursor_(name, r);
        done = false;
        break;
      }
      var count = Math.min(TGX_BATCH, last - r + 1);
      var rows  = tgxReadRows_(sh, r, count, name);
      sent += count;
      if (!rows.length) continue;

      buffer = buffer.concat(rows);
      while (buffer.length >= TGX_BATCH) {
        var res = tgxPost_(buffer.splice(0, TGX_BATCH));
        batches++;
        tgxAcc_(acc, res);
      }
    }
    if (!done) break;
    cur.sheet = ""; cur.row = 0;
  }

  while (buffer.length) {
    tgxAcc_(acc, tgxPost_(buffer.splice(0, TGX_BATCH)));
    batches++;
  }

  if (done) tgSetProp_(TGX_CURSOR, "");
  Logger.log([
    (done ? "✅ Перенос завершено" : "⏳ Частину перенесено, запустіть ще раз"),
    "Рядків переглянуто: " + sent,
    "Пачок надіслано: " + batches,
    "Прийнято системою: " + acc.received,
    "Не знайшли картку: " + acc.unmatched,
    "Статусів створено/оновлено: " + acc.statuses,
    "Подій створено: " + acc.events,
    // Мовчазний «пропущено 200» нічого не пояснює. Якщо система щось не
    // прийняла — одразу кажемо, яке поле їй не підійшло.
    acc.skipped ? "⚠️ Пропущено рядків: " + acc.skipped +
                  (acc.problem ? " — " + acc.problem : "") : "",
    acc.failed ? "❌ Пачок не прийнято: " + acc.failed : "",
    done ? "" : "Курсор: " + tgProp_(TGX_CURSOR)
  ].join("\n"));
}

function pushTgHistoryReset() {
  tgSetProp_(TGX_CURSOR, "");
  Logger.log("Курсор скинуто — наступний pushTgHistoryAll() почне спочатку.");
}


// ╔══════════════════════════════════════════════════════════╗
// ║  3. ЩОГОДИННА ДОГОНКА                                    ║
// ╚══════════════════════════════════════════════════════════╝
// Поки менеджери ще працюють у таблиці, свіжі надсилання мають доходити в
// систему без ручних запусків. Беремо лише останні дні: ганяти тисячі рядків
// щогодини заради десятка нових — марна трата квоти.
function tgHistoryExportJob() {
  try {
    if (!tgEcoApiBase_() || !tgEcoApiSecret_()) return;
    var since  = new Date(Date.now() - TGX_FRESH_DAYS * 86400000);
    var sheets = tgxSheets_();
    var buffer = [];
    for (var i = 0; i < sheets.length; i++) {
      var sh   = sheets[i];
      var last = sh.getLastRow();
      if (last < DATA_START) continue;
      var rows = tgxReadRows_(sh, DATA_START, last - DATA_START + 1, sh.getName(), since);
      buffer = buffer.concat(rows);
    }
    var acc = tgxAccNew_();
    while (buffer.length) tgxAcc_(acc, tgxPost_(buffer.splice(0, TGX_BATCH)));
    if (acc.received) {
      Logger.log("Догонка: прийнято " + acc.received + ", подій " + acc.events);
    }
  } catch (err) { Logger.log("tgHistoryExportJob: " + err); }
}

function installTgHistoryExportTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgHistoryExportJob") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tgHistoryExportJob").timeBased().everyHours(1).create();
  Logger.log("✅ Щогодинна догонка історії встановлена");
}

function removeTgHistoryExportTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgHistoryExportJob") { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log("Видалено тригерів догонки: " + n);
}


// ╔══════════════════════════════════════════════════════════╗
// ║  4. ДОПОМІЖНЕ                                            ║
// ╚══════════════════════════════════════════════════════════╝

// Аркуші головного файлу, у яких є блок Telegram.
function tgxSheets_() {
  var out = [];
  try {
    var all = tgSS_(MAIN_FILE_ID).getSheets();
    for (var i = 0; i < all.length; i++) {
      var sh = all[i];
      if (!tgxWanted_(sh.getName())) continue;
      // Блок Telegram починається з 21-ї колонки: аркуш без неї нам нічого не
      // дасть, а читати його — зайвий час і зайві помилки.
      if (sh.getMaxColumns() < TG_MAIN_TGID) continue;
      out.push(sh);
    }
  } catch (err) { Logger.log("tgxSheets_: " + err); }
  return out;
}

// «🔒 2026» → «2026»: емодзі й регістр до уваги не беремо, бо назви аркушів
// люди міняють частіше, ніж код.
//
// Службові аркуші відсікаємо ПЕРШИМИ. Архіви логу звуться
// «_tg_log_архів_12.09.2026_14-07» — у назві є «2026», і без цієї перевірки
// вони потрапляли в перелік просто за збігом. Даних вони не псували (блок
// Telegram там порожній), але читались дарма й лякали у звіті перевірки.
function tgxWanted_(name) {
  var clean = (name || "").toString().toLowerCase();
  if (clean.charAt(0) === "_" || clean.indexOf("_tg_log") !== -1) return false;
  for (var i = 0; i < TGX_SHEETS.length; i++) {
    if (clean.indexOf(TGX_SHEETS[i].toLowerCase()) !== -1) return true;
  }
  return false;
}

function tgxCountRows_(sh) {
  var last = sh.getLastRow();
  if (last < DATA_START) return {rows: 0, withTg: 0};
  var n    = last - DATA_START + 1;
  var tg   = sh.getRange(DATA_START, TG_MAIN_STATUS, n, 1).getValues();
  var dates = sh.getRange(DATA_START, TG_MAIN_DATE, n, 1).getValues();
  var withTg = 0;
  for (var i = 0; i < n; i++) {
    if (tgStr_(tg[i][0]) || tgStr_(dates[i][0])) withTg++;
  }
  return {rows: n, withTg: withTg};
}

// Рядки аркуша → масив для системи. `since` — брати лише свіжіші за дату.
function tgxReadRows_(sh, startRow, count, sheetName, since) {
  var out = [];
  try {
    var last = sh.getLastRow();
    if (startRow > last) return out;
    count = Math.min(count, last - startRow + 1);
    if (count <= 0) return out;

    var ids   = sh.getRange(startRow, COL.ID, count, 1).getValues();
    var phones = sh.getRange(startRow, COL.PHONE, count, 1).getValues();
    var tg    = sh.getRange(startRow, TG_MAIN_STATUS, count, TG_MAIN_TGID - TG_MAIN_STATUS + 1).getValues();
    var is1C  = tgxWanted1C_(sheetName);

    for (var i = 0; i < count; i++) {
      var status = tgStr_(tg[i][0]);                       // 21
      var sentAt = tg[i][TG_MAIN_DATE - TG_MAIN_STATUS];   // 22
      var nick   = tgStr_(tg[i][TG_MAIN_NICK - TG_MAIN_STATUS]);   // 24
      var joined = tg[i][TG_MAIN_JOINED - TG_MAIN_STATUS]; // 25
      var tgid   = tgStr_(tg[i][TG_MAIN_TGID - TG_MAIN_STATUS]);   // 26

      // Ні статусу, ні дат — рядок без роботи, нема що переносити.
      if (!status && !tgxDate_(sentAt) && !tgxDate_(joined)) continue;
      if (since) {
        var newest = tgxNewest_(sentAt, joined);
        if (!newest || newest < since) continue;
      }

      var id = tgStr_(ids[i][0]);
      var row = {
        status: tgxCut_(status, 300),
        sentAt: tgxCut_(tgxIso_(sentAt), 200),
        joinedAt: tgxCut_(tgxIso_(joined), 200),
        nick: tgxCut_(nick, 300),
        telegramId: tgxCut_(tgid, 80),
        phone: tgxCut_(tgStr_(phones[i][0]), 80)
      };
      // Для аркуша 1С ключ — код, а не рядок таблиці. Передаємо його окремим
      // полем: латинська «C» і кирилична «С» в ID виглядають однаково, і
      // звіряти їх на тому боці — шукати пригод.
      if (is1C) row.code1C = tgxCut_(id, 120);
      else row.externalId = tgxCut_(id, 120);
      out.push(row);
    }
  } catch (err) { Logger.log("tgxReadRows_ (" + sheetName + "): " + err); }
  return out;
}

function tgxWanted1C_(name) {
  var clean = (name || "").toString().toLowerCase();
  return clean.indexOf("клієнти 1") !== -1;
}

// Довге значення з клітинки ріжемо тут, а не чекаємо відмови системи: у
// колонці дати трапляється «Thu Oct 01 2026 17:14:35 GMT+0300 (за
// східноєвропейським літнім часом)» — його вставили текстом колись давно.
function tgxCut_(v, max) {
  var s = (v === null || v === undefined) ? "" : String(v);
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function tgxDate_(v) {
  return (v instanceof Date && !isNaN(v.getTime())) ? v : null;
}

// Дата → ISO (найточніше, що є), інакше текст клітинки як є.
function tgxIso_(v) {
  var d = tgxDate_(v);
  if (d) return d.toISOString();
  var s = tgStr_(v);
  return s || null;
}

function tgxNewest_(a, b) {
  var da = tgxDate_(a), db = tgxDate_(b);
  if (da && db) return da > db ? da : db;
  return da || db;
}

function tgxPost_(rows) {
  try {
    var res = UrlFetchApp.fetch(tgEcoApiBase_() + "/api/leads/engagement-import", {
      method: "post",
      contentType: "application/json",
      headers: {"x-leads-secret": tgEcoApiSecret_()},
      payload: JSON.stringify({rows: rows}),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      Logger.log("tgxPost_: HTTP " + code + " — " + res.getContentText().slice(0, 300));
      return null;
    }
    return JSON.parse(res.getContentText());
  } catch (err) {
    Logger.log("tgxPost_: " + err);
    return null;
  }
}

function tgxAccNew_() {
  return {received:0, unmatched:0, statuses:0, events:0,
          skipped:0, failed:0, problem:""};
}

function tgxAcc_(acc, res) {
  if (!res || !res.ok) { acc.failed++; return; }
  acc.received  += res.received || 0;
  acc.unmatched += res.unmatched || 0;
  acc.statuses  += (res.statusesCreated || 0) + (res.statusesUpdated || 0);
  acc.events    += res.eventsCreated || 0;
  acc.skipped   += res.skipped || 0;
  if (!acc.problem && res.problem) acc.problem = res.problem;
}

function tgxCursor_() {
  var raw = tgProp_(TGX_CURSOR) || "";
  var parts = raw.split("|");
  return {
    sheet: parts[0] || "",
    row: Number(parts[1] || 0) || 0,
    passed: !parts[0]
  };
}

function tgxSaveCursor_(sheetName, row) {
  tgSetProp_(TGX_CURSOR, sheetName + "|" + row);
}
