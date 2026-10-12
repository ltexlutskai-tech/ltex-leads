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
//   pushTgHistoryAll()          — колонки статусу: де людина зараз
//   pushTgLogAll()              — ЖУРНАЛ «_tg_log» і його архіви: що сталось і коли
//   installTgHistoryExportTrigger() — щогодинна догонка свіжих рядків
//                                     (колонки + журнал за останні дні)
//   tgCompareDay("07.10.2026")  — чому ранковий звіт і система показують
//                                 різне: кожен рядок журналу за день і що про
//                                 нього каже система (нічого не змінює)
//   tgCompareDay("07.10.2026", true) — те саме + дописати в систему відсутнє
//   tgCompareWeek() / tgCompareWeekApply() — останні 7 днів, без параметрів
//   tgCompareYesterday() / tgCompareYesterdayApply() — за вчора
//
//   Переноси РІЗНІ й потрібні обидва. Колонка статусу — одна клітинка на
//   контакт, остання правда. Журнал — кожне натискання кнопки окремим рядком.
//   «Відкрив бота» і «надіслано повторно» в колонки не потрапляють ніколи,
//   тому без журналу «У боті» у звіті лишається порожнім, а цифри — заниженими.
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
var TGX_LOG_CURSOR   = "TGX_LOG_CURSOR";
var TGX_LOG_MAX_RUN  = 2500;  // рядків журналу за один запуск


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
  var logSheets = tgxLogSheets_(), logRows = 0;
  if (logSheets.length) {
    out.push("");
    out.push("Журнал подій:");
    for (var j = 0; j < logSheets.length; j++) {
      var n2 = Math.max(0, logSheets[j].getLastRow() - 1);
      logRows += n2;
      out.push("  " + logSheets[j].getName() + " — рядків: " + n2);
    }
  }

  out.push("");
  out.push("Разом поїде: " + total + " (колонки) + " + logRows + " (журнал)");
  out.push("Курсор: " + (tgProp_(TGX_CURSOR) || "на початку"));
  out.push("");
  out.push("Перенести: pushTgHistoryAll(), потім pushTgLogAll()");
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
// ║  2б. ЖУРНАЛ «_tg_log» І ЙОГО АРХІВИ                      ║
// ╚══════════════════════════════════════════════════════════╝
// Колонки статусу кажуть, ДЕ людина зараз. Журнал каже, ЩО СТАЛОСЬ і КОЛИ:
// кожне натискання кнопки, кожен вхід у бота, кожне повторне надсилання —
// окремим рядком з датою й менеджером. Саме звідси беруться «У боті» й
// «Повторно», яких у колонках немає в принципі.
//
// Журнал періодично відкладали вбік («_tg_log_архів_<дата>»), тож читаємо і
// чинний, і всі архіви: для нас це один потік подій.
function pushTgLogAll() {
  if (!tgEcoApiBase_() || !tgEcoApiSecret_()) {
    Logger.log("❌ Спершу: tgSetProp_(\"TG_ECO_API\", \"https://new.ltex.com.ua\")");
    return;
  }
  var sheets = tgxLogSheets_();
  if (!sheets.length) { Logger.log("❌ Журналу «" + TG_LOG_SHEET + "» не знайшов."); return; }

  var cur    = tgxCursorOf_(TGX_LOG_CURSOR);
  var seen   = 0, batches = 0, done = true;
  var buffer = [];
  var acc    = {received:0, ignored:0, unmatched:0, created:0, duplicates:0,
                skipped:0, failed:0, problem:"", hint:""};

  for (var i = 0; i < sheets.length; i++) {
    var sh   = sheets[i];
    var name = sh.getName();
    if (cur.sheet && name !== cur.sheet && !cur.passed) continue;
    cur.passed = true;

    var startRow = (name === cur.sheet && cur.row) ? cur.row : 2;  // 1 — заголовок
    var last     = sh.getLastRow();
    if (last < startRow) { cur.sheet = ""; cur.row = 0; continue; }

    for (var r = startRow; r <= last; r += TGX_BATCH) {
      if (seen >= TGX_LOG_MAX_RUN) {
        tgSetProp_(TGX_LOG_CURSOR, name + "|" + r);
        done = false;
        break;
      }
      var count = Math.min(TGX_BATCH, last - r + 1);
      var rows  = tgxReadLog_(sh, r, count);
      seen += count;
      if (!rows.length) continue;

      buffer = buffer.concat(rows);
      while (buffer.length >= TGX_BATCH) {
        tgxAccLog_(acc, tgxPostLog_(buffer.splice(0, TGX_BATCH)));
        batches++;
      }
    }
    if (!done) break;
    cur.sheet = ""; cur.row = 0;
  }

  while (buffer.length) {
    tgxAccLog_(acc, tgxPostLog_(buffer.splice(0, TGX_BATCH)));
    batches++;
  }

  if (done) tgSetProp_(TGX_LOG_CURSOR, "");

  // «✅ перенесено» при жодній прийнятій пачці — найгірший рядок, який ми
  // можемо написати: людина йде далі, а в системі нічого немає. Заголовок
  // дивиться на ПРИЙНЯТЕ, а не на те, що ми дочитали аркуші до кінця.
  var head;
  if (acc.failed && !acc.received) {
    head = "❌ Нічого не перенесено — система не прийняла жодної пачки.";
  } else if (acc.failed) {
    head = "⚠️ Перенесено частково: частину пачок система не прийняла.";
  } else if (done) {
    head = "✅ Журнал перенесено";
  } else {
    head = "⏳ Частину перенесено, запустіть ще раз";
  }

  Logger.log([
    head,
    "Рядків переглянуто: " + seen,
    "Пачок надіслано: " + batches,
    "Прийнято системою: " + acc.received,
    "Подій створено: " + acc.created,
    "Уже були: " + acc.duplicates,
    "Не подія (скасування тощо): " + acc.ignored,
    "Не знайшли картку: " + acc.unmatched,
    acc.skipped ? "⚠️ Пропущено рядків: " + acc.skipped +
                  (acc.problem ? " — " + acc.problem : "") : "",
    acc.failed ? "❌ Пачок не прийнято: " + acc.failed : "",
    acc.hint || "",
    done ? "" : "Курсор: " + tgProp_(TGX_LOG_CURSOR)
  ].join("\n"));
}

function pushTgLogReset() {
  tgSetProp_(TGX_LOG_CURSOR, "");
  Logger.log("Курсор журналу скинуто.");
}

// Чинний журнал і всі його архіви, від найстарішого до найновішого.
function tgxLogSheets_() {
  var out = [];
  try {
    var all = tgSS_(MAIN_FILE_ID).getSheets();
    for (var i = 0; i < all.length; i++) {
      var name = all[i].getName();
      if (name.indexOf(TG_LOG_SHEET) === 0) out.push(all[i]);
    }
  } catch (err) { Logger.log("tgxLogSheets_: " + err); }
  return out;
}

// Рядок журналу: 1 Дата, 2 ID, 3 ПІБ, 4 Телефон, 5 Область, 6 Менеджер,
// 7 Посилання, 8 Джерело, 9 Примітка.
function tgxReadLog_(sh, startRow, count) {
  var out = [];
  try {
    var last = sh.getLastRow();
    if (startRow > last) return out;
    count = Math.min(count, last - startRow + 1);
    if (count <= 0) return out;

    var vals = sh.getRange(startRow, 1, count, 9).getValues();
    for (var i = 0; i < count; i++) {
      var note = tgStr_(vals[i][8]);
      if (!note) continue;
      var at = tgxIso_(vals[i][0]);
      if (!at) continue;

      var id  = tgStr_(vals[i][1]);
      var row = {
        at: tgxCut_(at, 200),
        phone: tgxCut_(tgStr_(vals[i][3]), 80),
        region: tgxCut_(tgStr_(vals[i][4]), 120),
        source: tgxCut_(tgStr_(vals[i][7]), 200),
        note: tgxCut_(note, 400)
      };
      // «1C-4741» — ключ картки з 1С; решта — рядок аркуша лідів.
      if (/^1[CС]-/i.test(id)) row.code1C = tgxCut_(id, 120);
      else if (id) row.externalId = tgxCut_(id, 120);
      out.push(row);
    }
  } catch (err) { Logger.log("tgxReadLog_ (" + sh.getName() + "): " + err); }
  return out;
}

function tgxPostLog_(rows) {
  return tgxSend_("/api/leads/engagement-events", rows, "tgxPostLog_");
}

// Скільки секунд чекати на перезапуск і скільки разів пробувати знову.
// Деплой гасить застосунок на десятки секунд; за цей час скрипт встигає
// спалити всі пачки підряд і відзвітувати «нічого не перенесено» — хоча
// достатньо було почекати.
var TGX_RETRY_WAIT = 15000;
var TGX_RETRIES    = 3;

/**
 * Надіслати пачку. 502/503/504 — не відмова, а «сервер зараз піднімається»:
 * такий код віддає Cloudflare, поки застосунок перезапускається. Чекаємо й
 * пробуємо знову; решту кодів віддаємо як є, бо на них чекання не допоможе.
 */
function tgxSend_(path, rows, tag, extra) {
  for (var attempt = 1; ; attempt++) {
    var res = tgxSendOnce_(path, rows, tag, attempt, extra);
    if (!res || !res.restarting) return res;
    if (attempt > TGX_RETRIES) {
      Logger.log(tag + ": сервер так і не піднявся після " + TGX_RETRIES +
                 " спроб (HTTP " + res.code + ").");
      return res;
    }
    Logger.log(tag + ": HTTP " + res.code + " — сервер перезапускається, " +
               "чекаю " + (TGX_RETRY_WAIT / 1000) + " с (спроба " +
               attempt + " з " + TGX_RETRIES + ")");
    Utilities.sleep(TGX_RETRY_WAIT);
  }
}

function tgxSendOnce_(path, rows, tag, attempt, extra) {
  try {
    var body = {rows: rows};
    if (extra) for (var k in extra) body[k] = extra[k];
    var res = UrlFetchApp.fetch(tgEcoApiBase_() + path, {
      method: "post",
      contentType: "application/json",
      headers: {"x-leads-secret": tgEcoApiSecret_()},
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      // 404 тут завжди означає одне: адреси немає, бо серверна половина ще не
      // задеплоєна. Сервер відповідає сторінкою «не знайдено», і зливати в
      // журнал кілобайт HTML на кожну пачку — це десять екранів розмітки
      // замість одного рядка, з якого видно, що робити.
      // 502/503/504 — застосунок зараз перезапускається. Повідомляє про це
      // той, хто вище нас: він почекає й спробує знову.
      if (code === 502 || code === 503 || code === 504) {
        return {code: code, restarting: true};
      }
      if (code === 404) {
        Logger.log(tag + ": HTTP 404 — такої адреси на сервері немає (" + path +
                   "). Схоже, систему ще не задеплоїли після оновлення.");
      } else {
        Logger.log(tag + ": HTTP " + code + " — " +
                   tgxBrief_(res.getContentText()));
      }
      return {code: code};
    }
    return JSON.parse(res.getContentText());
  } catch (err) {
    Logger.log(tag + " (спроба " + attempt + "): " + err);
    return null;
  }
}

// Відповідь сервера коротко. HTML зрізаємо до типу: у журналі від нього користі
// нема, а місце він займає все.
function tgxBrief_(text) {
  var s = (text || "").toString();
  if (s.indexOf("<!DOCTYPE") === 0 || s.indexOf("<html") === 0) {
    return "(сторінка HTML, не відповідь API)";
  }
  return s.length > 300 ? s.slice(0, 300) : s;
}

function tgxAccLog_(acc, res) {
  if (!res || !res.ok) {
    acc.failed++;
    if (!acc.hint && res && res.code === 404) {
      acc.hint = "👉 Задеплойте систему (.\\scripts\\deploy.ps1 -ApplyMigrations) " +
                 "і запустіть pushTgLogAll() ще раз — нічого не загубиться.";
    } else if (!acc.hint && res && res.restarting) {
      acc.hint = "👉 Сервер перезапускався (схоже, саме йшов деплой). Дочекайтесь, " +
                 "доки сайт відкривається, і запустіть pushTgLogAll() ще раз — " +
                 "нічого не загубиться.";
    }
    return;
  }
  acc.received   += res.received || 0;
  acc.ignored    += res.ignored || 0;
  acc.unmatched  += res.unmatched || 0;
  acc.created    += res.created || 0;
  acc.duplicates += res.duplicates || 0;
  acc.skipped    += res.skipped || 0;
  if (!acc.problem && res.problem) acc.problem = res.problem;
}

function tgxCursorOf_(key) {
  var parts = (tgProp_(key) || "").split("|");
  return {sheet: parts[0] || "", row: Number(parts[1] || 0) || 0, passed: !parts[0]};
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
    tgxPushFreshLog_(since);
  } catch (err) { Logger.log("tgHistoryExportJob: " + err); }
}

// Свіжі рядки ЖУРНАЛУ — у ту саму щогодинну догонку.
//
// Чому (сигнал user 12.10): колонки статусу кажуть лише «де людина зараз».
// «Відкрив бота», «надіслано повторно», вступ за посиланням із таблиці — це
// рядки журналу, і доки журнал їхав у систему тільки ручним pushTgLogAll(),
// сторінка «Залучення в ресурси» показувала за 08–09.10 «Зайшли в бота 0» при
// 9 і 6 у ранковому звіті. Система сама відкидає те, що вже має, тож щогодинна
// повторна відправка тих самих рядків нічого не подвоює.
var TGX_LOG_TAIL = 3000;   // скільки останніх рядків журналу переглядати

function tgxPushFreshLog_(since) {
  try {
    var sh = tgSS_(MAIN_FILE_ID).getSheetByName(TG_LOG_SHEET);
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < 2) return;
    var start = Math.max(2, last - TGX_LOG_TAIL + 1);
    var rows = tgxReadLog_(sh, start, last - start + 1).filter(function (r) {
      var d = new Date(r.at);
      return !isNaN(d.getTime()) && d >= since;
    });
    var acc = {received:0, ignored:0, unmatched:0, created:0, duplicates:0,
               skipped:0, failed:0, problem:"", hint:""};
    while (rows.length) tgxAccLog_(acc, tgxPostLog_(rows.splice(0, TGX_BATCH)));
    if (acc.created || acc.failed) {
      Logger.log("Догонка журналу: нових подій " + acc.created +
                 (acc.failed ? ", пачок не прийнято " + acc.failed : ""));
    }
  } catch (err) { Logger.log("tgxPushFreshLog_: " + err); }
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
// ║  4. ЗВІРКА ДНЯ: РАНКОВИЙ ЗВІТ ↔ СИСТЕМА                  ║
// ╚══════════════════════════════════════════════════════════╝
// Ранковий звіт «📊 РОЗСИЛКА TELEGRAM» рахує рядки журналу «_tg_log», а
// сторінка «Залучення в ресурси» в системі — свій журнал подій. Коли числа
// розходяться, з двох підсумків не видно, ЯКИЙ рядок розійшовся і чому
// (сигнал user 12.10: «перевір щоразу цифри і чому вони не сходяться»).
//
// tgCompareDay("07.10.2026") бере всі рядки журналу за день і питає систему
// про кожен — НІЧОГО не записуючи. Відповідь по рядку одна з:
//   ✅ є в системі цього ж дня
//   ↔ у системі є, але іншого дня (надсилали раніше — там це «повторно»;
//      вступ уже зарахований раніше)
//   ❌ у системі немає
//   ❓ картки в системі не знайдено
// tgCompareDay("07.10.2026", true) — те саме, а відсутнє дописує в систему.
//
// Без дати — за вчора, як і ранковий звіт.

var TGC_KINDS = [
  {key: "sent",   title: "📨 Надіслано вперше", system: "sent_first"},
  {key: "repeat", title: "🔁 Повторно",         system: "sent_repeat"},
  {key: "bot",    title: "💬 Зайшли в бота",    system: "bot_opened"},
  {key: "joined", title: "👤 Приєднались",      system: "joined"},
  {key: "orphan", title: "❓ Вступили без привʼязки", system: "unlinked_join"}
];

function tgCompareDay(day, apply) {
  if (!tgEcoApiBase_() || !tgEcoApiSecret_()) {
    Logger.log("❌ Спершу: tgSetProp_(\"TG_ECO_API\", \"https://new.ltex.com.ua\")");
    return;
  }
  var range = tgcDayRange_(day);
  if (!range) {
    Logger.log("❌ Дата має бути у вигляді \"07.10.2026\" (або без дати — за вчора).");
    return;
  }

  // ── Рядки журналу за день — так само, як їх бачить ранковий звіт ──
  var items = [];
  var sheets = tgxLogSheets_();
  for (var s = 0; s < sheets.length; s++) {
    var sh = sheets[s], last = sh.getLastRow();
    if (last < 2) continue;
    var vals = sh.getRange(2, 1, last - 1, 9).getValues();
    for (var i = 0; i < vals.length; i++) {
      var d = tgcAsDate_(vals[i][0]);
      if (!d || d < range.from || d >= range.to) continue;
      var note = tgStr_(vals[i][8]);
      var src  = tgStr_(vals[i][7]);
      var cat  = tgcCategory_(note, src);
      if (!cat) continue;                               // не рахує й ранковий звіт
      var id = tgStr_(vals[i][1]);
      var payload = {
        at: d.toISOString(),
        phone: tgxCut_(tgStr_(vals[i][3]), 80),
        region: tgxCut_(tgStr_(vals[i][4]), 120),
        source: tgxCut_(src, 200),
        note: tgxCut_(note, 400)
      };
      if (/^1[CС]-/i.test(id)) payload.code1C = tgxCut_(id, 120);
      else if (id) payload.externalId = tgxCut_(id, 120);
      items.push({cat: cat, at: d, id: id, name: tgStr_(vals[i][2]),
                  mgr: tgStr_(vals[i][5]), note: note, payload: payload});
    }
  }
  if (!items.length) {
    Logger.log("За " + range.label + " у журналі таблиці подій немає.");
    return;
  }

  // ── Що каже система про кожен рядок ──
  var failed = 0;
  for (var b = 0; b < items.length; b += TGX_BATCH) {
    var part = items.slice(b, b + TGX_BATCH);
    var res = tgxSend_("/api/leads/engagement-events",
                       part.map(function (it) { return it.payload; }),
                       "tgCompareDay", {dryRun: true});
    if (!res || !res.ok || !res.details) { failed++; continue; }
    for (var k = 0; k < res.details.length; k++) {
      var v = res.details[k];
      if (part[v.i]) part[v.i].verdict = v;
    }
  }
  if (failed) {
    Logger.log("❌ Система не відповіла на " + failed + " пачк(и). Якщо щойно був деплой — " +
               "дочекайтесь, доки сайт відкривається, і запустіть ще раз. Якщо система " +
               "відповідає, а вердиктів немає — її ще не оновили до версії зі звіркою.");
    return;
  }

  // ── Підсумок по видах — як у ранковому звіті, з розкладом ──
  var out = ["🔎 ЗВІРКА ЗА " + range.label + ": журнал таблиці ↔ система", ""];
  var sum = {};
  TGC_KINDS.forEach(function (k) {
    sum[k.key] = {table: 0, same: 0, other: 0, missing: 0, nocard: 0};
  });
  items.forEach(function (it) {
    var st = tgcState_(it, range);
    it.state = st;
    var c = sum[it.cat];
    c.table++;
    c[st.kind]++;
  });
  TGC_KINDS.forEach(function (k) {
    var c = sum[k.key];
    if (!c.table) return;
    out.push(k.title + ": у таблиці " + c.table +
             " → є в системі цього дня " + c.same +
             (c.other   ? " · в системі іншим днем " + c.other : "") +
             (c.missing ? " · немає в системі " + c.missing : "") +
             (c.nocard  ? " · немає картки " + c.nocard : ""));
  });
  out.push("");
  out.push("Система може мати ще й ВЛАСНІ події цього дня (надсилання з картки, " +
           "команда /тг), яких у журналі таблиці немає взагалі — тоді в системі " +
           "число буде більшим.");

  // ── Рядки, що розійшлись ──
  var diff = items.filter(function (it) { return it.state.kind !== "same"; });
  if (diff.length) {
    out.push("");
    out.push("ЩО САМЕ РОЗІЙШЛОСЬ (" + diff.length + "):");
    diff.slice(0, 150).forEach(function (it) {
      out.push("  " + tgcTime_(it.at) + " · " + (it.id || "—") +
               (it.name ? " " + it.name : "") + " · " + it.note.substring(0, 40) +
               " · у таблиці: " + (it.mgr || "без менеджера") +
               "\n      → " + it.state.text);
    });
    if (diff.length > 150) out.push("  … і ще " + (diff.length - 150));
  } else {
    out.push("");
    out.push("✅ Кожен рядок журналу за цей день є в системі тим самим днем.");
  }

  // Менеджер у системі інший — окремо: саме через це «по менеджерах» розходиться
  var moved = items.filter(function (it) {
    var m = it.verdict && it.verdict.manager;
    return m && it.mgr && tgcNorm_(m) !== tgcNorm_(it.mgr) &&
           tgcNorm_(m).indexOf(tgcNorm_(it.mgr)) !== 0 &&
           tgcNorm_(it.mgr).indexOf(tgcNorm_(m)) !== 0;
  });
  if (moved.length) {
    out.push("");
    out.push("ІНШИЙ МЕНЕДЖЕР У СИСТЕМІ (" + moved.length + ") — тому «по менеджерах» числа різні:");
    moved.slice(0, 50).forEach(function (it) {
      out.push("  " + (it.id || "—") + (it.name ? " " + it.name : "") +
               " · у таблиці: " + it.mgr + " · у системі: " + it.verdict.manager);
    });
  }

  // ── Дописати відсутнє ──
  var missing = items.filter(function (it) { return it.state.kind === "missing"; });
  if (apply === true && missing.length) {
    var made = 0, bad = 0;
    for (var m = 0; m < missing.length; m += TGX_BATCH) {
      var r = tgxPostLog_(missing.slice(m, m + TGX_BATCH).map(function (it) { return it.payload; }));
      if (r && r.ok) made += r.created || 0; else bad++;
    }
    out.push("");
    out.push(bad ? "⚠️ Дописано в систему: " + made + ", пачок не прийнято: " + bad
                 : "✅ Дописано в систему подій: " + made);
  } else if (missing.length) {
    out.push("");
    out.push("Дописати відсутнє (" + missing.length + "): tgCompareDay(\"" +
             range.label + "\", true)");
  }

  var text = out.join("\n");
  Logger.log(text);
  return text;
}

// Випадачка редактора Apps Script показує лише функції БЕЗ аргументів, тож
// для запуску кнопкою «Виконати» — готові варіанти.
function tgCompareYesterday()      { return tgCompareDay("", false); }
function tgCompareYesterdayApply() { return tgCompareDay("", true); }
function tgCompareWeek()           { return tgcCompareLastDays_(7, false); }
function tgCompareWeekApply()      { return tgcCompareLastDays_(7, true); }

// Кожен із останніх N днів (без сьогоднішнього) — окремим блоком у журналі.
function tgcCompareLastDays_(n, apply) {
  var now = new Date(), parts = [];
  for (var back = n; back >= 1; back--) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    var t = tgCompareDay(d, apply);
    if (t) parts.push(t);
  }
  return parts.join("\n\n");
}

// Вид рядка — рівно за правилами ранкового звіту (TelegramReport.gs)
function tgcCategory_(note, src) {
  var n = tgStr_(note).toLowerCase(), s = tgStr_(src).toLowerCase();
  if (s.indexOf("скасув") >= 0) return "";
  if (n.indexOf("вперше") === 0) return "sent";
  if (n.indexOf("повторно") === 0) return "repeat";
  if (n.indexOf("приєднався") === 0 || n.indexOf("підписався") === 0) return "joined";
  if (n.indexOf("відкрив бота") === 0) return "bot";
  if (n.indexOf("не привʼязано") === 0 || n.indexOf("не прив'язано") === 0) return "orphan";
  return "";
}

// Що про рядок сказала система — людською мовою
function tgcState_(it, range) {
  var v = it.verdict;
  if (!v) return {kind: "missing", text: "система не відповіла про цей рядок"};
  if (v.verdict === "unmatched") {
    return {kind: "nocard", text: "❓ картки з таким ID чи номером у системі немає — " +
                                  "подія нікуди не лягла"};
  }
  if (v.verdict === "missing" || v.verdict === "created") {
    return {kind: "missing", text: "❌ у системі цієї події немає"};
  }
  if (v.verdict === "ignored") {
    return {kind: "missing", text: "система не вважає цей рядок подією (немає дати?)"};
  }
  var at = v.existingAt ? new Date(v.existingAt) : null;
  if (at && at >= range.from && at < range.to) {
    return {kind: "same", text: "✅ є в системі цього дня"};
  }
  var when = at ? tgcDate_(at) : "раніше";
  var from = tgcSourceLabel_(v.existingSource);
  var text;
  if (it.cat === "sent") {
    text = "↔ цій людині в системі вже надсилали " + when + from +
           " — тому система рахує це «повторно», а не «вперше»";
  } else if (it.cat === "joined") {
    text = "↔ вступ цієї людини система вже зарахувала " + when + from;
  } else {
    text = "↔ у системі ця подія стоїть " + when + from;
  }
  if (v.target === "client" && /^LTEX-/i.test(it.id)) {
    text += " (лід із таблиці — у системі це картка клієнта)";
  }
  return {kind: "other", text: text};
}

function tgcSourceLabel_(src) {
  var s = tgStr_(src);
  if (!s) return "";
  if (s.indexOf("card") === 0) return " (з картки системи)";
  if (s === "viber_cmd") return " (командою /тг у Viber)";
  if (s === "bot" || s.indexOf("site") === 0) return " (бот системи)";
  if (s === "sheet" || s === "sheet_log") return " (з таблиці)";
  if (s === "import") return " (перенос історії)";
  return " (" + s + ")";
}

// «07.10.2026» → межі дня в часовому поясі скрипта; порожньо — вчора
function tgcDayRange_(day) {
  var from;
  if (day instanceof Date) {
    from = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  } else if (tgStr_(day)) {
    var m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(tgStr_(day));
    if (!m) return null;
    from = new Date(+m[3], +m[2] - 1, +m[1]);
  } else {
    var now = new Date();
    from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  }
  var to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1);
  return {from: from, to: to, label: tgcDate_(from)};
}

function tgcAsDate_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  var m = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/.exec(tgStr_(v));
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
}

function tgcDate_(d) {
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return p(d.getDate()) + "." + p(d.getMonth() + 1) + "." + d.getFullYear();
}

function tgcTime_(d) {
  function p(n) { return (n < 10 ? "0" : "") + n; }
  return p(d.getHours()) + ":" + p(d.getMinutes());
}

function tgcNorm_(s) {
  return tgStr_(s).toLowerCase().replace(/[’'`ʼ]/g, "").replace(/\s+/g, " ");
}


// ╔══════════════════════════════════════════════════════════╗
// ║  5. ДОПОМІЖНЕ                                            ║
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
  return tgxSend_("/api/leads/engagement-import", rows, "tgxPost_");
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
