// ============================================================
// L-TEX CRM | v7.0 — Перепризначення менеджера (перенос контрагента)
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
// ▶ ВАЖЛИВО ПРО МАСОВУ ЗМІНУ МЕНЕДЖЕРА (інцидент 25.09.2026)
//   Кожен перенос бере спільний замок і робить важку роботу: відкриває файли
//   менеджерів, видаляє й додає рядки, шле Viber, штовхає зміну в CRM. Це
//   десятки секунд. Коли user змінив менеджера у 10 клієнтів підряд, перші
//   переноси тримали замок, а решта чекали свої 20 секунд і ТИХО зникали —
//   спрацювало 3 з 10. Ні переносу, ні сповіщення, ні сліду для користувача.
//   Тепер такий рядок не губиться: він іде в чергу, і хвилинний тригер
//   доводить його до кінця. Плюс швидкий шлях — коли відомо, від кого
//   передаємо, чистимо лише ЙОГО файл, а не всі.
//
// ▶ ВСТАНОВЛЕННЯ ЧЕРГИ (один раз, після оновлення файлу):
//     installTransferQueueTrigger()
//   Подивитись, чи щось висить:
//     checkTransferQueue()
//
// ▶ ЯКЩО ПЕРЕНОС «ВІДПРАЦЮВАВ», А РЯДОК ЛИШИВСЯ:
//     diagnoseTransferSetup             // назве причину: спільний файл або дубль ID
//
// ▶ ЗВІРКА (якщо є підозра, що перенос загубився):
//     resyncManagerAssignments          // тільки показати розбіжності
//     resyncManagerAssignmentsApply     // виправити й розіслати сповіщення
//   (обидві — з випадачки редактора, аргументи вписувати не треба)
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

// ── Хто може передавати БУДЬ-ЯКОГО клієнта, а не лише своїх ──────────────
//
// Звичайний менеджер передає тільки тих, хто закріплений за ним — це захист
// від випадкового «розкуркулення» чужої бази. Але є люди, чия робота саме в
// тому, щоб розподіляти клієнтів між іншими.
//
// Два способи дати право, обидва працюють разом:
//   1) вписати імʼя сюди — рівно так, як воно в аркуші «⚙️ Менеджери»,
//      колонка A. Нічого більше налаштовувати не треба;
//   2) поставити людині роль із TR_TRANSFER_ANY_ROLES у колонці B того ж
//      аркуша — тоді право видається без правок коду.
//
// ⚠️ Другий спосіб має побічний ефект: бот показує в шаблоні лише тих, у
// кого роль «менеджер», тож людина з роллю «керівник» зникне зі списку
// «Доступні менеджери». Якщо вона приймає ліди — беріть перший спосіб.
var TR_TRANSFER_ANY_NAMES = ["Зингель Олена"];
var TR_TRANSFER_ANY_ROLES = ["керівник", "керівниця", "адмін", "адміністратор"];

// Чи має ця людина право передавати чужих клієнтів.
function trCanTransferAny_(name, role) {
  var n = (name || "").toString().trim().toLowerCase();
  for (var i = 0; i < TR_TRANSFER_ANY_NAMES.length; i++) {
    if (n && n === TR_TRANSFER_ANY_NAMES[i].toLowerCase()) return true;
  }
  var r = (role || "").toString().trim().toLowerCase();
  for (var j = 0; j < TR_TRANSFER_ANY_ROLES.length; j++) {
    if (r && r === TR_TRANSFER_ANY_ROLES[j]) return true;
  }
  return false;
}
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
var TRANSFER_RESYNC_PER_RUN  = 25;       // скільки ПЕРЕНОСІВ робить звірка за запуск
var TRANSFER_RESYNC_CLEAN_PER_RUN = 60;  // скільки зайвих копій прибирає за запуск
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


// ── Черга відкладених переносів ───────────────────────────
//
// НАВІЩО. Перенос бере спільний замок на 20 секунд. Коли менеджера міняють у
// кількох клієнтів підряд, перші переноси тримають замок, а решта не встигають
// його дочекатись. Раніше такий рядок просто зникав — user змінив менеджера у
// 10 клієнтів, а переїхало 3, і про сім інших ніде не було ні слова.
//
// Тепер рядок, який не встиг, лягає в чергу, і хвилинний тригер доводить його
// до кінця. Черга живе у властивостях скрипта — ОДИН ключ на рядок, а не
// спільний список: паралельні записи в спільний список самі себе затирали б,
// тобто ми міняли б одну втрату на іншу.

var TRANSFER_QUEUE_PREFIX  = "TRPEND_";   // TRPEND_<ID> → кількість спроб
var TRANSFER_QUEUE_PER_RUN = 5;           // скільки доводимо до кінця за запуск
var TRANSFER_QUEUE_TRIES   = 10;          // після стількох невдач — здаємось і кажемо

// Кладе рядок у чергу. Повторний виклик по тому самому ID лічильник не збиває.
function transferQueuePush_(rowId) {
  var id = (rowId || "").toString().trim();
  if (!id) { Logger.log("transferQueuePush_: порожній ID, рядок втрачено"); return; }
  try {
    var props = PropertiesService.getScriptProperties();
    var key   = TRANSFER_QUEUE_PREFIX + id;
    if (!props.getProperty(key)) props.setProperty(key, "0");
    Logger.log("transfer: " + id + " → у чергу (система зайнята)");
  } catch (err) { Logger.log("transferQueuePush_: " + err); }
}

function transferQueueKeys_() {
  var out = [];
  try {
    var all = PropertiesService.getScriptProperties().getProperties();
    for (var k in all) if (k.indexOf(TRANSFER_QUEUE_PREFIX) === 0) out.push(k);
  } catch (err) { Logger.log("transferQueueKeys_: " + err); }
  return out.sort();
}

// Хвилинний тригер: доводить до кінця те, що не встигло за редагуванням.
function processTransferQueue() {
  var T    = TR();
  var keys = transferQueueKeys_();
  if (!keys.length) return;

  var props = PropertiesService.getScriptProperties();
  var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
  if (!sheet) { Logger.log("processTransferQueue: аркуш не знайдено"); return; }

  var done = 0;
  for (var i = 0; i < keys.length && done < TRANSFER_QUEUE_PER_RUN; i++) {
    var key   = keys[i];
    var rowId = key.slice(TRANSFER_QUEUE_PREFIX.length);
    var tries = parseInt(props.getProperty(key) || "0", 10) + 1;

    var row = findMainRowById_(sheet, rowId);
    if (!row) {
      // Рядок зник із головної — тримати його в черзі нема сенсу.
      props.deleteProperty(key);
      Logger.log("processTransferQueue: " + rowId + " немає в головній, прибрано з черги");
      continue;
    }

    var res;
    try {
      res = transferLeadRow_(sheet, row);
    } catch (err) {
      Logger.log("processTransferQueue: " + rowId + ": " + err);
      res = {busy: true};
    }
    done++;

    if (res && res.busy) {
      props.setProperty(key, String(tries));
      if (tries >= TRANSFER_QUEUE_TRIES) {
        // Мовчки здатись — це те, з чого все й почалось. Кажемо керівникам.
        props.deleteProperty(key);
        notifyOwners("⚠️ Перенос контрагента не вдався\n\nID: " + rowId +
                     "\nСпроб: " + tries +
                     "\n\nЗапустіть у редакторі скриптів: resyncManagerAssignments(false)");
      }
      continue;
    }
    props.deleteProperty(key);
    Logger.log("processTransferQueue: " + rowId + " доведено до кінця з " + tries + "-ї спроби");
  }
}

// Номер рядка головної таблиці за ID. 0 — немає такого.
function findMainRowById_(sheet, rowId) {
  var T  = TR();
  var id = (rowId || "").toString().trim();
  if (!id) return 0;
  var lastRow = sheet.getLastRow();
  if (lastRow < T.DATA_START) return 0;
  var ids = sheet.getRange(T.DATA_START, T.COL.ID, lastRow - T.DATA_START + 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] && ids[i][0].toString().trim() === id) return T.DATA_START + i;
  }
  return 0;
}

function installTransferQueueTrigger() {
  var exists = false;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "processTransferQueue") exists = true;
  });
  if (exists) { Logger.log("ℹ️ Тригер черги переносів уже встановлено"); return; }
  ScriptApp.newTrigger("processTransferQueue").timeBased().everyMinutes(1).create();
  Logger.log("✅ Тригер processTransferQueue встановлено (щохвилини)");
}

function removeTransferQueueTrigger() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "processTransferQueue") { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log("Видалено тригерів черги: " + removed);
}

// Що зараз висить у черзі. Запускай, якщо перенос «не доїхав».
function checkTransferQueue() {
  var keys = transferQueueKeys_();
  if (!keys.length) { Logger.log("Черга порожня — усе доведено до кінця."); return; }
  var props = PropertiesService.getScriptProperties();
  var lines = ["У черзі: " + keys.length];
  keys.forEach(function(k) {
    lines.push("  " + k.slice(TRANSFER_QUEUE_PREFIX.length) +
               " — спроб: " + (props.getProperty(k) || "0"));
  });
  var has = false;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "processTransferQueue") has = true;
  });
  lines.push(has ? "✅ Тригер черги встановлено" :
                   "❌ Тригера немає — запусти installTransferQueueTrigger()");
  Logger.log(lines.join("\n"));
}


// ── Звірка: головна таблиця проти файлів менеджерів ───────
//
// Головна таблиця — джерело правди. Ця функція знаходить рядки, у яких файли
// менеджерів із нею розійшлись (клієнт лежить не в того або взагалі ні в кого),
// і доводить їх до ладу — зі звичайними сповіщеннями.
//
// Потрібна там, де тригер редагування не спрацював: масова правка, вставка
// кількох рядків одразу, збій Google. Дорога операція (відкриває всі файли
// менеджерів), тож за один запуск виправляємо небагато — решта підхопиться
// наступним запуском, про що функція й скаже.
//
//   resyncManagerAssignments(true)    // тільки показати
//   resyncManagerAssignments(false)   // виправити
function resyncManagerAssignments(dryRun) {
  var T = TR();
  if (dryRun === undefined) dryRun = true;

  var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
  if (!sheet) { Logger.log("Аркуш «" + T.MAIN_SHEET + "» не знайдено"); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < T.DATA_START) { Logger.log("Немає даних"); return; }

  var data  = sheet.getRange(T.DATA_START, 1, lastRow - T.DATA_START + 1, T.MAIN_LAST_COL).getValues();
  var want  = {};   // ID → менеджер за головною
  var rowOf = {};   // ID → номер рядка
  for (var i = 0; i < data.length; i++) {
    var id = data[i][T.COL.ID-1] ? data[i][T.COL.ID-1].toString().trim() : "";
    if (!id) continue;
    // Порожні рядки (без імені й телефону) не рахуємо за роботу.
    if (!data[i][T.COL.NAME-1] && !data[i][T.COL.PHONE-1]) continue;
    want[id]  = data[i][T.COL.MANAGER-1] ? data[i][T.COL.MANAGER-1].toString().trim() : "";
    rowOf[id] = T.DATA_START + i;
  }

  // Хто зараз тримає кожен ID. Кожен файл читаємо РІВНО ОДИН раз.
  var files = getAllManagerFiles_();
  var holders = {};
  for (var name in files) {
    var fid = files[name].fileId;
    if (!fid) continue;
    try {
      var ms = SpreadsheetApp.openById(fid).getSheets()[0];
      var ml = ms.getLastRow();
      if (ml < T.MGR_DATA_START) continue;
      var ids = ms.getRange(T.MGR_DATA_START, 1, ml - T.MGR_DATA_START + 1, 1).getValues();
      for (var j = 0; j < ids.length; j++) {
        var mid = ids[j][0] ? ids[j][0].toString().trim() : "";
        if (!mid) continue;
        if (!holders[mid]) holders[mid] = {};
        holders[mid][name] = true;
      }
    } catch (err) { Logger.log("resync: файл «" + name + "»: " + err); }
  }

  // У кого з менеджерів узагалі Є файл. Без файлу рядок нікуди покласти —
  // і це не та розбіжність, яку виправляють переносом: там бракує таблиці
  // менеджера, а не синхронізації. Раніше такі рядки лізли б у чергу на
  // виправлення знову й знову, з'їдаючи ліміт і не зникаючи ніколи.
  var hasFile = {};
  for (var fn in files) if (files[fn].fileId) hasFile[fn] = true;

  // Двом менеджерам вписали один файл — перенос між ними неможливий у
  // принципі, і звірка бралася б за ці рядки вічно. Відкладаємо окремо.
  var sameFileAs = {};
  for (var n1 in files) {
    for (var n2 in files) {
      if (n1 === n2 || !files[n1].fileId) continue;
      if (files[n1].fileId === files[n2].fileId) {
        (sameFileAs[n1] = sameFileAs[n1] || {})[n2] = true;
      }
    }
  }

  var broken = [];
  var noFile = {};    // менеджер → скільки рядків на ньому висить
  var shared = {};    // «А + Б» → скільки рядків через спільний файл
  for (var wid in want) {
    var to   = want[wid];
    var has  = holders[wid] || {};
    var mine = !!has[to];
    var alien = [];
    for (var h in has) if (h !== to) alien.push(h);
    // Менеджер не призначений — нічийний рядок, це не розбіжність.
    if (!to) { if (alien.length) broken.push({id: wid, to: "—", alien: alien, mine: false}); continue; }
    if (!mine || alien.length) {
      if (!hasFile[to]) { noFile[to] = (noFile[to] || 0) + 1; continue; }
      // Усі «чужі» — це насправді той самий файл, що й у потрібного менеджера?
      var real = [];
      for (var a = 0; a < alien.length; a++) {
        if (sameFileAs[to] && sameFileAs[to][alien[a]]) {
          var key = to + " + " + alien[a];
          shared[key] = (shared[key] || 0) + 1;
        } else real.push(alien[a]);
      }
      if (!real.length && mine) continue;   // розбіжність уявна: файл один
      broken.push({id: wid, to: to, alien: real, mine: mine});
    }
  }

  var noFileNames = [];
  for (var nf in noFile) noFileNames.push(nf);

  var sharedCount = 0;
  for (var sc in shared) sharedCount++;
  if (!broken.length && !noFileNames.length && !sharedCount) {
    Logger.log("✅ Розбіжностей немає: файли менеджерів збігаються з головною.");
    return;
  }

  // Три різні числа, бо це три різні роботи: перенести, прибрати зайве,
  // просто додати. Раніше дубль потрапляв у «не в того менеджера» — і рядок
  // підсумку суперечив кожному рядку списку під ним.
  var lost = 0, misplaced = 0, dups = 0;
  for (var c2 = 0; c2 < broken.length; c2++) {
    if (!broken[c2].alien.length) lost++;
    else if (broken[c2].mine)     dups++;
    else                          misplaced++;
  }

  var lines = ["Розбіжностей: " + broken.length +
               " (перенести: " + misplaced +
               ", прибрати зайву копію: " + dups +
               ", немає ні в кого: " + lost + ")"];
  for (var b = 0; b < broken.length && b < 40; b++) {
    // Три різні біди, які раніше друкувались однаково. «Є в потрібного, але
    // ще й у чужого» — це дубль, а не незроблений перенос, і шукати його
    // треба зовсім не там, де «лежить лише у чужого».
    var what;
    if (!broken[b].alien.length)   what = ", немає ні в кого";
    else if (broken[b].mine)       what = ", Є У НЬОГО, але ЩЕ Й у: " + broken[b].alien.join(", ") + " — дубль";
    else                           what = ", лежить лише у: " + broken[b].alien.join(", ");
    lines.push("  " + broken[b].id + " → має бути «" + broken[b].to + "»" + what);
  }
  if (broken.length > 40) lines.push("  … і ще " + (broken.length - 40));

  var sharedKeys = [];
  for (var sk in shared) sharedKeys.push(sk);
  if (sharedKeys.length) {
    lines.push("");
    lines.push("❌ ОДИН ФАЙЛ НА ДВОХ МЕНЕДЖЕРІВ — перенос між ними неможливий:");
    for (var s2 = 0; s2 < sharedKeys.length; s2++) {
      lines.push("   " + sharedKeys[s2] + " — спільних рядків: " + shared[sharedKeys[s2]]);
    }
    lines.push("   Виправте ID файлу в аркуші «⚙️ Менеджери», колонка D.");
    lines.push("   Докладно — запустіть diagnoseTransferSetup.");
  }

  if (noFileNames.length) {
    lines.push("");
    lines.push("⚠️ Менеджери БЕЗ таблиці — їхні клієнти нікуди класти:");
    for (var n2 = 0; n2 < noFileNames.length; n2++) {
      lines.push("   " + noFileNames[n2] + " — клієнтів: " + noFile[noFileNames[n2]]);
    }
    lines.push("   Заведіть файл і впишіть його ID в аркуш «⚙️ Менеджери», колонка D,");
    lines.push("   потім запустіть звірку ще раз — клієнти поїдуть самі.");
  }

  if (dryRun) {
    lines.push("");
    lines.push("=== Це була ПЕРЕВІРКА. Щоб виправити — запустіть resyncManagerAssignmentsApply ===");
    Logger.log(lines.join("\n"));
    return;
  }

  // Виправляємо. Кожен перенос — десятки секунд, а на виконання дається 6
  // хвилин, тож беремо небагато і чесно кажемо, скільки лишилось.
  // Ліміти окремі: прибрати копію — це одне відкриття файлу, а перенос — ще й
  // запис новому менеджеру, два Viber і звернення до CRM. Спільний ліміт
  // означав би, що десяток дублів з'їдає квоту на справжні переноси.
  var fixed = 0, cleaned = 0, left = 0;
  for (var f = 0; f < broken.length; f++) {
    var isDup = broken[f].mine && broken[f].alien.length;
    if (isDup ? (cleaned >= TRANSFER_RESYNC_CLEAN_PER_RUN)
              : (fixed   >= TRANSFER_RESYNC_PER_RUN)) {
      left = broken.length - fixed - cleaned;
      break;
    }
    var row = rowOf[broken[f].id];
    if (!row) continue;

    // ДУБЛЬ: клієнт уже в потрібного менеджера, просто лишилась зайва копія в
    // старого. Тут нема чого переносити — треба прибрати копію. Гнати це через
    // перенос означало б розіслати обом менеджерам «вам передано контрагента»
    // вдруге за той самий рух: людина читає це як нову роботу й береться за
    // клієнта, з яким уже все зроблено.
    if (broken[f].mine) {
      for (var a2 = 0; a2 < broken[f].alien.length; a2++) {
        var afid = files[broken[f].alien[a2]] ? files[broken[f].alien[a2]].fileId : "";
        if (!afid) continue;
        try {
          var rem = removeLeadFromManagerFile_(afid, broken[f].id);
          if (rem.removed > 0) {
            Logger.log("resync: " + broken[f].id + " — прибрано зайву копію у «" +
                       broken[f].alien[a2] + "»");
          }
        } catch (err2) { Logger.log("resync (дубль): " + broken[f].id + ": " + err2); }
      }
      cleaned++;
      continue;
    }

    var res;
    try {
      // Ми щойно прочитали всі файли — отже точно знаємо, хто тримає рядок.
      // Передаємо цей список, щоб не відкривати решту файлів дарма: саме на
      // цьому перенос і втрачав секунди під замком.
      res = transferLeadRow_(sheet, row, {fromNames: broken[f].alien});
    } catch (err) {
      Logger.log("resync: " + broken[f].id + ": " + err);
      res = {busy: true};
    }
    if (res && res.busy) { transferQueuePush_(broken[f].id); continue; }
    fixed++;
  }
  lines.push("🔄 Перенесено: " + fixed + " · 🧹 Прибрано зайвих копій: " + cleaned);
  if (left) lines.push("⏳ Лишилось " + left + " — запустіть resyncManagerAssignmentsApply ще раз");
  Logger.log(lines.join("\n"));
}


// ── Діагностика: чому перенос «відпрацював», а рядок лишився ──
//
// 25.09 перенос відзвітував про успіх по 36 клієнтах — сповіщення прийшли, у
// журналі чисто, — а звірка наступного ранку показала ті самі 36 на місці.
// Так буває від двох речей, і обидві не в коді, а в даних:
//
//   • двом менеджерам вписали ОДИН файл. Тоді «прибрати в одного» і «додати
//     іншому» — та сама таблиця: перенос чесно звітує, рядок нікуди не
//     дівається, звірка бачить розбіжність вічно;
//   • у головній таблиці ДУБЛЬ рядка з тим самим ID: в одному менеджер
//     новий, у другому старий. Що б ми не переносили, другий рядок повертає
//     клієнта назад.
//
// Функція дивиться рівно на це й каже, котре з двох. Нічого не змінює.
function diagnoseTransferSetup() {
  var T = TR();
  var out = ["=== Діагностика переносу ==="];

  // 1) Менеджери, їхні файли й спільні файли
  var files = getAllManagerFiles_();
  var names = [];
  for (var n in files) names.push(n);
  names.sort();

  var byFile = {};
  out.push("");
  out.push("Менеджери (" + names.length + "):");
  for (var i = 0; i < names.length; i++) {
    var fid = files[names[i]].fileId;
    out.push("  " + names[i] +
             " — файл: " + (fid ? "…" + fid.slice(-8) : "НЕМАЄ") +
             ", Viber: " + (files[names[i]].viberId ? "є" : "НЕМАЄ"));
    if (fid) (byFile[fid] = byFile[fid] || []).push(names[i]);
  }

  var shared = [];
  for (var f in byFile) if (byFile[f].length > 1) shared.push(byFile[f]);
  out.push("");
  if (shared.length) {
    out.push("❌ ПРИЧИНА ЗНАЙДЕНА: один файл на кількох менеджерів");
    for (var sh = 0; sh < shared.length; sh++) {
      out.push("   " + shared[sh].join("  +  ") + " — таблиця та сама");
    }
    out.push("   Перенос між ними неможливий: він прибирає й додає в один файл.");
    out.push("   Виправте ID у аркуші «⚙️ Менеджери», колонка D, і запустіть звірку.");
  } else {
    out.push("✅ У кожного менеджера свій окремий файл");
  }

  // 2) Дублі ID у головній таблиці
  var sheet = SpreadsheetApp.openById(T.MAIN_FILE_ID).getSheetByName(T.MAIN_SHEET);
  if (!sheet) { out.push("❌ Аркуш «" + T.MAIN_SHEET + "» не знайдено"); Logger.log(out.join("\n")); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < T.DATA_START) { out.push("Немає даних"); Logger.log(out.join("\n")); return; }

  var data = sheet.getRange(T.DATA_START, 1, lastRow - T.DATA_START + 1, T.MAIN_LAST_COL).getValues();
  var seen = {};          // ID → [{row, manager}]
  for (var d = 0; d < data.length; d++) {
    var id = data[d][T.COL.ID-1] ? data[d][T.COL.ID-1].toString().trim() : "";
    if (!id) continue;
    if (!data[d][T.COL.NAME-1] && !data[d][T.COL.PHONE-1]) continue;
    (seen[id] = seen[id] || []).push({
      row: T.DATA_START + d,
      mgr: data[d][T.COL.MANAGER-1] ? data[d][T.COL.MANAGER-1].toString().trim() : ""
    });
  }

  var dupSame = 0, dupDiff = [];
  for (var id2 in seen) {
    if (seen[id2].length < 2) continue;
    var mgrs = {};
    for (var k = 0; k < seen[id2].length; k++) mgrs[seen[id2][k].mgr] = true;
    if (Object.keys(mgrs).length > 1) dupDiff.push({id: id2, rows: seen[id2]});
    else dupSame++;
  }

  out.push("");
  if (dupDiff.length) {
    out.push("❌ ПРИЧИНА ЗНАЙДЕНА: один ID у кількох рядках з РІЗНИМИ менеджерами (" + dupDiff.length + ")");
    out.push("   Другий рядок повертає клієнта старому менеджеру після кожного переносу.");
    for (var dd = 0; dd < dupDiff.length && dd < 20; dd++) {
      var parts = [];
      for (var pr = 0; pr < dupDiff[dd].rows.length; pr++) {
        parts.push("рядок " + dupDiff[dd].rows[pr].row + " → «" + (dupDiff[dd].rows[pr].mgr || "—") + "»");
      }
      out.push("   " + dupDiff[dd].id + ": " + parts.join(" | "));
    }
    if (dupDiff.length > 20) out.push("   … і ще " + (dupDiff.length - 20));
    out.push("   Лишіть один рядок на клієнта — зайві видаліть.");
  } else {
    out.push("✅ ID з різними менеджерами в кількох рядках немає" +
             (dupSame ? " (однакових дублів: " + dupSame + " — вони переносу не заважають)" : ""));
  }

  // 3) Що насправді лежить у файлах
  out.push("");
  out.push("У файлах менеджерів:");
  for (var j = 0; j < names.length; j++) {
    var fid2 = files[names[j]].fileId;
    if (!fid2) { out.push("  " + names[j] + " — файлу немає"); continue; }
    try {
      var ms = SpreadsheetApp.openById(fid2).getSheets()[0];
      var ml = ms.getLastRow();
      var rows = Math.max(0, ml - T.MGR_DATA_START + 1);
      var alien = 0;
      if (rows > 0) {
        var ids = ms.getRange(T.MGR_DATA_START, 1, rows, 1).getValues();
        for (var q = 0; q < ids.length; q++) {
          var mid = ids[q][0] ? ids[q][0].toString().trim() : "";
          if (!mid || !seen[mid]) continue;
          var belongs = false;
          for (var w = 0; w < seen[mid].length; w++) if (seen[mid][w].mgr === names[j]) belongs = true;
          if (!belongs) alien++;
        }
      }
      out.push("  " + names[j] + " — рядків: " + rows + (alien ? ", з них чужих: " + alien : ""));
    } catch (err) { out.push("  " + names[j] + " — ❌ " + err); }
  }

  // 4) Хто ще в цьому проєкті може писати у файли менеджерів.
  //
  // Наш перенос — не єдиний код у проєкті. Якщо рядки повертаються, а обидві
  // причини вище виключені, найімовірніше їх повертає інший тригер: звідси
  // цього не видно, а зі списку — видно.
  out.push("");
  out.push("Тригери проєкту:");
  try {
    var trg = ScriptApp.getProjectTriggers();
    if (!trg.length) out.push("  (жодного)");
    for (var t = 0; t < trg.length; t++) {
      var kind;
      try { kind = trg[t].getEventType ? String(trg[t].getEventType()) : "?"; } catch (e1) { kind = "?"; }
      out.push("  " + trg[t].getHandlerFunction() + " — " + kind);
    }
  } catch (err) { out.push("  ❌ " + err); }

  if (!shared.length && !dupDiff.length) {
    out.push("");
    out.push("Обидві відомі причини виключені — отже рядки повертає щось інше.");
    out.push("Найімовірніше це інший тригер зі списку вище (у Code.gs теж є код,");
    out.push("що пише у файли менеджерів). Надішліть цей звіт — розберемо.");
  }

  Logger.log(out.join("\n"));
}


// Виправити знайдені розбіжності.
//
// Окрема функція без аргументів навмисно: випадачка редактора Apps Script
// показує ЛИШЕ функції без параметрів і запускає їх без жодного значення —
// тобто `resyncManagerAssignments` звідти завжди спрацює як перевірка. Просити
// user щоразу лізти в код і дописувати `(false)` — це та сама пастка, через
// яку роботу відкладають «на потім».
function resyncManagerAssignmentsApply() {
  resyncManagerAssignments(false);
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
    // Хто був менеджером ДО правки. Telegram… тобто Google дає це лише для
    // одиночного редагування — і саме воно дозволяє чистити ОДИН файл замість
    // усіх. Менше роботи під замком — менше черг і втрачених переносів.
    var fromHint = (single && e.oldValue !== undefined && e.oldValue !== null)
      ? e.oldValue.toString().trim() : "";

    for (var r = startRow; r <= endRow; r++) {
      // Для одиночного редагування можемо відсіяти «зміну без зміни»
      if (single && fromHint !== "") {
        var nowVal = sheet.getRange(r, T.COL.MANAGER).getValue();
        if (fromHint === (nowVal ? nowVal.toString().trim() : "")) continue;
      }

      // Рядок не має губитись, навіть якщо система зайнята. Раніше
      // `transferLeadRow_` тихо повертав busy, а тут результат ніхто не читав —
      // і перенос зникав без сліду (див. коментар угорі файлу).
      var res;
      try {
        res = transferLeadRow_(sheet, r, {fromHint: fromHint});
      } catch (rowErr) {
        Logger.log("onMainEditTransfer: рядок " + r + ": " + rowErr);
        res = {busy: true, id: ""};
      }
      if (res && res.busy) transferQueuePush_(res.id || rowIdAt_(sheet, r));
    }
  } catch (err) { Logger.log("onMainEditTransfer: " + err); }
}

// ID рядка головної таблиці (для черги, коли перенос навіть не стартував).
function rowIdAt_(sheet, row) {
  var T = TR();
  try {
    var v = sheet.getRange(row, T.COL.ID).getValue();
    return v ? v.toString().trim() : "";
  } catch (err) { return ""; }
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
    // 1) Прибираємо рядок з файлів попередніх менеджерів.
    //
    // Коли відомо, від КОГО передаємо (`fromHint` з e.oldValue), чистимо лише
    // його файл. Повний обхід усіх файлів — це десятки секунд під замком, і
    // саме через них масова зміна менеджера втрачала переноси. Рядок, що з
    // якоїсь давньої помилки лежить ще в чужому файлі, підбере звірка
    // `resyncManagerAssignments`.
    // `fromNames` — точний список (його передає звірка: вона щойно прочитала
    // всі файли й знає, хто саме тримає рядок; порожній список означає «ні в
    // кого», і тоді не відкриваємо жодного файлу).
    // `fromHint` — здогад з e.oldValue для одиночного редагування.
    var only = null;   // null = обходимо всі файли
    if (opts.fromNames && Object.prototype.toString.call(opts.fromNames) === "[object Array]") {
      only = {};
      for (var q = 0; q < opts.fromNames.length; q++) only[opts.fromNames[q]] = true;
    } else {
      var fromHint = opts.fromHint ? opts.fromHint.toString().trim() : "";
      if (fromHint && fromHint !== toName && allFiles[fromHint]) {
        only = {}; only[fromHint] = true;
      }
    }
    // Файл призначення. Якщо в аркуші «⚙️ Менеджери» двом людям помилково
    // вписали ОДИН файл, то «прибрати в одного» і «додати іншому» — це та сама
    // таблиця: перенос звітував би про успіх, рядок лишався б на місці, а
    // звірка бачила б ту саму розбіжність знову й знову. Такий файл не чіпаємо
    // взагалі — проблему називає `diagnoseTransferSetup`.
    var toFileId = (toName && allFiles[toName]) ? allFiles[toName].fileId : "";

    for (var mName in allFiles) {
      if (mName === toName) continue;
      if (only && !only[mName]) continue;
      var fid = allFiles[mName].fileId;
      if (!fid) continue;
      if (toFileId && fid === toFileId) {
        Logger.log("transfer: «" + mName + "» і «" + toName + "» мають ОДИН файл — пропускаю");
        continue;
      }
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
//     адміністратор, керівники (T.ADMIN, T.OWNERS) і всі, кого названо в
//       TR_TRANSFER_ANY_NAMES / TR_TRANSFER_ANY_ROLES — будь-якого клієнта;
//     решта менеджерів — тільки своїх клієнтів.

// Прибрати з файлів менеджерів усе, що за головною таблицею їм не належить.
//
// Без аргументів — щоб було видно у випадачці редактора (вона показує лише
// такі функції). Рядки, ID яких у головній немає, не чіпає: вони можуть бути
// старішими за саму головну.
function cleanupManagerFilesFromMainApply() {
  cleanupManagerFilesFromMain(false);
}


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
    // Назва саме така, а не isAdmin: право стосується ВИКЛЮЧНО цієї команди.
    // Інші команди бота («/реєстрація», «/довідник») звіряють ADMIN_VIBER_ID
    // напряму й лишаються недоступними — людина зі списків вище отримує
    // можливість передавати клієнтів, а не права адміністратора.
    var canTransferAny = (T.ADMIN && sender.id === T.ADMIN) ||
                         T.OWNERS.indexOf(sender.id) !== -1 ||
                         (senderName && managers[senderName] &&
                          trCanTransferAny_(senderName, managers[senderName].role));
    if (!canTransferAny && !senderName) {
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

    if (!canTransferAny && current && current !== senderName) {
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
