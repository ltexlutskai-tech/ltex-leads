// ============================================================
// L-TEX CRM | TelegramLink.gs  ·  v1.0
// ------------------------------------------------------------
// Статус «посилання на Telegram-канал надіслано клієнту»
// у ГОЛОВНІЙ таблиці та в таблиці КОЖНОГО МЕНЕДЖЕРА
// + кнопка, яка проставляє цей статус АВТОМАТИЧНО.
//
// ЯК ЦЕ ПРАЦЮЄ (людський фактор виключено)
//   1. У кожному рядку зʼявляється кнопка «📨 Надіслати» —
//      це формула =HYPERLINK(...) на наш веб-застосунок.
//   2. Менеджер натискає → відкривається сторінка з УНІКАЛЬНИМ
//      посиланням на Telegram-канал ДЛЯ ОБЛАСТІ цього клієнта
//      + готовим текстом повідомлення (кнопка «Скопіювати»).
//   3. Статус «✅ Надіслано», дата і саме посилання пишуться
//      в таблицю В МОМЕНТ відкриття сторінки — менеджер нічого
//      не відмічає руками. Отримати посилання, не залишивши
//      сліду, неможливо: його видає лише ця сторінка.
//   4. Кожне натискання пишеться в лог «_tg_log»:
//      дата, ID, ПІБ, телефон, область, менеджер, посилання, джерело.
//   5. Посилання унікальне для області → у Telegram видно,
//      хто саме і за яким посиланням приєднався.
//
// НОВІ КОЛОНКИ (додаються в КІНЕЦЬ, наявні дані не зсуваються)
//   головна таблиця → T, U, V, W  (20–23)
//   файл менеджера  → S, T, U, V  (19–22)
//
// ВСТАНОВЛЕННЯ — apps-script/README.md (5 кроків, ~10 хвилин)
// ============================================================


// ── Колонки ───────────────────────────────────────────────
var TG_MAIN_BTN = 20, TG_MAIN_STATUS = 21, TG_MAIN_DATE = 22, TG_MAIN_LINK = 23;
var TG_MGR_BTN  = 19, TG_MGR_STATUS  = 20, TG_MGR_DATE  = 21, TG_MGR_LINK  = 22;

var TG_HDR_BTN    = "📨 Надіслати TG";
var TG_HDR_STATUS = "Статус TG-посилання";
var TG_HDR_DATE   = "Дата надсилання TG";
var TG_HDR_LINK   = "Видане TG-посилання";

var TG_BTN_LABEL      = "📨 Надіслати";
var TG_BTN_LABEL_SENT = "🔁 Посилання";

var TG_STATUS_SENT = "✅ Надіслано";
var TG_STATUS_LIST = [TG_STATUS_SENT, "👤 Приєднався", "🚫 Не потрібно", "❌ Відмовився"];

// ── Аркуші ────────────────────────────────────────────────
var TG_LINKS_SHEET = "🔗 TG-посилання";
var TG_LOG_SHEET   = "_tg_log";
var TG_DICT_COL    = 7;   // колонка G аркуша «Довідники» — список статусів

// Дані в таблицях менеджерів — з 5-го рядка (як у Code.gs)
var TG_MGR_DATA_START = 5;

// Області для аркуша «🔗 TG-посилання» (ключі — як у REGION_TO_MANAGER)
var TG_REGIONS = [
  "Вінницька","Волинська","Дніпропетровська","Донецька","Житомирська",
  "Закарпатська","Запорізька","Івано-Франківська","Київська","Кіровоградська",
  "Луганська","Львівська","Миколаївська","Одеська","Полтавська",
  "Рівненська","Сумська","Тернопільська","Харківська","Херсонська",
  "Хмельницька","Черкаська","Чернівецька","Чернігівська",
  "За замовчуванням"
];

// Текст повідомлення клієнту. Можна перевизначити у Script Properties
// ключем TG_MSG_TEMPLATE. Плейсхолдери: {name}, {manager}, {link}
var TG_MSG_DEFAULT =
  "Вітаю, {name}! 👋\n" +
  "Це {manager}, компанія L-TEX.\n" +
  "Надсилаю посилання на наш Telegram-канал — там каталог, новинки та ціни:\n" +
  "{link}\n\n" +
  "Напишіть, будь ласка, як приєднаєтесь — підкажу, з чого почати. 🙌";


// ╔══════════════════════════════════════════════════════════╗
// ║  1. ВСТАНОВЛЕННЯ (запустити ОДИН РАЗ з редактора)        ║
// ╚══════════════════════════════════════════════════════════╝
// Безпечно запускати повторно: нічого не дублює і не затирає.
// Запускати ще раз треба після додавання НОВОГО менеджера.
function installTgColumns() {
  var report = [];

  try { ensureTgLinksSheet_();  report.push("✅ Аркуш «" + TG_LINKS_SHEET + "» готовий"); }
  catch (err) { report.push("❌ " + TG_LINKS_SHEET + ": " + err); }

  try { ensureTgLogSheet_();    report.push("✅ Аркуш «" + TG_LOG_SHEET + "» готовий"); }
  catch (err) { report.push("❌ " + TG_LOG_SHEET + ": " + err); }

  try { ensureTgStatusDictionary_(); report.push("✅ Довідники: колонка G «" + TG_HDR_STATUS + "»"); }
  catch (err) { report.push("❌ Довідники: " + err); }

  try {
    var main = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    if (!main) throw new Error("аркуш «" + MAIN_SHEET + "» не знайдено");
    tgSetupSheet_(main, {btn: TG_MAIN_BTN, status: TG_MAIN_STATUS, date: TG_MAIN_DATE, link: TG_MAIN_LINK});
    report.push("✅ Головна «" + MAIN_SHEET + "»: колонки T, U, V, W додано");
  } catch (err) { report.push("❌ Головна: " + err); }

  var managers = getManagers();
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) { report.push("ℹ️ " + name + ": немає файлу — пропущено"); continue; }
    try {
      var sh = SpreadsheetApp.openById(fileId).getSheets()[0];
      tgSetupSheet_(sh, {btn: TG_MGR_BTN, status: TG_MGR_STATUS, date: TG_MGR_DATE, link: TG_MGR_LINK});
      report.push("✅ " + name + ": колонки S, T, U, V додано");
    } catch (err) { report.push("❌ " + name + ": " + err); }
  }

  try {
    var filled = tgRefreshAll_(true);
    report.push("✅ Кнопок проставлено: " + filled);
  } catch (err) { report.push("❌ Кнопки: " + err); }

  Logger.log(report.join("\n"));
  Logger.log("=== Далі: 1) впишіть посилання в аркуш «" + TG_LINKS_SHEET + "»  " +
             "2) Deploy → Manage deployments → New version  3) setupTgTrigger() ===");
  return report.join("\n");
}

// Додає 4 колонки в кінець конкретного аркуша (ідемпотентно)
function tgSetupSheet_(sheet, cols) {
  var hdrRow = tgHeaderRow_(sheet);

  if (sheet.getMaxColumns() < cols.link) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), cols.link - sheet.getMaxColumns());
  }

  // Заголовки — у стилі сусідньої колонки
  var sample = sheet.getRange(hdrRow, Math.max(1, cols.btn - 1));
  var bg = sample.getBackground(), fc = sample.getFontColor();
  sheet.getRange(hdrRow, cols.btn, 1, 4)
       .setValues([[TG_HDR_BTN, TG_HDR_STATUS, TG_HDR_DATE, TG_HDR_LINK]])
       .setFontWeight("bold").setBackground(bg).setFontColor(fc)
       .setWrap(true).setVerticalAlignment("middle");

  var nRows = sheet.getMaxRows() - hdrRow;
  if (nRows > 0) {
    sheet.getRange(hdrRow + 1, cols.btn,    nRows, 1).setHorizontalAlignment("center");
    sheet.getRange(hdrRow + 1, cols.status, nRows, 1).setDataValidation(tgStatusRule_());
    sheet.getRange(hdrRow + 1, cols.link,   nRows, 1).setFontSize(9).setWrap(false);
  }
  sheet.setColumnWidth(cols.btn,    120);
  sheet.setColumnWidth(cols.status, 160);
  sheet.setColumnWidth(cols.date,   140);
  sheet.setColumnWidth(cols.link,   230);

  tgConditionalFormat_(sheet, cols, hdrRow);

  // Якщо зверху є обʼєднана «шапка» — розтягуємо на нові колонки
  if (typeof extendTitleMerges_ === "function") {
    try { extendTitleMerges_(sheet, cols.link, hdrRow); } catch (err) { Logger.log("tgSetupSheet_ merge: " + err); }
  }
}

// Зелений — надіслано, жовтий — рядок з клієнтом, але посилання ще не надіслане
function tgConditionalFormat_(sheet, cols, hdrRow) {
  try {
    var firstRow = hdrRow + 1;
    var nRows = Math.max(sheet.getMaxRows() - hdrRow, 1);
    var range = sheet.getRange(firstRow, cols.status, nRows, 1);
    var letter = tgColLetter_(cols.status);

    // прибираємо наші попередні правила на цю колонку (щоб не дублювались)
    var rules = sheet.getConditionalFormatRules().filter(function (r) {
      var rs = r.getRanges();
      for (var i = 0; i < rs.length; i++) {
        if (rs[i].getColumn() === cols.status && rs[i].getNumColumns() === 1) return false;
      }
      return true;
    });

    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextStartsWith("✅").setBackground("#d9ead3").setFontColor("#0b6b3a")
      .setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .whenTextStartsWith("👤").setBackground("#c9e5ff").setFontColor("#0b4a7a")
      .setRanges([range]).build());
    rules.push(SpreadsheetApp.newConditionalFormatRule()
      .withCriteria(SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA,
                    ['=AND($A' + firstRow + '<>"",' + letter + firstRow + '="")'])
      .setBackground("#fff2cc").setRanges([range]).build());

    sheet.setConditionalFormatRules(rules);
  } catch (err) { Logger.log("tgConditionalFormat_: " + err); }
}

// Заголовок таблиці = рядок, у першій колонці якого стоїть "ID"
function tgHeaderRow_(sheet) {
  var scan = Math.min(6, sheet.getMaxRows());
  var vals = sheet.getRange(1, 1, scan, 1).getValues();
  for (var i = 0; i < scan; i++) {
    if (vals[i][0] && vals[i][0].toString().trim().toUpperCase() === "ID") return i + 1;
  }
  return DATA_START - 1;   // за замовчуванням — рядок 4
}


// ╔══════════════════════════════════════════════════════════╗
// ║  2. КНОПКИ: заповнення формул + звірка статусів          ║
// ╚══════════════════════════════════════════════════════════╝

// Тригер (кожні 15 хв): доставляє кнопки новим лідам і звіряє
// статуси між головною таблицею та файлами менеджерів.
function setupTgTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgRefreshJob") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tgRefreshJob").timeBased().everyMinutes(15).create();
  Logger.log("✅ Тригер кнопок TG встановлено: кожні 15 хвилин");
}

function removeTgTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgRefreshJob") { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log("Видалено тригерів: " + n);
}

function tgRefreshJob()       { tgRefreshAll_(false); }
function refreshTgButtons()   { return tgRefreshAll_(false); }   // тільки нові рядки
function refreshTgButtonsForce() { return tgRefreshAll_(true); } // перезаписати ВСІ кнопки

function tgRefreshAll_(force) {
  var main = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!main) { Logger.log("TG: аркуш " + MAIN_SHEET + " не знайдено"); return 0; }
  var lastRow = main.getLastRow();
  if (lastRow < DATA_START) return 0;
  if (main.getMaxColumns() < TG_MAIN_LINK) { Logger.log("TG: спочатку запустіть installTgColumns()"); return 0; }

  var n       = lastRow - DATA_START + 1;
  var ids     = main.getRange(DATA_START, COL.ID,      n, 1).getValues();
  var mgrCol  = main.getRange(DATA_START, COL.MANAGER, n, 1).getValues();
  var changed = tgFillButtons_(main, DATA_START, ids, TG_MAIN_BTN, TG_MAIN_STATUS, force);

  // Мапа ID → статус у головній (для звірки з менеджерами)
  var tg = main.getRange(DATA_START, TG_MAIN_STATUS, n, 3).getValues();
  var byId = {};
  for (var i = 0; i < n; i++) {
    var id = ids[i][0] ? ids[i][0].toString().trim() : "";
    if (!id) continue;
    byId[id] = {
      i: i, row: DATA_START + i,
      manager: mgrCol[i][0] ? mgrCol[i][0].toString().trim() : "",
      status:  tg[i][0] ? tg[i][0].toString().trim() : "",
      date:    tg[i][1] ? tg[i][1].toString().trim() : "",
      link:    tg[i][2] ? tg[i][2].toString().trim() : ""
    };
  }

  var managers = getManagers(), up = 0, down = 0;
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) continue;
    try {
      var sh = SpreadsheetApp.openById(fileId).getSheets()[0];
      var ml = sh.getLastRow();
      if (ml < TG_MGR_DATA_START) continue;
      if (sh.getMaxColumns() < TG_MGR_LINK) { Logger.log("TG: " + name + " — немає колонок, запустіть installTgColumns()"); continue; }

      var mn    = ml - TG_MGR_DATA_START + 1;
      var mIds  = sh.getRange(TG_MGR_DATA_START, 1, mn, 1).getValues();
      changed  += tgFillButtons_(sh, TG_MGR_DATA_START, mIds, TG_MGR_BTN, TG_MGR_STATUS, force);

      var mTg = sh.getRange(TG_MGR_DATA_START, TG_MGR_STATUS, mn, 3).getValues();
      for (var j = 0; j < mn; j++) {
        var mid = mIds[j][0] ? mIds[j][0].toString().trim() : "";
        if (!mid) continue;
        var rec = byId[mid];
        if (!rec) continue;
        var ms = mTg[j][0] ? mTg[j][0].toString().trim() : "";
        var rMain = tgRank_(rec.status), rMgr = tgRank_(ms);

        if (rMgr > rMain) {
          // менеджер просунув статус далі (напр. «👤 Приєднався») → піднімаємо в головну
          rec.status = ms;
          rec.date   = mTg[j][1] ? mTg[j][1].toString().trim() : rec.date;
          rec.link   = mTg[j][2] ? mTg[j][2].toString().trim() : rec.link;
          main.getRange(rec.row, TG_MAIN_STATUS, 1, 3).setValues([[rec.status, rec.date, rec.link]]);
          up++;
        } else if (rMain > rMgr) {
          // у менеджера статус «молодший» (найчастіше порожній) → опускаємо з головної
          sh.getRange(TG_MGR_DATA_START + j, TG_MGR_STATUS, 1, 3)
            .setValues([[rec.status, rec.date, rec.link]]);
          down++;
        }
        // однаковий «вік» статусу (напр. «🚫 Не потрібно» vs «❌ Відмовився») —
        // не чіпаємо жодну зі сторін, щоб не затерти ручну правку
      }
    } catch (err) { Logger.log("tgRefreshAll_ (" + name + "): " + err); }
  }

  Logger.log("TG refresh: кнопок " + changed + ", статусів вгору " + up + ", вниз " + down);
  return changed;
}

// Проставляє формулу-кнопку там, де її немає (або всюди, якщо force)
function tgFillButtons_(sheet, startRow, ids, btnCol, statusCol, force) {
  var n = ids.length;
  if (!n || sheet.getMaxColumns() < btnCol) return 0;
  var rng = sheet.getRange(startRow, btnCol, n, 1);
  var cur = rng.getFormulas();
  var out = [], changed = 0;

  for (var i = 0; i < n; i++) {
    var id = ids[i][0] ? ids[i][0].toString().trim() : "";
    var f  = cur[i][0] || "";
    if (!id) {
      if (f.indexOf("a=tg") >= 0) { out.push([""]); changed++; }   // рядок без ID — прибираємо кнопку
      else out.push([f]);
      continue;
    }
    if (force || f.indexOf("a=tg&id=" + id) === -1) {
      out.push([tgButtonFormula_(id, "$" + tgColLetter_(statusCol) + (startRow + i))]);
      changed++;
    } else {
      out.push([f]);
    }
  }
  if (changed) rng.setFormulas(out);
  return changed;
}

// Формула кнопки. Напис міняється залежно від статусу в рядку.
function tgButtonFormula_(id, statusRef) {
  var url = getTgTrackUrl_() + "?a=tg&id=" + encodeURIComponent(id) + "&t=" + tgToken_(id);
  return '=HYPERLINK("' + url + '",IF(' + statusRef + '="","' + TG_BTN_LABEL + '","' + TG_BTN_LABEL_SENT + '"))';
}

function tgColLetter_(col) {
  var s = "";
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = (col - m - 1) / 26; }
  return s;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  3. ОБРОБНИК НАТИСКАННЯ (виклик з doGet у Code.gs)       ║
// ╚══════════════════════════════════════════════════════════╝
// Патч у Code.gs → function doGet(e), ПЕРШИМ рядком:
//   if (e && e.parameter && e.parameter.a === "tg") return handleTgClick(e);
function handleTgClick(e) {
  try {
    var p  = (e && e.parameter) || {};
    var id = (p.id || "").toString().trim();
    if (!id) return tgPage_(tgErrorBody_("Не передано ID клієнта.", ""));

    if ((p.t || "") !== tgToken_(id)) {
      return tgPage_(tgErrorBody_("Посилання застаріле або пошкоджене.",
        "Запустіть у редакторі Apps Script функцію refreshTgButtonsForce() — кнопки оновляться."));
    }

    if (p.undo === "1") {
      var u = tgUndo_(id);
      if (!u.ok) return tgPage_(tgErrorBody_(u.error, ""));
      return tgPage_(tgUndoBody_(u));
    }

    var r = markTgSent_(id, "кнопка в таблиці");
    if (!r.ok) return tgPage_(tgErrorBody_(r.error, ""));
    return tgPage_(tgLandingBody_(r));

  } catch (err) {
    Logger.log("handleTgClick: " + err);
    return tgPage_(tgErrorBody_("Помилка: " + err, ""));
  }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  4. ЯДРО: проставляння статусу                           ║
// ╚══════════════════════════════════════════════════════════╝
// source: "кнопка в таблиці" | "бот Viber" | ...
function markTgSent_(id, source) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return {ok: false, error: "Система зайнята, спробуйте ще раз за секунду."};
  try {
    var main = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    if (!main) return {ok: false, error: "Аркуш «" + MAIN_SHEET + "» не знайдено."};
    var row = tgFindRow_(main, COL.ID, DATA_START, id);
    if (row === -1) return {ok: false, error: "Клієнта " + id + " не знайдено в таблиці."};

    var d = main.getRange(row, 1, 1, TG_MAIN_LINK).getValues()[0];
    var info = {
      ok: true, id: id, row: row,
      name:     tgStr_(d[COL.NAME - 1]),
      phone:    tgStr_(d[COL.PHONE - 1]),
      region:   tgStr_(d[COL.REGION - 1]),
      city:     tgStr_(d[COL.CITY - 1]),
      manager:  tgStr_(d[COL.MANAGER - 1]),
      interest: tgStr_(d[COL.INTEREST - 1])
    };

    var prevStatus = tgStr_(d[TG_MAIN_STATUS - 1]);
    var prevDate   = tgStr_(d[TG_MAIN_DATE - 1]);
    var prevLink   = tgStr_(d[TG_MAIN_LINK - 1]);
    var repeat     = tgIsSent_(prevStatus);

    // Посилання: вже видане раніше → віддаємо те саме (щоб статистика в Telegram не «розʼїхалась»)
    var res = prevLink ? {link: prevLink, row: 0, key: tgNormRegion_(info.region)} : tgResolveLink_(info);
    info.link      = res.link;
    info.linkRow   = res.row;
    info.noLink    = !res.link;
    info.repeat    = repeat;
    info.source    = source;

    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
    info.sentAt = repeat && prevDate ? prevDate : stamp;

    var vals = [[repeat ? prevStatus : TG_STATUS_SENT, info.sentAt, info.link || prevLink]];
    main.getRange(row, TG_MAIN_STATUS, 1, 3).setValues(vals);
    try {
      main.getRange(row, TG_MAIN_STATUS).setNote(
        "Надіслав: " + (info.manager || "—") + "\nДжерело: " + source + "\nОстаннє відкриття: " + stamp);
    } catch (err) { Logger.log("note: " + err); }
    SpreadsheetApp.flush();

    tgSyncToManager_(info.manager, id, vals[0]);
    tgLogAppend_([new Date(), id, info.name, info.phone, info.region, info.manager,
                  info.link, source, repeat ? "повторно" : "вперше"]);
    if (!repeat && res.row) tgBumpCounter_(res.row, stamp);

    return info;
  } catch (err) {
    Logger.log("markTgSent_: " + err);
    return {ok: false, error: "Помилка запису: " + err};
  } finally {
    lock.releaseLock();
  }
}

// Скасування помилкового натискання
function tgUndo_(id) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return {ok: false, error: "Система зайнята, спробуйте ще раз."};
  try {
    var main = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    var row  = tgFindRow_(main, COL.ID, DATA_START, id);
    if (row === -1) return {ok: false, error: "Клієнта " + id + " не знайдено."};
    var d = main.getRange(row, 1, 1, TG_MAIN_LINK).getValues()[0];
    var info = {ok: true, id: id, name: tgStr_(d[COL.NAME - 1]), manager: tgStr_(d[COL.MANAGER - 1])};

    main.getRange(row, TG_MAIN_STATUS, 1, 2).setValues([["", ""]]);
    try { main.getRange(row, TG_MAIN_STATUS).clearNote(); } catch (err) { Logger.log("clearNote: " + err); }
    SpreadsheetApp.flush();
    tgSyncToManager_(info.manager, id, ["", "", tgStr_(d[TG_MAIN_LINK - 1])]);
    tgLogAppend_([new Date(), id, info.name, tgStr_(d[COL.PHONE - 1]), tgStr_(d[COL.REGION - 1]),
                  info.manager, "", "скасування", "скасовано"]);
    return info;
  } finally { lock.releaseLock(); }
}

// Пише статус у файл менеджера
function tgSyncToManager_(managerName, id, vals) {
  try {
    if (!managerName) return;
    var m = getManagers()[managerName];
    if (!m || !m.fileId) return;
    var sh = SpreadsheetApp.openById(m.fileId).getSheets()[0];
    if (sh.getMaxColumns() < TG_MGR_LINK) return;
    var row = tgFindRow_(sh, 1, TG_MGR_DATA_START, id);
    if (row === -1) return;
    sh.getRange(row, TG_MGR_STATUS, 1, 3).setValues([vals]);
  } catch (err) { Logger.log("tgSyncToManager_: " + err); }
}

function tgFindRow_(sheet, idCol, startRow, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return -1;
  var data = sheet.getRange(startRow, idCol, lastRow - startRow + 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (data[i][0] && data[i][0].toString().trim() === id) return startRow + i;
  }
  return -1;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  5. УНІКАЛЬНІ ПОСИЛАННЯ ПО ОБЛАСТЯХ                      ║
// ╚══════════════════════════════════════════════════════════╝

function ensureTgLinksSheet_() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sh = ss.getSheetByName(TG_LINKS_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TG_LINKS_SHEET);
    sh.getRange(1, 1, 1, 5).setValues([[
      "Область", "Унікальне посилання Telegram", "Chat ID каналу (необовʼязково)",
      "Надіслано разів", "Останнє надсилання"
    ]]).setFontWeight("bold").setBackground("#2E6DA4").setFontColor("#FFFFFF").setWrap(true);
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 180); sh.setColumnWidth(2, 320);
    sh.setColumnWidth(3, 180); sh.setColumnWidth(4, 130); sh.setColumnWidth(5, 150);
  }

  // Доливаємо відсутні області (наявні рядки не чіпаємо)
  var lastRow  = sh.getLastRow();
  var existing = {};
  if (lastRow >= 2) {
    sh.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function (r) {
      var k = tgNormRegion_(r[0]);
      if (k) existing[k] = true;
    });
  }
  var missing = TG_REGIONS.filter(function (r) { return !existing[tgNormRegion_(r)]; });
  if (missing.length) {
    var firstFree = sh.getLastRow() + 1;
    if (sh.getMaxRows() < firstFree + missing.length - 1) {
      sh.insertRowsAfter(sh.getMaxRows(), firstFree + missing.length - 1 - sh.getMaxRows());
    }
    sh.getRange(firstFree, 1, missing.length, 1)
      .setValues(missing.map(function (r) { return [r]; }));
  }
  return sh;
}

// Мапа: нормалізована область → {link, row, chatId}
function tgLinksMap_() {
  var map = {};
  try {
    var sh = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(TG_LINKS_SHEET);
    if (!sh || sh.getLastRow() < 2) return map;
    var data = sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues();
    for (var i = 0; i < data.length; i++) {
      var key = tgNormRegion_(data[i][0]);
      if (!key) continue;
      map[key] = {link: tgStr_(data[i][1]), chatId: tgStr_(data[i][2]), row: i + 2};
    }
  } catch (err) { Logger.log("tgLinksMap_: " + err); }
  return map;
}

// Головна функція вибору посилання для клієнта
function tgResolveLink_(info) {
  var map  = tgLinksMap_();
  var key  = tgNormRegion_(info.region);
  var rec  = key ? map[key] : null;

  if (!rec && key) {                       // часткове співпадіння («київ» ↔ «київська»)
    for (var k in map) {
      if (k.indexOf(key) === 0 || key.indexOf(k) === 0) { rec = map[k]; break; }
    }
  }
  if (!rec || !rec.link) rec = map[tgNormRegion_("За замовчуванням")] || rec;

  var out = {link: rec ? rec.link : "", row: rec ? rec.row : 0, key: key};

  // Необовʼязково: персональне одноразове посилання через Telegram-бота
  var personal = tgPersonalLink_(info, rec);
  if (personal) out.link = personal;
  return out;
}

// Персональне посилання (вмикається лише якщо задані Script Properties
// TG_BOT_TOKEN і TG_LINK_MODE = "personal" або "request").
// Назва посилання = ID + ПІБ → у Telegram видно, ХТО саме приєднався.
function tgPersonalLink_(info, rec) {
  try {
    var props = PropertiesService.getScriptProperties();
    var mode  = (props.getProperty("TG_LINK_MODE") || "").trim();
    if (mode !== "personal" && mode !== "request") return "";
    var token = (props.getProperty("TG_BOT_TOKEN") || "").trim();
    if (!token) return "";
    var chatId = (rec && rec.chatId) || (props.getProperty("TG_CHAT_ID") || "").trim();
    if (!chatId) return "";

    var payload = {chat_id: chatId, name: (info.id + " " + info.name).substring(0, 32)};
    if (mode === "personal") payload.member_limit = 1;
    else payload.creates_join_request = true;

    var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/createChatInviteLink", {
      method: "post", contentType: "application/json",
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var j = JSON.parse(res.getContentText());
    if (j && j.ok && j.result && j.result.invite_link) return j.result.invite_link;
    Logger.log("tgPersonalLink_: " + res.getContentText().substring(0, 200));
  } catch (err) { Logger.log("tgPersonalLink_: " + err); }
  return "";
}

function tgBumpCounter_(row, stamp) {
  try {
    var sh = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(TG_LINKS_SHEET);
    if (!sh || !row) return;
    var cur = sh.getRange(row, 4).getValue();
    sh.getRange(row, 4).setValue((parseInt(cur, 10) || 0) + 1);
    sh.getRange(row, 5).setValue(stamp);
  } catch (err) { Logger.log("tgBumpCounter_: " + err); }
}

// «Київська обл.» / «м. Київ» / «Івано Франківська» → єдиний ключ
function tgNormRegion_(s) {
  if (!s) return "";
  var t = s.toString().toLowerCase().trim()
    .replace(/[’'`ʼ]/g, "")
    .replace(/(^|\s)м\.?\s+/g, " ")
    .replace(/(^|\s)обл[а-яґєіїй]*\.?(?=$|\s)/g, " ")
    .replace(/\s+/g, " ").trim()
    .replace(/\s/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (t.indexOf("запор") === 0) t = "запорізька";
  if (t.indexOf("івано") === 0) t = "івано-франківська";
  if (t.indexOf("київ")  === 0) t = "київська";
  if (t.indexOf("замовчув") >= 0 || t === "інші" || t === "default") t = "за-замовчуванням";
  return t;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  6. ЛОГ НАДСИЛАНЬ                                        ║
// ╚══════════════════════════════════════════════════════════╝

function ensureTgLogSheet_() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sh = ss.getSheetByName(TG_LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TG_LOG_SHEET);
    sh.getRange(1, 1, 1, 9).setValues([[
      "Дата", "ID", "ПІБ", "Телефон", "Область", "Менеджер", "Посилання", "Джерело", "Примітка"
    ]]).setFontWeight("bold");
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

function tgLogAppend_(row) {
  try { ensureTgLogSheet_().appendRow(row); }
  catch (err) { Logger.log("tgLogAppend_: " + err); }
}

// Відновлення статусів з логу (якщо колонки випадково затерли)
function restoreTgStatusesFromLog() {
  var ss  = SpreadsheetApp.openById(MAIN_FILE_ID);
  var log = ss.getSheetByName(TG_LOG_SHEET);
  if (!log || log.getLastRow() < 2) { Logger.log("Лог порожній"); return; }
  var rows = log.getRange(2, 1, log.getLastRow() - 1, 9).getValues();
  var first = {};
  rows.forEach(function (r) {
    var id = tgStr_(r[1]);
    if (!id) return;
    if (tgStr_(r[8]) === "скасовано") { delete first[id]; return; }
    if (!first[id]) {
      first[id] = {
        date: r[0] instanceof Date
          ? Utilities.formatDate(r[0], Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm")
          : tgStr_(r[0]),
        link: tgStr_(r[6])
      };
    }
  });

  var main    = ss.getSheetByName(MAIN_SHEET);
  var lastRow = main.getLastRow();
  if (lastRow < DATA_START) return;
  var n    = lastRow - DATA_START + 1;
  var ids  = main.getRange(DATA_START, COL.ID, n, 1).getValues();
  var tg   = main.getRange(DATA_START, TG_MAIN_STATUS, n, 3).getValues();
  var cnt  = 0;
  for (var i = 0; i < n; i++) {
    var id = tgStr_(ids[i][0]);
    if (!id || !first[id]) continue;
    if (tgIsSent_(tgStr_(tg[i][0]))) continue;
    tg[i][0] = TG_STATUS_SENT;
    tg[i][1] = first[id].date;
    tg[i][2] = first[id].link || tg[i][2];
    cnt++;
  }
  if (cnt) main.getRange(DATA_START, TG_MAIN_STATUS, n, 3).setValues(tg);
  Logger.log("Відновлено рядків: " + cnt + ". Далі запустіть refreshTgButtons() для звірки з менеджерами.");
}


// ╔══════════════════════════════════════════════════════════╗
// ║  7. КОМАНДА БОТА:  /тг 0671234567                        ║
// ╚══════════════════════════════════════════════════════════╝
// Патч у Code.gs → doPost, поруч з іншими командами:
//   if (tl.startsWith("/тг")||tl.startsWith("/tg")) { handleTgCommand(text, sender); return okResponse(); }
function handleTgCommand(text, sender) {
  try {
    var q = text.replace(/^\/(тг|tg)\s*/i, "").trim().replace(/\D/g, "").slice(-9);
    if (!q || q.length < 9) {
      sendViber(sender.id, "Формат команди:\n/тг 0671234567\n\n" +
        "Бот віддасть унікальне посилання на Telegram-канал для області цього клієнта\n" +
        "і сам проставить статус «" + TG_STATUS_SENT + "» у таблиці.");
      return;
    }

    var main    = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    var lastRow = main.getLastRow();
    if (lastRow < DATA_START) { sendViber(sender.id, "У таблиці немає даних."); return; }
    var data = main.getRange(DATA_START, 1, lastRow - DATA_START + 1, COL.MANAGER).getValues();
    var id = "";
    for (var i = 0; i < data.length; i++) {
      var ph = data[i][COL.PHONE - 1] ? data[i][COL.PHONE - 1].toString().replace(/\D/g, "").slice(-9) : "";
      if (ph.length >= 8 && ph === q) { id = tgStr_(data[i][COL.ID - 1]); break; }
    }
    if (!id) {
      sendViber(sender.id, "❌ Клієнта з номером 0" + q + " немає в CRM.\n" +
        "Спочатку додайте ліда: /шаблон");
      return;
    }

    var r = markTgSent_(id, "бот Viber (" + ((sender && sender.name) || "—") + ")");
    if (!r.ok) { sendViber(sender.id, "Помилка: " + r.error); return; }
    if (r.noLink) {
      sendViber(sender.id, "⚠️ Для області «" + (r.region || "—") + "» ще не задано посилання.\n" +
        "Додайте його в аркуш «" + TG_LINKS_SHEET + "» головної таблиці.");
      return;
    }

    sendViber(sender.id,
      (r.repeat ? "🔁 Посилання вже надсилали " + r.sentAt + "\n\n" : "✅ Статус проставлено автоматично\n\n") +
      "Клієнт: " + (r.name || "—") + "\nОбласть: " + (r.region || "—") + "\nID: " + r.id + "\n\n" +
      "Текст для клієнта (скопіюйте):");
    sendViber(sender.id, tgMessageText_(r));
  } catch (err) {
    Logger.log("handleTgCommand: " + err);
    sendViber(sender.id, "Помилка: " + err);
  }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  8. ЗВІТ                                                 ║
// ╚══════════════════════════════════════════════════════════╝
// Патч у Code.gs → sendDailyReport(), перед notifyOwners(report):
//   report += getTgStatsBlock_();
function getTgStatsBlock_() {
  try {
    var main = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    if (!main || main.getMaxColumns() < TG_MAIN_LINK) return "";
    var lastRow = main.getLastRow();
    if (lastRow < DATA_START) return "";

    var tz   = Session.getScriptTimeZone();
    var yDay = Utilities.formatDate(new Date(Date.now() - 86400000), tz, "dd.MM.yyyy");
    var n    = lastRow - DATA_START + 1;
    var data = main.getRange(DATA_START, 1, n, TG_MAIN_LINK).getValues();

    var total = 0, sent = 0, joined = 0, yest = 0;
    var byMgr = {};
    data.forEach(function (r) {
      if (!r[COL.NAME - 1] && !r[COL.PHONE - 1]) return;
      total++;
      var mgr = tgStr_(r[COL.MANAGER - 1]) || "Без менеджера";
      if (!byMgr[mgr]) byMgr[mgr] = {sent: 0, left: 0};
      var st = tgStr_(r[TG_MAIN_STATUS - 1]);
      if (tgIsSent_(st)) {
        sent++; byMgr[mgr].sent++;
        if (st.indexOf("👤") === 0) joined++;
        if (tgStr_(r[TG_MAIN_DATE - 1]).indexOf(yDay) === 0) yest++;
      } else {
        byMgr[mgr].left++;
      }
    });
    if (!total) return "";

    var pct = Math.round(sent * 100 / total);
    var out = "\n🔗 Посилання на Telegram-канал: " + sent + " з " + total + " (" + pct + "%)\n";
    out += "  Надіслано вчора: " + yest + "\n";
    if (joined) out += "  Приєдналось: " + joined + "\n";
    var list = [];
    for (var m in byMgr) list.push({name: m, sent: byMgr[m].sent, left: byMgr[m].left});
    list.sort(function (a, b) { return b.left - a.left; });
    out += "  Залишилось надіслати:\n";
    list.forEach(function (it) {
      if (it.left > 0) out += "   - " + it.name + ": " + it.left + " (надіслано " + it.sent + ")\n";
    });
    return out;
  } catch (err) { Logger.log("getTgStatsBlock_: " + err); return ""; }
}

// Окремий звіт (якщо не патчити sendDailyReport)
function sendTgReport() {
  var block = getTgStatsBlock_();
  if (!block) { Logger.log("TG: немає даних для звіту"); return; }
  notifyOwners("Звіт L-TEX CRM — Telegram-посилання\n================================" + block);
  Logger.log(block);
}


// ╔══════════════════════════════════════════════════════════╗
// ║  9. СТОРІНКА, ЯКА ВІДКРИВАЄТЬСЯ ПО КНОПЦІ                ║
// ╚══════════════════════════════════════════════════════════╝

function tgPage_(body) {
  return HtmlService.createHtmlOutput(tgHtmlShell_(body))
    .setTitle("L-TEX | Посилання на Telegram")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function tgLandingBody_(r) {
  var msg   = tgMessageText_(r);
  var intl  = tgIntlPhone_(r.phone);
  var undo  = getTgTrackUrl_() + "?a=tg&id=" + encodeURIComponent(r.id) + "&t=" + tgToken_(r.id) + "&undo=1";
  var h = [];

  h.push('<div class="badge ' + (r.repeat ? 'badge-rep' : 'badge-ok') + '">' +
         (r.repeat ? '🔁 Уже надсилали ' + tgEsc_(r.sentAt) : '✅ Статус «Надіслано» проставлено автоматично') +
         '</div>');

  h.push('<div class="card"><div class="card-t">Клієнт</div>');
  h.push(tgRow_("ПІБ", r.name));
  h.push(tgRow_("Телефон", r.phone));
  h.push(tgRow_("Область", r.region + (r.city ? ", " + r.city : "")));
  h.push(tgRow_("Менеджер", r.manager));
  h.push(tgRow_("ID", r.id));
  if (r.interest) h.push(tgRow_("Цікавить", r.interest));
  h.push('</div>');

  if (r.noLink) {
    h.push('<div class="card warn"><div class="card-t">⚠️ Немає посилання для цієї області</div>' +
           '<p>Додайте унікальне посилання для області «' + tgEsc_(r.region || "—") +
           '» в аркуш «' + tgEsc_(TG_LINKS_SHEET) + '» головної таблиці.</p></div>');
  } else {
    h.push('<div class="card"><div class="card-t">Унікальне посилання для області «' +
           tgEsc_(r.region || "за замовчуванням") + '»</div>');
    h.push('<div class="link" id="lnk">' + tgEsc_(r.link) + '</div>');
    h.push('<button class="btn btn-p" onclick="cp(' + tgJs_(r.link) + ',this)">📋 Скопіювати посилання</button>');
    h.push('</div>');

    h.push('<div class="card"><div class="card-t">Готове повідомлення клієнту</div>');
    h.push('<textarea id="msg" rows="9">' + tgEsc_(msg) + '</textarea>');
    h.push('<button class="btn btn-p" onclick="cp(document.getElementById(\'msg\').value,this)">' +
           '📋 Скопіювати повідомлення</button>');
    h.push('</div>');

    h.push('<div class="card"><div class="card-t">Написати клієнту</div><div class="grid">');
    if (intl) {
      h.push('<a class="btn btn-v" target="_blank" rel="noopener" href="viber://chat?number=%2B' + intl + '">Viber</a>');
      h.push('<a class="btn btn-t" target="_blank" rel="noopener" href="tg://resolve?phone=' + intl + '">Telegram</a>');
      h.push('<a class="btn btn-w" target="_blank" rel="noopener" href="https://wa.me/' + intl +
             '?text=' + encodeURIComponent(msg) + '">WhatsApp</a>');
    }
    h.push('<a class="btn btn-g" target="_blank" rel="noopener" href="' + tgEsc_(r.link) + '">Відкрити канал</a>');
    h.push('</div></div>');
  }

  h.push('<p class="hint">Статус, дата і саме посилання вже записані в головну таблицю ' +
         'і в таблицю менеджера. Натиснули помилково? ' +
         '<a href="' + tgEsc_(undo) + '">Скасувати статус</a>.</p>');
  return h.join("");
}

function tgUndoBody_(u) {
  return '<div class="badge badge-rep">↩️ Статус скасовано</div>' +
         '<div class="card"><div class="card-t">Клієнт</div>' +
         tgRow_("ПІБ", u.name) + tgRow_("ID", u.id) + tgRow_("Менеджер", u.manager) + '</div>' +
         '<p class="hint">Позначку «' + tgEsc_(TG_STATUS_SENT) + '» знято в головній таблиці ' +
         'та в таблиці менеджера. Можете закрити цю вкладку.</p>';
}

function tgErrorBody_(msg, hint) {
  return '<div class="badge badge-err">⚠️ ' + tgEsc_(msg) + '</div>' +
         (hint ? '<div class="card"><p>' + tgEsc_(hint) + '</p></div>' : '') +
         '<p class="hint">Якщо помилка повторюється — напишіть адміністратору.</p>';
}

function tgRow_(label, value) {
  return '<div class="r"><span>' + tgEsc_(label) + '</span><b>' + tgEsc_(value || "—") + '</b></div>';
}

function tgMessageText_(r) {
  var tpl = PropertiesService.getScriptProperties().getProperty("TG_MSG_TEMPLATE") || TG_MSG_DEFAULT;
  var firstName = (r.name || "").toString().trim().split(/\s+/);
  // «Іванова Світлана» → «Світлана» (у ПІБ ім'я зазвичай другим)
  var nm = firstName.length > 1 ? firstName[1] : (firstName[0] || "");
  return tpl.replace(/\{name\}/g, nm)
            .replace(/\{manager\}/g, r.manager || "L-TEX")
            .replace(/\{link\}/g, r.link || "");
}

function tgHtmlShell_(body) {
  return '<!DOCTYPE html><html lang="uk"><head><meta charset="UTF-8"><style>' +
    '*{box-sizing:border-box;margin:0;padding:0}' +
    'body{background:#0f1923;color:#e8f0f8;font-family:"Outfit",system-ui,-apple-system,sans-serif;' +
      'padding:18px 14px 40px;line-height:1.5;' +
      'background-image:radial-gradient(ellipse 80% 50% at 50% -20%,rgba(59,130,246,.14) 0,transparent 60%)}' +
    '.wrap{max-width:560px;margin:0 auto;display:flex;flex-direction:column;gap:14px}' +
    '.hdr{display:flex;align-items:center;gap:12px;margin-bottom:2px}' +
    '.logo{width:38px;height:38px;border-radius:10px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);' +
      'display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;color:#fff}' +
    '.hdr h1{font-size:16px;font-weight:600}.hdr p{font-size:11px;color:#6b8aaa}' +
    '.badge{padding:12px 14px;border-radius:12px;font-weight:600;font-size:14px;text-align:center}' +
    '.badge-ok{background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.35)}' +
    '.badge-rep{background:rgba(245,158,11,.13);color:#f59e0b;border:1px solid rgba(245,158,11,.32)}' +
    '.badge-err{background:rgba(239,68,68,.13);color:#ef4444;border:1px solid rgba(239,68,68,.32)}' +
    '.card{background:#162030;border:1px solid #243346;border-radius:14px;padding:16px}' +
    '.card.warn{border-color:rgba(245,158,11,.4)}' +
    '.card-t{font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:#6b8aaa;' +
      'font-weight:600;margin-bottom:10px}' +
    '.r{display:flex;justify-content:space-between;gap:12px;padding:5px 0;font-size:14px;border-bottom:1px solid #1c2a3a}' +
    '.r:last-child{border-bottom:0}.r span{color:#6b8aaa;flex-shrink:0}.r b{text-align:right;font-weight:500}' +
    '.link{background:#0f1923;border:1px solid #2e4058;border-radius:10px;padding:12px;' +
      'font-size:14px;word-break:break-all;color:#60a5fa;margin-bottom:10px;font-weight:500}' +
    'textarea{width:100%;background:#0f1923;border:1px solid #2e4058;border-radius:10px;padding:12px;' +
      'color:#e8f0f8;font-family:inherit;font-size:14px;resize:vertical;margin-bottom:10px}' +
    '.btn{display:block;width:100%;padding:13px;border:0;border-radius:10px;font-family:inherit;' +
      'font-size:14px;font-weight:600;cursor:pointer;text-align:center;text-decoration:none;color:#fff}' +
    '.btn-p{background:linear-gradient(135deg,#1d4ed8,#3b82f6)}' +
    '.btn-g{background:#1c2a3a;border:1px solid #2e4058}' +
    '.btn-v{background:#7c3aed}.btn-t{background:#229ED9}.btn-w{background:#25D366}' +
    '.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    '.hint{font-size:12px;color:#6b8aaa;text-align:center;padding:0 8px}' +
    '.hint a{color:#60a5fa}' +
    '.ok{background:#10b981 !important}' +
    '</style></head><body><div class="wrap">' +
    '<div class="hdr"><div class="logo">L-TEX</div><div><h1>Посилання на Telegram-канал</h1>' +
    '<p>Статус проставляється автоматично</p></div></div>' +
    body +
    '</div><script>' +
    'function cp(t,b){var d=b.textContent;' +
    'function ok(){b.textContent="✅ Скопійовано";b.classList.add("ok");' +
    'setTimeout(function(){b.textContent=d;b.classList.remove("ok")},1800)}' +
    'try{if(navigator.clipboard&&navigator.clipboard.writeText){' +
    'navigator.clipboard.writeText(t).then(ok,function(){fb(t,ok)})}else{fb(t,ok)}}catch(e){fb(t,ok)}}' +
    // Запасний шлях: у Google-івському iframe Clipboard API часто заблокований
    'function fb(t,ok){var a=document.createElement("textarea");a.value=t;' +
    'a.style.position="fixed";a.style.top="0";a.style.opacity="0";document.body.appendChild(a);' +
    'a.focus();a.select();try{a.setSelectionRange(0,t.length)}catch(e){}' +
    'var done=false;try{done=document.execCommand("copy")}catch(e){done=false}' +
    'document.body.removeChild(a);' +
    'if(done){ok()}else{alert("Скопіюйте текст вручну:\\n\\n"+t)}}' +
    '</script></body></html>';
}


// ╔══════════════════════════════════════════════════════════╗
// ║  10. ДОПОМІЖНІ                                           ║
// ╚══════════════════════════════════════════════════════════╝

// URL веб-застосунку. Можна перевизначити Script Property TG_TRACK_URL.
function getTgTrackUrl_() {
  var u = PropertiesService.getScriptProperties().getProperty("TG_TRACK_URL");
  if (u && u.trim()) return u.trim();
  if (typeof WEBHOOK_URL === "string" && WEBHOOK_URL) return WEBHOOK_URL;
  return ScriptApp.getService().getUrl();
}

// Підпис рядка (щоб статус не можна було проставити «з вулиці»)
function tgToken_(id) {
  var props  = PropertiesService.getScriptProperties();
  var secret = props.getProperty("TG_SECRET");
  if (!secret) { secret = Utilities.getUuid(); props.setProperty("TG_SECRET", secret); }
  var sig = Utilities.computeHmacSha256Signature(String(id), secret);
  var hex = "";
  for (var i = 0; i < sig.length && hex.length < 10; i++) {
    hex += ("0" + (sig[i] & 0xFF).toString(16)).slice(-2);
  }
  return hex.substring(0, 10);
}

// «Вік» статусу для звірки таблиць: вищий виграє, однакові не чіпаємо.
// порожньо(0) < ✅ Надіслано(1) < 🚫/❌/інші ручні(2) < 👤 Приєднався(3)
function tgRank_(status) {
  var s = tgStr_(status);
  if (!s) return 0;
  if (s.indexOf("👤") === 0) return 3;
  if (s.indexOf("✅") === 0) return 1;
  return 2;
}

function tgIsSent_(status) {
  if (!status) return false;
  var s = status.toString().trim();
  return s.indexOf("✅") === 0 || s.indexOf("👤") === 0;
}

function tgStr_(v) {
  return v === null || v === undefined ? "" : v.toString().trim();
}

// 0671234567 → 380671234567
function tgIntlPhone_(phone) {
  var d = (phone || "").toString().replace(/\D/g, "");
  if (d.length === 12 && d.indexOf("380") === 0) return d;
  if (d.length === 11 && d.indexOf("38")  === 0) return "3" + d;
  if (d.length === 10 && d.charAt(0) === "0")    return "38" + d;
  if (d.length === 9)                            return "380" + d;
  return "";
}

function tgEsc_(s) {
  return (s === null || s === undefined ? "" : s.toString())
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function tgJs_(s) {
  return tgEsc_(JSON.stringify(s === null || s === undefined ? "" : s.toString()));
}

// Список статусів: колонка G аркуша «Довідники» або TG_STATUS_LIST
function getTgStatusList_() {
  try {
    var ref = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName("Довідники");
    if (ref && ref.getLastRow() >= 2 && ref.getMaxColumns() >= TG_DICT_COL) {
      var list = ref.getRange(2, TG_DICT_COL, ref.getLastRow() - 1, 1).getValues().flat().filter(String);
      if (list.length) return list;
    }
  } catch (err) { Logger.log("getTgStatusList_: " + err); }
  return TG_STATUS_LIST;
}

function tgStatusRule_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(getTgStatusList_(), true)
    .setAllowInvalid(true)
    .build();
}

function ensureTgStatusDictionary_() {
  var ref = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName("Довідники");
  if (!ref) { Logger.log("Аркуш «Довідники» не знайдено — пропускаю"); return; }
  if (ref.getMaxColumns() < TG_DICT_COL) ref.insertColumnsAfter(ref.getMaxColumns(), TG_DICT_COL - ref.getMaxColumns());
  if (!ref.getRange(1, TG_DICT_COL).getValue()) {
    ref.getRange(1, TG_DICT_COL).setValue(TG_HDR_STATUS).setFontWeight("bold");
  }
  var colVals  = ref.getRange(2, TG_DICT_COL, Math.max(ref.getMaxRows() - 1, 1), 1).getValues();
  var lastUsed = 1;
  for (var i = 0; i < colVals.length; i++) {
    if (colVals[i][0] !== "" && colVals[i][0] !== null) lastUsed = i + 2;
  }
  var existing = colVals.flat().filter(String).map(function (v) { return v.toString().trim().toLowerCase(); });
  var missing  = TG_STATUS_LIST.filter(function (v) { return existing.indexOf(v.toLowerCase()) === -1; });
  if (!missing.length) return;
  var firstFree = lastUsed + 1;
  if (ref.getMaxRows() < firstFree + missing.length - 1) {
    ref.insertRowsAfter(ref.getMaxRows(), firstFree + missing.length - 1 - ref.getMaxRows());
  }
  ref.getRange(firstFree, TG_DICT_COL, missing.length, 1)
     .setValues(missing.map(function (v) { return [v]; }));
  Logger.log("Довідники G: додано " + missing.join(", "));
}


// ╔══════════════════════════════════════════════════════════╗
// ║  11. ПЕРЕВІРКА (запустити після встановлення)            ║
// ╚══════════════════════════════════════════════════════════╝
function testTgSetup() {
  var out = [];
  out.push("URL веб-застосунку: " + getTgTrackUrl_());

  var main = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!main || main.getMaxColumns() < TG_MAIN_LINK) {
    out.push("Колонки головної: ❌ не встановлені — запустіть installTgColumns()");
  } else {
    var hdr = main.getRange(tgHeaderRow_(main), TG_MAIN_BTN, 1, 4).getValues()[0];
    out.push("Колонки головної: " + (hdr[0] === TG_HDR_BTN ? "✅ " + hdr.join(" | ") : "❌ не встановлені"));
  }

  var managers = getManagers();
  for (var name in managers) {
    if (!managers[name].fileId) continue;
    try {
      var sh = SpreadsheetApp.openById(managers[name].fileId).getSheets()[0];
      var h  = sh.getRange(tgHeaderRow_(sh), TG_MGR_BTN).getValue();
      out.push((h === TG_HDR_BTN ? "✅ " : "❌ ") + name);
    } catch (err) { out.push("❌ " + name + ": " + err); }
  }

  var map = tgLinksMap_(), withLink = 0, noLink = [];
  for (var k in map) { if (map[k].link) withLink++; else noLink.push(k); }
  out.push("Посилань заповнено: " + withLink + " з " + Object.keys(map).length);
  if (noLink.length) out.push("Без посилання: " + noLink.join(", "));

  var trig = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === "tgRefreshJob";
  }).length;
  out.push("Тригер оновлення кнопок: " + (trig ? "✅ встановлено" : "❌ немає — запустіть setupTgTrigger()"));

  Logger.log(out.join("\n"));
  return out.join("\n");
}
