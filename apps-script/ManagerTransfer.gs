// ============================================================
// L-TEX CRM | v6.9 — Перепризначення менеджера (перенос контрагента)
// ============================================================
// ЩО РОБИТЬ
//   Змінюєш менеджера в колонці K аркуша «🔒 2026» — і скрипт сам:
//     1) видаляє рядок цього контрагента з файлу(ів) попереднього менеджера;
//     2) додає рядок у файл нового менеджера (з усіма даними обдзвону,
//        які вже встиг заповнити попередній менеджер: Перший контакт,
//        Активність, Статус дії, Оновлений статус, Коментар);
//     3) шле новому менеджеру у Viber: «Вам передано контрагента —
//        потрібно актуалізувати інформацію та продовжити роботу»;
//     4) шле попередньому менеджеру повідомлення, що клієнта передано
//        і рядок прибрано з його таблиці;
//     5) пише запис в аркуш-журнал «_transfers» головного файлу.
//
// ЦЕЙ ФАЙЛ НІЧОГО НЕ ЗАМІНЮЄ В ІСНУЮЧОМУ КОДІ.
//   Він працює через ОКРЕМИЙ тригер onMainEditTransfer, тому функцію
//   onEdit(e) у Code.gs чіпати НЕ треба.
//
// ▶ ВСТАНОВЛЕННЯ (один раз, з редактора Apps Script):
//     installManagerTransferTrigger()
//   Прибрати:
//     removeManagerTransferTrigger()
//
// ▶ РУЧНІ ІНСТРУМЕНТИ:
//     reassignLead("LTEX-20260101-1234", "Дунас Богдан")
//     reassignLeadByPhone("0671234567", "Дунас Богдан")
//     cleanupManagerFilesFromMain(true)   // спершу перевірка (нічого не видаляє)
//     cleanupManagerFilesFromMain(false)  // реальне прибирання «чужих» рядків
// ============================================================

var TRANSFER_LOG_SHEET   = "_transfers"; // журнал перенесень у головному файлі
var TRANSFER_MAX_ROWS    = 50;           // максимум рядків за одне редагування
var TRANSFER_PUSH_TO_CRM = true;         // дублювати зміну менеджера в L-TEX CRM

// Колонки, які веде САМ менеджер у своєму файлі.
// При переносі вони не губляться: їдуть у головну (якщо там порожньо)
// і у файл нового менеджера.
// Функція, а не константа — щоб не залежати від порядку завантаження файлів.
function transferCarryMap_() {
  return [
    { mgrCol: 9,                   mainCol: COL.CONTACT     }, // Перший контакт
    { mgrCol: 10,                  mainCol: COL.ACTIVITY    }, // Активність
    { mgrCol: 11,                  mainCol: COL.STATUS      }, // Статус дії
    { mgrCol: MGR_COL_NEW_STATUS,  mainCol: COL.NEW_STATUS  }, // Оновлений статус
    { mgrCol: MGR_COL_NEW_COMMENT, mainCol: COL.NEW_COMMENT }  // Коментар
  ];
}


// ── Тригери ───────────────────────────────────────────────

function installManagerTransferTrigger() {
  var exists = false;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onMainEditTransfer" &&
        t.getTriggerSourceId() === MAIN_FILE_ID) exists = true;
  });
  if (exists) { Logger.log("ℹ️ Тригер перепризначення вже встановлено"); return; }
  ScriptApp.newTrigger("onMainEditTransfer")
    .forSpreadsheet(SpreadsheetApp.openById(MAIN_FILE_ID))
    .onEdit()
    .create();
  Logger.log("✅ Тригер onMainEditTransfer встановлено на головний файл");
}

function removeManagerTransferTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onMainEditTransfer") { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log("Видалено тригерів перепризначення: " + removed);
}


// ── Обробник редагування колонки «Менеджер» ───────────────

function onMainEditTransfer(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== MAIN_SHEET) return;

    // Редагування зачепило колонку «Менеджер»?
    if (e.range.getColumn() > COL.MANAGER || e.range.getLastColumn() < COL.MANAGER) return;

    var startRow = Math.max(e.range.getRow(), DATA_START);
    var endRow   = Math.min(e.range.getLastRow(), sheet.getLastRow());
    if (endRow < startRow) return;
    if (endRow - startRow + 1 > TRANSFER_MAX_ROWS) {
      Logger.log("transfer: забагато рядків (" + (endRow-startRow+1) + "), обробляю перші " + TRANSFER_MAX_ROWS);
      endRow = startRow + TRANSFER_MAX_ROWS - 1;
    }

    var single = (e.range.getNumRows() === 1 && e.range.getNumColumns() === 1);
    for (var r = startRow; r <= endRow; r++) {
      // Для одиночного редагування можемо відсіяти «зміну без зміни»
      if (single && e.oldValue !== undefined && e.oldValue !== null) {
        var nowVal = sheet.getRange(r, COL.MANAGER).getValue();
        if (e.oldValue.toString().trim() === (nowVal ? nowVal.toString().trim() : "")) continue;
      }
      transferLeadRow_(sheet, r);
    }
  } catch (err) { Logger.log("onMainEditTransfer: " + err); }
}


// ── Ядро переносу ─────────────────────────────────────────
// Приводить файли менеджерів у відповідність до колонки «Менеджер»
// головної таблиці для одного рядка.
// opts.skipViberId — кому НЕ слати сповіщення (той, хто сам ініціював
// перенос командою в боті: він і так отримає відповідь).
// Повертає {moved: true/false, id, from: [...], to: "..."}.
function transferLeadRow_(sheet, row, opts) {
  opts = opts || {};
  var rowData = sheet.getRange(row, 1, 1, MAIN_LAST_COL).getValues()[0];

  var rowId = rowData[COL.ID-1] ? rowData[COL.ID-1].toString().trim() : "";
  if (!rowId) {
    rowId = generateId();
    sheet.getRange(row, COL.ID).setValue(rowId);
    rowData[COL.ID-1] = rowId;
  }
  var name = rowData[COL.NAME-1] ? rowData[COL.NAME-1].toString().trim() : "";
  if (!name && !rowData[COL.PHONE-1]) return {moved:false, id:rowId, from:[], to:""}; // порожній рядок

  var toName   = rowData[COL.MANAGER-1] ? rowData[COL.MANAGER-1].toString().trim() : "";
  var allFiles = getAllManagerFiles_();   // включно з неактивними менеджерами
  var managers = getManagers();           // активні (для сповіщень і синхронізації)

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    Logger.log("transferLeadRow_: система зайнята, " + rowId);
    return {moved:false, id:rowId, from:[], to:toName, busy:true};
  }

  var removedFrom = [];
  var carry = {};
  try {
    // 1) Прибираємо рядок з файлів УСІХ менеджерів, крім нового
    for (var mName in allFiles) {
      if (mName === toName) continue;
      var fid = allFiles[mName].fileId;
      if (!fid) continue;
      var res = removeLeadFromManagerFile_(fid, rowId);
      if (res.removed > 0) {
        removedFrom.push(mName);
        mergeCarry_(carry, res.carry);
        Logger.log("transfer: " + rowId + " прибрано з файлу «" + mName + "» (" + res.removed + " рядк.)");
      }
    }

    // 2) Те, що менеджер уже заповнив, зберігаємо в головній (якщо там порожньо)
    var carryList = transferCarryMap_();
    for (var i = 0; i < carryList.length; i++) {
      var c   = carryList[i];
      var val = carry[c.mgrCol];
      if (val === undefined || val === "") continue;
      var cur = rowData[c.mainCol-1];
      if (cur === "" || cur === null || cur === undefined) {
        sheet.getRange(row, c.mainCol).setValue(val);
        rowData[c.mainCol-1] = val;
      }
    }

    // 3) Заводимо/оновлюємо рядок у файлі нового менеджера
    if (toName && managers[toName] && managers[toName].fileId) {
      var toFile = managers[toName].fileId;
      syncToManager(rowData, rowId, toFile, toName);
      applyCarryToManagerFile_(toFile, rowId, carry);
      dedupeManagerRowsById_(toFile, rowId);
    } else if (toName) {
      Logger.log("transfer: менеджер «" + toName + "» не зареєстрований або без файлу");
    }
  } finally {
    lock.releaseLock();
  }

  // Якщо нікого не «розкуркулили» — це перше призначення, а не перенос.
  // Сповіщення про нового клієнта вже шле onEdit у Code.gs.
  // opts.forceNotify — для команди бота і ручних функцій: там onEdit не
  // спрацьовує (зміни зі скрипта тригер не ловить), тож пишемо самі.
  if (!removedFrom.length && !opts.forceNotify) return {moved:false, id:rowId, from:[], to:toName};

  var fromLabel = removedFrom.length ? removedFrom.join(", ") : "—";
  var card      = leadCard_(rowData);

  // 4) Новому менеджеру
  if (toName && managers[toName] && managers[toName].viberId &&
      managers[toName].viberId !== opts.skipViberId) {
    sendViber(managers[toName].viberId,
      "📥 Вам передано контрагента!\n\n" + card +
      "\nПопередній менеджер: " + fromLabel +
      "\n\n⚠️ Потрібно актуалізувати інформацію та продовжити роботу." +
      "\nКлієнт уже у вашій таблиці.");
  }

  // 5) Попереднім менеджерам
  for (var k = 0; k < removedFrom.length; k++) {
    var prev = removedFrom[k];
    var vid  = allFiles[prev] ? allFiles[prev].viberId : "";
    if (!vid || vid === opts.skipViberId) continue;
    sendViber(vid,
      "📤 Контрагента передано іншому менеджеру\n\n" + card +
      "\nНовий менеджер: " + (toName || "—") +
      "\n\nРядок прибрано з вашої таблиці — працювати по ньому більше не потрібно.");
  }

  // 6) Керівникам + журнал
  notifyOwners("🔄 Перепризначення контрагента\n\nID: " + rowId +
               "\nПІБ: " + (name || "—") +
               "\nТелефон: " + (rowData[COL.PHONE-1] || "—") +
               "\nБуло: " + fromLabel +
               "\nСтало: " + (toName || "—"));
  logTransfer_(rowId, fromLabel, toName, name, rowData[COL.PHONE-1]);

  // 7) Місток у нашу систему — щоб там теж змінився менеджер
  if (TRANSFER_PUSH_TO_CRM) {
    try { pushLeadToLtexCrm(rowData, rowId, "Перепризначення менеджера"); }
    catch (err) { Logger.log("transfer → LTEX CRM: " + err); }
  }

  return {moved:removedFrom.length > 0, id:rowId, from:removedFrom, to:toName, name:name};
}


// ── Робота з файлами менеджерів ───────────────────────────

// Видаляє з файлу менеджера всі рядки із заданим ID.
// Повертає {removed: N, carry: {колонка: значення}} — carry це дані обдзвону,
// які менеджер уже встиг заповнити (щоб не загубити їх при переносі).
function removeLeadFromManagerFile_(fileId, rowId) {
  var out = { removed: 0, carry: {} };
  try {
    var sheet   = SpreadsheetApp.openById(fileId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < MGR_DATA_START) return out;

    var lastCol = Math.max(sheet.getLastColumn(), MGR_LAST_COL);
    var data    = sheet.getRange(MGR_DATA_START, 1, lastRow - MGR_DATA_START + 1, lastCol).getValues();
    var hits    = [];
    for (var i = 0; i < data.length; i++) {
      var id = data[i][0] ? data[i][0].toString().trim() : "";
      if (id === rowId) hits.push(i);
    }
    if (!hits.length) return out;

    var carryList = transferCarryMap_();
    for (var h = 0; h < hits.length; h++) {
      var rowVals = data[hits[h]];
      for (var c = 0; c < carryList.length; c++) {
        var col = carryList[c].mgrCol;
        var v   = rowVals[col-1];
        if (v === null || v === undefined) continue;
        v = v.toString().trim();
        if (v && !out.carry[col]) out.carry[col] = v;
      }
    }
    // Видаляємо знизу вгору, щоб не «поїхали» номери рядків
    for (var d = hits.length - 1; d >= 0; d--) {
      sheet.deleteRow(MGR_DATA_START + hits[d]);
      out.removed++;
    }
    SpreadsheetApp.flush();
  } catch (err) { Logger.log("removeLeadFromManagerFile_ (" + fileId + "): " + err); }
  return out;
}

// Дописує дані обдзвону у файл нового менеджера (лише в порожні клітинки).
function applyCarryToManagerFile_(fileId, rowId, carry) {
  var keys = Object.keys(carry || {});
  if (!keys.length) return;
  try {
    var sheet   = SpreadsheetApp.openById(fileId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < MGR_DATA_START) return;
    var ids = sheet.getRange(MGR_DATA_START, 1, lastRow - MGR_DATA_START + 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (!ids[i][0] || ids[i][0].toString().trim() !== rowId) continue;
      var target = MGR_DATA_START + i;
      for (var k = 0; k < keys.length; k++) {
        var col  = parseInt(keys[k], 10);
        var cell = sheet.getRange(target, col);
        var cur  = cell.getValue();
        if (cur === "" || cur === null) cell.setValue(carry[keys[k]]);
      }
      return;
    }
  } catch (err) { Logger.log("applyCarryToManagerFile_: " + err); }
}

// Прибирає дублі рядків з однаковим ID у файлі менеджера
// (страхує від гонки двох тригерів). Лишається найзаповненіший рядок.
function dedupeManagerRowsById_(fileId, rowId) {
  try {
    var sheet   = SpreadsheetApp.openById(fileId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < MGR_DATA_START) return;
    var lastCol = Math.max(sheet.getLastColumn(), MGR_LAST_COL);
    var data    = sheet.getRange(MGR_DATA_START, 1, lastRow - MGR_DATA_START + 1, lastCol).getValues();

    var hits = [];
    for (var i = 0; i < data.length; i++) {
      var id = data[i][0] ? data[i][0].toString().trim() : "";
      if (id === rowId) hits.push(i);
    }
    if (hits.length < 2) return;

    var bestIdx = hits[0], bestScore = -1;
    hits.forEach(function(i) {
      var score = data[i].filter(function(v) { return v !== "" && v !== null; }).length;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    });
    for (var d = hits.length - 1; d >= 0; d--) {
      if (hits[d] === bestIdx) continue;
      sheet.deleteRow(MGR_DATA_START + hits[d]);
    }
    Logger.log("dedupe: " + rowId + " — прибрано дублів: " + (hits.length - 1));
  } catch (err) { Logger.log("dedupeManagerRowsById_: " + err); }
}

// Усі менеджери з аркуша «⚙️ Менеджери», включно з неактивними
// (щоб забрати рядок навіть у того, кого вже вимкнули).
function getAllManagerFiles_() {
  var out = {};
  try {
    var sheet = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MGR_SHEET);
    if (!sheet) return out;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return out;
    var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    data.forEach(function(row) {
      var name = row[MGR_COL.NAME-1] ? row[MGR_COL.NAME-1].toString().trim() : "";
      if (!name) return;
      out[name] = {
        fileId:  row[MGR_COL.FILE_ID-1]  ? row[MGR_COL.FILE_ID-1].toString().trim()  : "",
        viberId: row[MGR_COL.VIBER_ID-1] ? row[MGR_COL.VIBER_ID-1].toString().trim() : ""
      };
    });
  } catch (err) { Logger.log("getAllManagerFiles_: " + err); }
  return out;
}


// ── Допоміжне ─────────────────────────────────────────────

function mergeCarry_(target, source) {
  for (var k in source) {
    if (source[k] !== "" && target[k] === undefined) target[k] = source[k];
  }
}

function leadCard_(rowData) {
  var txt =
    "ID: "       + (rowData[COL.ID-1]       || "—") + "\n" +
    "ПІБ: "      + (rowData[COL.NAME-1]     || "—") + "\n" +
    "Телефон: "  + (rowData[COL.PHONE-1]    || "—") + "\n" +
    "Область: "  + (rowData[COL.REGION-1]   || "—") + "\n" +
    "Місто: "    + (rowData[COL.CITY-1]     || "—") + "\n" +
    "Цікавить: " + (rowData[COL.INTEREST-1] || "—") + "\n" +
    "Статус: "   + (rowData[COL.STATUS-1]   || "—") + "\n" +
    "Оновлений статус: " + (rowData[COL.NEW_STATUS-1] || "—");
  var comment = rowData[COL.NEW_COMMENT-1] ? rowData[COL.NEW_COMMENT-1].toString().trim() : "";
  if (comment) txt += "\nКоментар: " + (comment.length > 300 ? comment.substring(0, 300) + "…" : comment);
  return txt;
}

function logTransfer_(rowId, fromName, toName, clientName, phone) {
  try {
    var ss  = SpreadsheetApp.openById(MAIN_FILE_ID);
    var log = ss.getSheetByName(TRANSFER_LOG_SHEET);
    if (!log) {
      log = ss.insertSheet(TRANSFER_LOG_SHEET);
      log.getRange(1, 1, 1, 6)
         .setValues([["Дата", "ID ліда", "Було", "Стало", "ПІБ", "Телефон"]])
         .setFontWeight("bold");
      log.setFrozenRows(1);
      log.hideSheet();
    }
    log.appendRow([new Date(), rowId, fromName || "—", toName || "—", clientName || "", phone || ""]);
  } catch (err) { Logger.log("logTransfer_: " + err); }
}


// ── Ручне перепризначення (з редактора Apps Script) ───────

function reassignLead(rowId, newManagerName) {
  var sheet = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!sheet) { Logger.log("Аркуш «" + MAIN_SHEET + "» не знайдено"); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) { Logger.log("Немає даних"); return; }

  var managers = getManagers();
  if (newManagerName && !managers[newManagerName]) {
    Logger.log("❌ Менеджер «" + newManagerName + "» не знайдений. Доступні: " + Object.keys(managers).join(", "));
    return;
  }
  var ids = sheet.getRange(DATA_START, COL.ID, lastRow - DATA_START + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (!ids[i][0] || ids[i][0].toString().trim() !== rowId) continue;
    var row = DATA_START + i;
    sheet.getRange(row, COL.MANAGER).setValue(newManagerName);
    SpreadsheetApp.flush();
    transferLeadRow_(sheet, row, {forceNotify: true});
    Logger.log("✅ " + rowId + " → " + newManagerName);
    return;
  }
  Logger.log("❌ Лід " + rowId + " не знайдено в головній таблиці");
}

function reassignLeadByPhone(phone, newManagerName) {
  var sheet = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) return;
  var phone9 = phone.toString().replace(/\D/g, "").slice(-9);
  var data = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, MAIN_LAST_COL).getValues();
  for (var i = 0; i < data.length; i++) {
    var ph = data[i][COL.PHONE-1] ? data[i][COL.PHONE-1].toString().replace(/\D/g, "").slice(-9) : "";
    if (ph.length >= 8 && ph === phone9) {
      var id = data[i][COL.ID-1] ? data[i][COL.ID-1].toString().trim() : "";
      if (!id) {
        id = generateId();
        sheet.getRange(DATA_START + i, COL.ID).setValue(id);
      }
      reassignLead(id, newManagerName);
      return;
    }
  }
  Logger.log("❌ Клієнта з номером " + phone + " не знайдено");
}


// ── Разове прибирання «чужих» рядків у файлах менеджерів ──
// dryRun = true  → тільки показує, що буде видалено (нічого не чіпає)
// dryRun = false → реально видаляє рядки, які за головною належать іншому
// Рядки, ID яких немає в головній таблиці, НЕ видаляються — лише в звіті.
function cleanupManagerFilesFromMain(dryRun) {
  if (dryRun === undefined) dryRun = true;
  var sheet = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!sheet) { Logger.log("Аркуш «" + MAIN_SHEET + "» не знайдено"); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) { Logger.log("Немає даних"); return; }

  var data  = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, MAIN_LAST_COL).getValues();
  var owner = {};
  data.forEach(function(r) {
    var id = r[COL.ID-1] ? r[COL.ID-1].toString().trim() : "";
    if (id) owner[id] = r[COL.MANAGER-1] ? r[COL.MANAGER-1].toString().trim() : "";
  });

  var files = getAllManagerFiles_();
  var report = [];
  for (var name in files) {
    var fid = files[name].fileId;
    if (!fid) continue;
    try {
      var ms = SpreadsheetApp.openById(fid).getSheets()[0];
      var ml = ms.getLastRow();
      if (ml < MGR_DATA_START) continue;
      var ids = ms.getRange(MGR_DATA_START, 1, ml - MGR_DATA_START + 1, 1).getValues();
      var toDelete = [], unknown = 0;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i][0] ? ids[i][0].toString().trim() : "";
        if (!id) continue;
        if (owner[id] === undefined) { unknown++; continue; }
        if (owner[id] !== name) toDelete.push(i);
      }
      if (!dryRun) {
        for (var d = toDelete.length - 1; d >= 0; d--) ms.deleteRow(MGR_DATA_START + toDelete[d]);
      }
      report.push((dryRun ? "🔎 " : "🧹 ") + name + ": чужих рядків " + toDelete.length +
                  (unknown ? ", немає в головній: " + unknown : ""));
    } catch (err) { report.push("❌ " + name + ": " + err); }
  }
  Logger.log(report.join("\n"));
  Logger.log(dryRun
    ? "=== Це була ПЕРЕВІРКА. Щоб видалити — cleanupManagerFilesFromMain(false) ==="
    : "=== Готово: файли менеджерів приведено у відповідність до головної ===");
}


// ╔══════════════════════════════════════════════════════════╗
// ║   Команда бота: /передати — перенос прямо з Viber        ║
// ╚══════════════════════════════════════════════════════════╝
//
// ▶ Щоб команда запрацювала, додай у doPost (файл Code.gs) один рядок —
//   одразу після блоку команди «/1с»:
//
//     if (tl.startsWith("/передати")||tl.startsWith("/передать")||tl.startsWith("/transfer")) {
//       handleTransferCommand(text, sender); return okResponse();
//     }
//
// ▶ Формати:
//     /передати 0671234567 Дунас Богдан
//     /передати LTEX-20260101-1234 Дунас
//     /передати
//     Телефон: 0671234567
//     Менеджер: Дунас Богдан
//
// ▶ Права:
//     адміністратор і керівники (ADMIN_VIBER_ID, NOTIFY_IDS) — будь-якого клієнта;
//     менеджер — тільки своїх клієнтів.

function handleTransferCommand(text, sender) {
  try {
    var raw = text.replace(/^\/(передати|передать|transfer)\s*/i, "").trim();
    var key = "", mgrInput = "";

    if (/(телефон|тел|id|менеджер)\s*:/i.test(raw)) {
      var lines = raw.split("\n").map(function(l){ return l.trim(); }).filter(String);
      function field(keys) {
        for (var i = 0; i < keys.length; i++) {
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].toLowerCase().indexOf(keys[i] + ":") === 0) {
              return lines[j].substring(lines[j].indexOf(":") + 1).trim();
            }
          }
        }
        return "";
      }
      key      = field(["телефон", "тел", "id", "ід"]);
      mgrInput = field(["менеджер"]);
    } else {
      var parts = raw.split(/\s+/).filter(String);
      if (parts.length >= 2) { key = parts.shift(); mgrInput = parts.join(" "); }
    }

    if (!key || !mgrInput) { sendViber(sender.id, transferHelpText_()); return; }

    var managers = getManagers();

    // ── Хто просить ──
    var senderName = "";
    for (var mn in managers) {
      if (managers[mn].viberId && managers[mn].viberId === sender.id) { senderName = mn; break; }
    }
    var isAdmin = (sender.id === ADMIN_VIBER_ID) ||
                  (typeof NOTIFY_IDS !== "undefined" && NOTIFY_IDS.indexOf(sender.id) !== -1);
    if (!isAdmin && !senderName) {
      sendViber(sender.id, "⛔ Команда доступна лише зареєстрованим менеджерам.\nНапишіть /старт для реєстрації.");
      return;
    }

    // ── Кому передаємо ──
    var resolved = resolveManagerName_(mgrInput, managers);
    if (resolved.error) { sendViber(sender.id, resolved.error); return; }
    var toName = resolved.name;

    // ── Якого клієнта ──
    var sheet = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    if (!sheet) { sendViber(sender.id, "❌ Головну таблицю не знайдено."); return; }
    var found = findMainRowByKey_(sheet, key);
    if (!found) {
      sendViber(sender.id, "❌ Контрагента «" + key + "» не знайдено в таблиці 2026.\n\n" +
                           "Перевір номер або ID (його видно в картці клієнта).");
      return;
    }

    var rowData = found.data;
    var current = rowData[COL.MANAGER-1] ? rowData[COL.MANAGER-1].toString().trim() : "";

    if (!isAdmin && current && current !== senderName) {
      sendViber(sender.id, "⛔ Цей контрагент закріплений за менеджером «" + current + "».\n" +
                           "Передати його може сам менеджер або адміністратор.");
      return;
    }
    if (current === toName) {
      sendViber(sender.id, "ℹ️ Контрагент уже закріплений за менеджером «" + toName + "» — нічого змінювати.");
      return;
    }

    // ── Переносимо ──
    sheet.getRange(found.row, COL.MANAGER).setValue(toName);
    SpreadsheetApp.flush();
    var res = transferLeadRow_(sheet, found.row, { skipViberId: sender.id, forceNotify: true });

    sendViber(sender.id,
      "✅ Контрагента передано!\n\n" +
      "ПІБ: "      + (rowData[COL.NAME-1]  || "—") + "\n" +
      "Телефон: "  + (rowData[COL.PHONE-1] || "—") + "\n" +
      "ID: "       + (res && res.id ? res.id : "—") + "\n" +
      "Було: "     + (current || "—") + "\n" +
      "Стало: "    + toName + "\n\n" +
      (managers[toName].viberId
        ? "Менеджер «" + toName + "» отримав сповіщення, рядок уже в його таблиці."
        : "⚠️ У менеджера «" + toName + "» не заповнений Viber ID — сповіщення не надіслано.") +
      (res && res.moved ? "" : "\nℹ️ У попереднього менеджера цього рядка не було — просто призначили нового."));

    Logger.log("handleTransferCommand: " + key + " → " + toName + " (ініціатор " + (senderName || "адмін") + ")");
  } catch (err) {
    Logger.log("handleTransferCommand: " + err);
    sendViber(sender.id, "Помилка: " + err.toString());
  }
}

function transferHelpText_() {
  var managers = getManagers();
  var list = Object.keys(managers).map(function(n) { return "  - " + n; }).join("\n");
  return "Передати контрагента іншому менеджеру:\n\n" +
         "/передати 0671234567 Дунас Богдан\n" +
         "/передати LTEX-20260101-1234 Дунас\n\n" +
         "або кількома рядками:\n" +
         "/передати\nТелефон: 0671234567\nМенеджер: Дунас Богдан\n\n" +
         "Клієнт автоматично зникне з таблиці попереднього менеджера\n" +
         "і зʼявиться в таблиці нового.\n\n" +
         "Менеджери:\n" + list;
}

// Пошук менеджера за неповним імʼям («Дунас», «богдан»)
function resolveManagerName_(input, managers) {
  var q     = input.toString().trim().toLowerCase();
  var names = Object.keys(managers);

  for (var i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === q) return { name: names[i] };
  }
  var hits = names.filter(function(n) { return n.toLowerCase().indexOf(q) !== -1; });
  if (hits.length === 1) return { name: hits[0] };
  if (hits.length > 1) {
    return { error: "Уточни менеджера — під «" + input + "» підходить кілька:\n" +
                    hits.map(function(n) { return "  - " + n; }).join("\n") };
  }
  return { error: "❌ Менеджера «" + input + "» не знайдено.\n\nДоступні:\n" +
                  names.map(function(n) { return "  - " + n; }).join("\n") };
}

// Пошук рядка в головній таблиці за ID або номером телефону
function findMainRowByKey_(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) return null;
  var data   = sheet.getRange(DATA_START, 1, lastRow - DATA_START + 1, MAIN_LAST_COL).getValues();
  var raw    = key.toString().trim();
  var byId   = /^ltex-/i.test(raw);
  var phone9 = raw.replace(/\D/g, "").slice(-9);

  for (var i = 0; i < data.length; i++) {
    if (byId) {
      var id = data[i][COL.ID-1] ? data[i][COL.ID-1].toString().trim() : "";
      if (id.toLowerCase() === raw.toLowerCase()) return { row: DATA_START + i, data: data[i] };
    } else if (phone9.length >= 8) {
      var ph = data[i][COL.PHONE-1] ? data[i][COL.PHONE-1].toString().replace(/\D/g, "").slice(-9) : "";
      if (ph.length >= 8 && ph === phone9) return { row: DATA_START + i, data: data[i] };
    }
  }
  return null;
}
