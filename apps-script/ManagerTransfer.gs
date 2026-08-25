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
//     reassignLead("LTEX-…", "Дунас Богдан", "Повторний запит: питає ціну")
//     reassignLeadByPhone("0671234567", "Дунас Богдан")
//     cleanupManagerFilesFromMain(true)   // спершу перевірка (нічого не видаляє)
//     cleanupManagerFilesFromMain(false)  // реальне прибирання «чужих» рядків
// ============================================================

// ── СУМІСНІСТЬ МІЖ ФАЙЛАМИ СКРИПТА ────────────────────────
// У рантаймі V8 глобальні const/let з одного файлу (.gs) не завжди
// видно в іншому — саме тому траплялась помилка
// «ReferenceError: MAIN_FILE_ID is not defined».
// TR() бере значення з Code.gs, якщо вони доступні, інакше —
// запасні копії нижче. Функції (getManagers, syncToManager, sendViber…)
// видно між файлами завжди, тож їх дублювати не треба.
//
// ⚠️ Якщо у Code.gs колись зміниться ID головного файлу або назва
// аркуша — онови і запасні значення тут.
var TR_MAIN_FILE_ID   = "1C-d_w2qr3CWn7RZZlWr6W8GE7VIiGBwSAx1ZmDAOfCA";
var TR_MAIN_SHEET     = "🔒 2026";
var TR_MGR_SHEET      = "⚙️ Менеджери";
var TR_ADMIN_VIBER_ID = "yz7qkyTVUGuGHAGoSvdEmQ==";
var TR_NOTIFY_IDS     = ["6UpDIrwBWnH6escgZLEzvQ==", "UTkC8aAOlMi67hNtFyd25g=="];
var TR_COL = {ID:1,DATE:2,NAME:3,CAT:4,REGION:5,CITY:6,PHONE:7,INTEREST:8,CONTACT:9,
              ACTIVITY:10,MANAGER:11,STATUS:12,CHANNEL:13,SITE:14,TG:15,DUPS:16,YEAR:17,
              NEW_STATUS:18,NEW_COMMENT:19};
var TR_MGR_COL = {NAME:1,ROLE:2,VIBER_ID:3,FILE_ID:4,ADDED:5,ACTIVE:6};

function TR() {
  return {
    MAIN_FILE_ID:        (typeof MAIN_FILE_ID        !== "undefined") ? MAIN_FILE_ID        : TR_MAIN_FILE_ID,
    MAIN_SHEET:          (typeof MAIN_SHEET          !== "undefined") ? MAIN_SHEET          : TR_MAIN_SHEET,
    MGR_SHEET:           (typeof MGR_SHEET           !== "undefined") ? MGR_SHEET           : TR_MGR_SHEET,
    DATA_START:          (typeof DATA_START          !== "undefined") ? DATA_START          : 5,
    MAIN_LAST_COL:       (typeof MAIN_LAST_COL       !== "undefined") ? MAIN_LAST_COL       : 19,
    MGR_LAST_COL:        (typeof MGR_LAST_COL        !== "undefined") ? MGR_LAST_COL        : 18,
    MGR_DATA_START:      (typeof MGR_DATA_START      !== "undefined") ? MGR_DATA_START      : 5,
    MGR_COL_NEW_STATUS:  (typeof MGR_COL_NEW_STATUS  !== "undefined") ? MGR_COL_NEW_STATUS  : 17,
    MGR_COL_NEW_COMMENT: (typeof MGR_COL_NEW_COMMENT !== "undefined") ? MGR_COL_NEW_COMMENT : 18,
    COL:                 (typeof COL                 !== "undefined") ? COL                 : TR_COL,
    MGR_COL:             (typeof MGR_COL             !== "undefined") ? MGR_COL             : TR_MGR_COL,
    ADMIN:               (typeof ADMIN_VIBER_ID      !== "undefined") ? ADMIN_VIBER_ID      : TR_ADMIN_VIBER_ID,
    OWNERS:              (typeof NOTIFY_IDS          !== "undefined") ? NOTIFY_IDS          : TR_NOTIFY_IDS
  };
}

// Діагностика: показує, що саме бачить модуль. Запусти, якщо щось не працює.
function checkTransferSetup() {
  var T = TR();
  var rep = ["=== Перевірка модуля перепризначення ==="];
  [["MAIN_FILE_ID", "MAIN_FILE_ID"], ["MAIN_SHEET","MAIN_SHEET"], ["MGR_SHEET","MGR_SHEET"],
   ["COL","COL"], ["MGR_COL","MGR_COL"], ["DATA_START","DATA_START"],
   ["MAIN_LAST_COL","MAIN_LAST_COL"], ["MGR_LAST_COL","MGR_LAST_COL"]].forEach(function(pair){
    var visible;
    switch (pair[1]) {
      case "MAIN_FILE_ID":  visible = (typeof MAIN_FILE_ID  !== "undefined"); break;
      case "MAIN_SHEET":    visible = (typeof MAIN_SHEET    !== "undefined"); break;
      case "MGR_SHEET":     visible = (typeof MGR_SHEET     !== "undefined"); break;
      case "COL":           visible = (typeof COL           !== "undefined"); break;
      case "MGR_COL":       visible = (typeof MGR_COL       !== "undefined"); break;
      case "DATA_START":    visible = (typeof DATA_START    !== "undefined"); break;
      case "MAIN_LAST_COL": visible = (typeof MAIN_LAST_COL !== "undefined"); break;
      case "MGR_LAST_COL":  visible = (typeof MGR_LAST_COL  !== "undefined"); break;
    }
    rep.push((visible ? "✅ " : "↩️ ") + pair[0] + (visible ? " — з Code.gs" : " — запасне значення модуля"));
  });

  // Функції перевіряємо ЗА ІМЕНЕМ: у V8 функції з іншого файлу не завжди
  // доступні через globalThis, але за ідентифікатором — доступні.
  var fnChecks = [
    ["getManagers",       function(){ return typeof getManagers;       }],
    ["syncToManager",     function(){ return typeof syncToManager;     }],
    ["sendViber",         function(){ return typeof sendViber;         }],
    ["notifyOwners",      function(){ return typeof notifyOwners;      }],
    ["generateId",        function(){ return typeof generateId;        }],
    ["pushLeadToLtexCrm", function(){ return typeof pushLeadToLtexCrm; }]
  ];
  var missing = 0;
  fnChecks.forEach(function(pair) {
    var t;
    try { t = pair[1](); } catch (err) { t = "недоступна (" + err + ")"; }
    var ok = (t === "function");
    if (!ok) missing++;
    rep.push((ok ? "✅ " : "❌ ") + pair[0] + "()" + (ok ? "" : " — " + t));
  });
  if (missing) {
    rep.push("⚠️ Модуль не бачить " + missing + " функцій CRM — найімовірніше, він вставлений");
    rep.push("   НЕ В ТОЙ ПРОЄКТ Apps Script (напр. у скрипт, прив’язаний до таблиці,");
    rep.push("   а не в основний проєкт бота).");
    rep.push("   Модуль має лежати в тому самому проєкті, де є doPost, parseAndSave,");
    rep.push("   getManagers, sendViber — тобто в проєкті, який опублікований як веб-застосунок");
    rep.push("   (його адреса = WEBHOOK_URL). Перенеси файл туди — і все запрацює.");
  }

  // Практична перевірка: реально викликаємо getManagers()
  try {
    var mgrs = getManagers();
    var names = Object.keys(mgrs);
    rep.push("✅ getManagers() повернув " + names.length + " менеджерів: " + names.join(", "));
    names.forEach(function(n) {
      rep.push("     " + n + " — файл: " + (mgrs[n].fileId ? "є" : "НЕМАЄ") +
               ", Viber ID: " + (mgrs[n].viberId ? "є" : "НЕМАЄ"));
    });
  } catch (err) { rep.push("❌ Виклик getManagers(): " + err); }

  try {
    var sh = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
    rep.push(sh ? "✅ Головна таблиця відкривається, рядків: " + sh.getLastRow()
                : "❌ Аркуш «" + T.MAIN_SHEET + "» не знайдено");
  } catch (err) { rep.push("❌ Головна таблиця: " + err); }

  var trg = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onMainEditTransfer") trg++;
  });
  rep.push(trg ? "✅ Тригер onMainEditTransfer встановлено"
               : "⚠️ Тригера немає — запусти installManagerTransferTrigger()");
  Logger.log(rep.join("\n"));
}


var TRANSFER_LOG_SHEET   = "_transfers"; // журнал перенесень у головному файлі
var TRANSFER_MAX_ROWS    = 50;           // максимум рядків за одне редагування
var TRANSFER_PUSH_TO_CRM = true;         // дублювати зміну менеджера в L-TEX CRM

// Колонки, які веде САМ менеджер у своєму файлі.
// При переносі вони не губляться: їдуть у головну (якщо там порожньо)
// і у файл нового менеджера.
// Функція, а не константа — щоб не залежати від порядку завантаження файлів.
function transferCarryMap_() {
  var T = TR();
  return [
    { mgrCol: 9,                   mainCol: T.COL.CONTACT     }, // Перший контакт
    { mgrCol: 10,                  mainCol: T.COL.ACTIVITY    }, // Активність
    { mgrCol: 11,                  mainCol: T.COL.STATUS      }, // Статус дії
    { mgrCol: T.MGR_COL_NEW_STATUS,  mainCol: T.COL.NEW_STATUS  }, // Оновлений статус
    { mgrCol: T.MGR_COL_NEW_COMMENT, mainCol: T.COL.NEW_COMMENT }  // Коментар
  ];
}


// ── Тригери ───────────────────────────────────────────────

function installManagerTransferTrigger() {
  var T = TR();
  var exists = false;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onMainEditTransfer" &&
        t.getTriggerSourceId() === T.MAIN_FILE_ID) exists = true;
  });
  if (exists) { Logger.log("ℹ️ Тригер перепризначення вже встановлено"); return; }
  ScriptApp.newTrigger("onMainEditTransfer")
    .forSpreadsheet(SpreadsheetApp.openById(T.MAIN_FILE_ID))
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
  var T = TR();
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== T.MAIN_SHEET) return;

    // Редагування зачепило колонку «Менеджер»?
    if (e.range.getColumn() > T.COL.MANAGER || e.range.getLastColumn() < T.COL.MANAGER) return;

    var startRow = Math.max(e.range.getRow(), T.DATA_START);
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
        var nowVal = sheet.getRange(r, T.COL.MANAGER).getValue();
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
// opts.repeatNote — короткий опис НОВОГО звернення клієнта. Якщо заданий,
// новий менеджер отримує повідомлення «повторний запит» з цим описом.
// Повертає {moved: true/false, id, from: [...], to: "..."}.
function transferLeadRow_(sheet, row, opts) {
  var T = TR();
  opts = opts || {};
  var rowData = sheet.getRange(row, 1, 1, T.MAIN_LAST_COL).getValues()[0];

  var rowId = rowData[T.COL.ID-1] ? rowData[T.COL.ID-1].toString().trim() : "";
  if (!rowId) {
    rowId = generateId();
    sheet.getRange(row, T.COL.ID).setValue(rowId);
    rowData[T.COL.ID-1] = rowId;
  }
  var name = rowData[T.COL.NAME-1] ? rowData[T.COL.NAME-1].toString().trim() : "";
  if (!name && !rowData[T.COL.PHONE-1]) return {moved:false, id:rowId, from:[], to:""}; // порожній рядок

  var toName   = rowData[T.COL.MANAGER-1] ? rowData[T.COL.MANAGER-1].toString().trim() : "";
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
  var note = opts.repeatNote ? opts.repeatNote.toString().trim() : "";
  if (toName && managers[toName] && managers[toName].viberId &&
      managers[toName].viberId !== opts.skipViberId) {
    if (note) {
      // Повторний запит: опис нового звернення — найперше, що бачить менеджер
      sendViber(managers[toName].viberId,
        "🔁 ПОВТОРНИЙ ЗАПИТ — вам передано контрагента!\n\n" +
        "❗ Новий запит: " + note + "\n\n" + card +
        "\nПопередній менеджер: " + fromLabel +
        "\n\n⚠️ Клієнт уже звертався до нас раніше. Подивіться історію в колонці" +
        " «Цікавить», актуалізуйте інформацію та відпрацюйте новий запит." +
        "\nКлієнт уже у вашій таблиці.");
    } else {
      sendViber(managers[toName].viberId,
        "📥 Вам передано контрагента!\n\n" + card +
        "\nПопередній менеджер: " + fromLabel +
        "\n\n⚠️ Потрібно актуалізувати інформацію та продовжити роботу." +
        "\nКлієнт уже у вашій таблиці.");
    }
  }

  // 5) Попереднім менеджерам
  for (var k = 0; k < removedFrom.length; k++) {
    var prev = removedFrom[k];
    var vid  = allFiles[prev] ? allFiles[prev].viberId : "";
    if (!vid || vid === opts.skipViberId) continue;
    sendViber(vid,
      "📤 Контрагента передано іншому менеджеру\n\n" + card +
      "\nНовий менеджер: " + (toName || "—") +
      (note ? "\nПричина: повторний запит — " + note : "") +
      "\n\nРядок прибрано з вашої таблиці — працювати по ньому більше не потрібно.");
  }

  // 6) Керівникам + журнал
  notifyOwners((note ? "🔁 Повторний запит + перепризначення" : "🔄 Перепризначення контрагента") +
               "\n\nID: " + rowId +
               "\nПІБ: " + (name || "—") +
               "\nТелефон: " + (rowData[T.COL.PHONE-1] || "—") +
               "\nБуло: " + fromLabel +
               "\nСтало: " + (toName || "—") +
               (note ? "\nЗапит: " + note : ""));
  logTransfer_(rowId, fromLabel, toName, name, rowData[T.COL.PHONE-1], note);

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
  var T = TR();
  var out = { removed: 0, carry: {} };
  try {
    var sheet   = SpreadsheetApp.openById(fileId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < T.MGR_DATA_START) return out;

    var lastCol = Math.max(sheet.getLastColumn(), T.MGR_LAST_COL);
    var data    = sheet.getRange(T.MGR_DATA_START, 1, lastRow - T.MGR_DATA_START + 1, lastCol).getValues();
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
      sheet.deleteRow(T.MGR_DATA_START + hits[d]);
      out.removed++;
    }
    SpreadsheetApp.flush();
  } catch (err) { Logger.log("removeLeadFromManagerFile_ (" + fileId + "): " + err); }
  return out;
}

// Дописує дані обдзвону у файл нового менеджера (лише в порожні клітинки).
function applyCarryToManagerFile_(fileId, rowId, carry) {
  var T = TR();
  var keys = Object.keys(carry || {});
  if (!keys.length) return;
  try {
    var sheet   = SpreadsheetApp.openById(fileId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < T.MGR_DATA_START) return;
    var ids = sheet.getRange(T.MGR_DATA_START, 1, lastRow - T.MGR_DATA_START + 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (!ids[i][0] || ids[i][0].toString().trim() !== rowId) continue;
      var target = T.MGR_DATA_START + i;
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
  var T = TR();
  try {
    var sheet   = SpreadsheetApp.openById(fileId).getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < T.MGR_DATA_START) return;
    var lastCol = Math.max(sheet.getLastColumn(), T.MGR_LAST_COL);
    var data    = sheet.getRange(T.MGR_DATA_START, 1, lastRow - T.MGR_DATA_START + 1, lastCol).getValues();

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
      sheet.deleteRow(T.MGR_DATA_START + hits[d]);
    }
    Logger.log("dedupe: " + rowId + " — прибрано дублів: " + (hits.length - 1));
  } catch (err) { Logger.log("dedupeManagerRowsById_: " + err); }
}

// Усі менеджери з аркуша «⚙️ Менеджери», включно з неактивними
// (щоб забрати рядок навіть у того, кого вже вимкнули).
function getAllManagerFiles_() {
  var T = TR();
  var out = {};
  try {
    var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MGR_SHEET);
    if (!sheet) return out;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return out;
    var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
    data.forEach(function(row) {
      var name = row[T.MGR_COL.NAME-1] ? row[T.MGR_COL.NAME-1].toString().trim() : "";
      if (!name) return;
      out[name] = {
        fileId:  row[T.MGR_COL.FILE_ID-1]  ? row[T.MGR_COL.FILE_ID-1].toString().trim()  : "",
        viberId: row[T.MGR_COL.VIBER_ID-1] ? row[T.MGR_COL.VIBER_ID-1].toString().trim() : ""
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
  var T = TR();
  var txt =
    "ID: "       + (rowData[T.COL.ID-1]       || "—") + "\n" +
    "ПІБ: "      + (rowData[T.COL.NAME-1]     || "—") + "\n" +
    "Телефон: "  + (rowData[T.COL.PHONE-1]    || "—") + "\n" +
    "Область: "  + (rowData[T.COL.REGION-1]   || "—") + "\n" +
    "Місто: "    + (rowData[T.COL.CITY-1]     || "—") + "\n" +
    "Цікавить: " + (rowData[T.COL.INTEREST-1] || "—") + "\n" +
    "Статус: "   + (rowData[T.COL.STATUS-1]   || "—") + "\n" +
    "Оновлений статус: " + (rowData[T.COL.NEW_STATUS-1] || "—");
  var comment = rowData[T.COL.NEW_COMMENT-1] ? rowData[T.COL.NEW_COMMENT-1].toString().trim() : "";
  if (comment) txt += "\nКоментар: " + (comment.length > 300 ? comment.substring(0, 300) + "…" : comment);
  return txt;
}

function logTransfer_(rowId, fromName, toName, clientName, phone, note) {
  var T = TR();
  try {
    var ss  = SpreadsheetApp.openById(T.MAIN_FILE_ID);
    var log = ss.getSheetByName(TRANSFER_LOG_SHEET);
    if (!log) {
      log = ss.insertSheet(TRANSFER_LOG_SHEET);
      log.getRange(1, 1, 1, 7)
         .setValues([["Дата", "ID ліда", "Було", "Стало", "ПІБ", "Телефон", "Повторний запит"]])
         .setFontWeight("bold");
      log.setFrozenRows(1);
      log.hideSheet();
    }
    // Журнал міг бути створений раніше, без 7-ї колонки
    if (!log.getRange(1, 7).getValue()) log.getRange(1, 7).setValue("Повторний запит").setFontWeight("bold");
    log.appendRow([new Date(), rowId, fromName || "—", toName || "—", clientName || "", phone || "", note || ""]);
  } catch (err) { Logger.log("logTransfer_: " + err); }
}


// ── Ручне перепризначення (з редактора Apps Script) ───────

function reassignLead(rowId, newManagerName, repeatNote) {
  var T = TR();
  var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
  if (!sheet) { Logger.log("Аркуш «" + T.MAIN_SHEET + "» не знайдено"); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < T.DATA_START) { Logger.log("Немає даних"); return; }

  var managers = getManagers();
  if (newManagerName && !managers[newManagerName]) {
    Logger.log("❌ Менеджер «" + newManagerName + "» не знайдений. Доступні: " + Object.keys(managers).join(", "));
    return;
  }
  var ids = sheet.getRange(T.DATA_START, T.COL.ID, lastRow - T.DATA_START + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (!ids[i][0] || ids[i][0].toString().trim() !== rowId) continue;
    var row = T.DATA_START + i;
    if (repeatNote) {
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
      var prev  = sheet.getRange(row, T.COL.INTEREST).getValue();
      prev = prev ? prev.toString().trim() : "";
      var line  = "🔁 Повторний запит " + stamp + ": " + repeatNote;
      sheet.getRange(row, T.COL.INTEREST).setValue(prev ? prev + "\n" + line : line);
      sheet.getRange(row, T.COL.STATUS).setValue("Очікує");
    }
    sheet.getRange(row, T.COL.MANAGER).setValue(newManagerName);
    SpreadsheetApp.flush();
    transferLeadRow_(sheet, row, {forceNotify: true, repeatNote: repeatNote || ""});
    Logger.log("✅ " + rowId + " → " + newManagerName);
    return;
  }
  Logger.log("❌ Лід " + rowId + " не знайдено в головній таблиці");
}

function reassignLeadByPhone(phone, newManagerName, repeatNote) {
  var T = TR();
  var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
  if (!sheet) return;
  var lastRow = sheet.getLastRow();
  if (lastRow < T.DATA_START) return;
  var phone9 = phone.toString().replace(/\D/g, "").slice(-9);
  var data = sheet.getRange(T.DATA_START, 1, lastRow - T.DATA_START + 1, T.MAIN_LAST_COL).getValues();
  for (var i = 0; i < data.length; i++) {
    var ph = data[i][T.COL.PHONE-1] ? data[i][T.COL.PHONE-1].toString().replace(/\D/g, "").slice(-9) : "";
    if (ph.length >= 8 && ph === phone9) {
      var id = data[i][T.COL.ID-1] ? data[i][T.COL.ID-1].toString().trim() : "";
      if (!id) {
        id = generateId();
        sheet.getRange(T.DATA_START + i, T.COL.ID).setValue(id);
      }
      reassignLead(id, newManagerName, repeatNote);
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
  var T = TR();
  if (dryRun === undefined) dryRun = true;
  var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
  if (!sheet) { Logger.log("Аркуш «" + T.MAIN_SHEET + "» не знайдено"); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < T.DATA_START) { Logger.log("Немає даних"); return; }

  var data  = sheet.getRange(T.DATA_START, 1, lastRow - T.DATA_START + 1, T.MAIN_LAST_COL).getValues();
  var owner = {};
  data.forEach(function(r) {
    var id = r[T.COL.ID-1] ? r[T.COL.ID-1].toString().trim() : "";
    if (id) owner[id] = r[T.COL.MANAGER-1] ? r[T.COL.MANAGER-1].toString().trim() : "";
  });

  var files = getAllManagerFiles_();
  var report = [];
  for (var name in files) {
    var fid = files[name].fileId;
    if (!fid) continue;
    try {
      var ms = SpreadsheetApp.openById(fid).getSheets()[0];
      var ml = ms.getLastRow();
      if (ml < T.MGR_DATA_START) continue;
      var ids = ms.getRange(T.MGR_DATA_START, 1, ml - T.MGR_DATA_START + 1, 1).getValues();
      var toDelete = [], unknown = 0;
      for (var i = 0; i < ids.length; i++) {
        var id = ids[i][0] ? ids[i][0].toString().trim() : "";
        if (!id) continue;
        if (owner[id] === undefined) { unknown++; continue; }
        if (owner[id] !== name) toDelete.push(i);
      }
      if (!dryRun) {
        for (var d = toDelete.length - 1; d >= 0; d--) ms.deleteRow(T.MGR_DATA_START + toDelete[d]);
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
// ▶ ПОВТОРНИЙ ЗАПИТ (клієнт уже є в CRM і звернувся знову) — просто допиши
//   через пробіл після імені менеджера короткий опис нового звернення:
//     /передати 0671234567 Дунас Богдан Питає ціну на палету, писав у TikTok
//   (роздільник «|» або новий рядок теж працюють, але не обовʼязкові)
//     /передати
//     Телефон: 0671234567
//     Менеджер: Дунас Богдан
//     Запит: Питає ціну на палету, писав у TikTok
//   Тоді опис дописується в «Цікавить» головної таблиці (історія звернень
//   зберігається), статус повертається в «Очікує», а новий менеджер отримує
//   повідомлення «🔁 ПОВТОРНИЙ ЗАПИТ» з текстом звернення.
//
// ▶ Права:
//     адміністратор і керівники (T.ADMIN, T.OWNERS) — будь-якого клієнта;
//     менеджер — тільки своїх клієнтів.

function handleTransferCommand(text, sender) {
  var T = TR();
  try {
    var raw = text.replace(/^\/(передати|передать|transfer)\s*/i, "").trim();
    var managers = getManagers();
    var p = parseTransferInput_(raw, managers);
    var key = p.key, note = p.note;

    if (p.empty) { sendViber(sender.id, transferHelpText_()); return; }

    // ── Хто просить ──
    var senderName = "";
    for (var mn in managers) {
      if (managers[mn].viberId && managers[mn].viberId === sender.id) { senderName = mn; break; }
    }
    var isAdmin = (T.ADMIN && sender.id === T.ADMIN) || T.OWNERS.indexOf(sender.id) !== -1;
    if (!isAdmin && !senderName) {
      sendViber(sender.id, "⛔ Команда доступна лише зареєстрованим менеджерам.\nНапишіть /старт для реєстрації.");
      return;
    }

    // ── Кому передаємо ──
    if (p.error) { sendViber(sender.id, p.error); return; }
    var toName = p.manager;

    // ── Якого клієнта ──
    var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
    if (!sheet) { sendViber(sender.id, "❌ Головну таблицю не знайдено."); return; }
    var found = findMainRowByKey_(sheet, key);
    if (!found) {
      sendViber(sender.id, "❌ Контрагента «" + key + "» не знайдено в таблиці 2026.\n\n" +
                           "Перевір номер або ID (його видно в картці клієнта).");
      return;
    }

    var rowData = found.data;
    var current = rowData[T.COL.MANAGER-1] ? rowData[T.COL.MANAGER-1].toString().trim() : "";

    if (!isAdmin && current && current !== senderName) {
      sendViber(sender.id, "⛔ Цей контрагент закріплений за менеджером «" + current + "».\n" +
                           "Передати його може сам менеджер або адміністратор.");
      return;
    }
    if (current === toName) {
      sendViber(sender.id, "ℹ️ Контрагент уже закріплений за менеджером «" + toName + "» — нічого змінювати.");
      return;
    }

    // ── Повторний запит: історія звернень + повернення в роботу ──
    if (note) {
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
      var who   = senderName || (sender.name ? sender.name : "адмін");
      var prev  = rowData[T.COL.INTEREST-1] ? rowData[T.COL.INTEREST-1].toString().trim() : "";
      var line  = "🔁 Повторний запит " + stamp + " (" + who + "): " + note;
      sheet.getRange(found.row, T.COL.INTEREST).setValue(prev ? prev + "\n" + line : line);
      // Клієнт звернувся знову — повертаємо в роботу
      sheet.getRange(found.row, T.COL.STATUS).setValue("Очікує");
    }

    // ── Переносимо ──
    sheet.getRange(found.row, T.COL.MANAGER).setValue(toName);
    SpreadsheetApp.flush();
    var res = transferLeadRow_(sheet, found.row,
      { skipViberId: sender.id, forceNotify: true, repeatNote: note });

    sendViber(sender.id,
      (note ? "✅ Контрагента передано як ПОВТОРНИЙ ЗАПИТ!\n\n" : "✅ Контрагента передано!\n\n") +
      "ПІБ: "      + (rowData[T.COL.NAME-1]  || "—") + "\n" +
      "Телефон: "  + (rowData[T.COL.PHONE-1] || "—") + "\n" +
      "ID: "       + (res && res.id ? res.id : "—") + "\n" +
      "Було: "     + (current || "—") + "\n" +
      "Стало: "    + toName + "\n" +
      (note ? "Запит: " + note + "\n(дописано в «Цікавить», статус → Очікує)\n" : "") + "\n" +
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

// Розбирає текст команди. Імʼя менеджера розпізнається зі списку
// зареєстрованих, тому опис нового звернення можна писати просто через
// пробіл після імені — роздільник не потрібен:
//     0671234567 Дунас Богдан Питає ціну на палету
// Працюють і явні роздільники: «|» та новий рядок, а також поля
// «Телефон:/ID:», «Менеджер:», «Запит:».
// Повертає {key, manager, note, error, empty}.
function parseTransferInput_(raw, managers) {
  var out = { key: "", manager: "", note: "", error: "", empty: false };

  // Формат з полями
  if (/(телефон|тел|id|ід|менеджер)\s*:/i.test(raw)) {
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
    out.key  = field(["телефон", "тел", "id", "ід"]);
    out.note = field(["запит", "коментар", "опис", "повторний запит"]);
    var mgrField = field(["менеджер"]);
    if (!out.key || !mgrField) { out.empty = true; return out; }
    var rf = resolveManagerName_(mgrField, managers);
    if (rf.error) { out.error = rf.error; return out; }
    out.manager = rf.name;
    return out;
  }

  // Явний роздільник опису — «|» або новий рядок (не обовʼязковий)
  var head = raw, tail = "";
  var bar = raw.indexOf("|"), nl = raw.indexOf("\n");
  var cut = (bar === -1) ? nl : (nl === -1 ? bar : Math.min(bar, nl));
  if (cut !== -1) { head = raw.substring(0, cut).trim(); tail = raw.substring(cut + 1).trim(); }

  var tokens = head.split(/\s+/).filter(String);
  if (tokens.length < 2) { out.empty = true; return out; }
  out.key = tokens.shift();

  // Імʼя менеджера = найдовший префікс, який однозначно вказує на менеджера.
  // Усі слова після нього — опис нового звернення.
  for (var n = Math.min(tokens.length, 5); n >= 1; n--) {
    var r = resolveManagerName_(tokens.slice(0, n).join(" "), managers);
    if (r.name) {
      out.manager = r.name;
      out.note = [tokens.slice(n).join(" ").trim(), tail].filter(String).join(" ").trim();
      return out;
    }
  }

  // Менеджера не впізнали — пояснюємо чому
  var e1 = resolveManagerName_(tokens[0], managers).error || "";
  if (e1.indexOf("підходить кілька") !== -1) { out.error = e1; return out; }
  var probe = tokens.slice(0, Math.min(2, tokens.length)).join(" ");
  out.error = resolveManagerName_(probe, managers).error || e1;
  return out;
}

function transferHelpText_() {
  var managers = getManagers();
  var list = Object.keys(managers).map(function(n) { return "  - " + n; }).join("\n");
  return "Передати контрагента іншому менеджеру:\n\n" +
         "/передати 0671234567 Дунас Богдан\n" +
         "/передати LTEX-20260101-1234 Дунас\n\n" +
         "Якщо це ПОВТОРНИЙ ЗАПИТ — просто допишіть після імені менеджера\n" +
         "короткий опис нового звернення:\n" +
         "/передати 0671234567 Дунас Богдан Питає ціну на палету, писав у TikTok\n\n" +
         "або кількома рядками:\n" +
         "/передати\nТелефон: 0671234567\nМенеджер: Дунас Богдан\nЗапит: Питає ціну на палету\n\n" +
         "Клієнт автоматично зникне з таблиці попереднього менеджера\n" +
         "і зʼявиться в таблиці нового. При повторному запиті менеджер\n" +
         "отримає позначку «🔁 ПОВТОРНИЙ ЗАПИТ» з вашим описом,\n" +
         "опис дописується в «Цікавить», а статус стає «Очікує».\n\n" +
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
  var T = TR();
  var lastRow = sheet.getLastRow();
  if (lastRow < T.DATA_START) return null;
  var data   = sheet.getRange(T.DATA_START, 1, lastRow - T.DATA_START + 1, T.MAIN_LAST_COL).getValues();
  var raw    = key.toString().trim();
  var byId   = /^ltex-/i.test(raw);
  var phone9 = raw.replace(/\D/g, "").slice(-9);

  for (var i = 0; i < data.length; i++) {
    if (byId) {
      var id = data[i][T.COL.ID-1] ? data[i][T.COL.ID-1].toString().trim() : "";
      if (id.toLowerCase() === raw.toLowerCase()) return { row: T.DATA_START + i, data: data[i] };
    } else if (phone9.length >= 8) {
      var ph = data[i][T.COL.PHONE-1] ? data[i][T.COL.PHONE-1].toString().replace(/\D/g, "").slice(-9) : "";
      if (ph.length >= 8 && ph === phone9) return { row: T.DATA_START + i, data: data[i] };
    }
  }
  return null;
}
