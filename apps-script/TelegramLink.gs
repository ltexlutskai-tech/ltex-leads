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
//      посиланням на Telegram-канал (персональним для цього
//      клієнта, а без бота — для його області) і готовим
//      текстом повідомлення (кнопка «Скопіювати»).
//   3. Статус «✅ Надіслано», дата і саме посилання пишуться
//      в таблицю В МОМЕНТ відкриття сторінки — менеджер нічого
//      не відмічає руками. Отримати посилання, не залишивши
//      сліду, неможливо: його видає лише ця сторінка.
//   4. Кожне натискання пишеться в лог «_tg_log»:
//      дата, ID, ПІБ, телефон, область, менеджер, посилання, джерело.
//   5. Посилання унікальне для КОЖНОГО клієнта (TelegramJoin.gs):
//      коли клієнт за ним переходить, у таблицю сам потрапляє
//      його нікнейм у Telegram — тобто нік звʼязується з номером.
//      Без бота працює запасний варіант: посилання по областях.
//
// НОВІ КОЛОНКИ (додаються в КІНЕЦЬ, наявні дані не зсуваються)
//   головна таблиця → T–Y  (20–25)
//   файл менеджера  → S–X  (19–24)
//   кнопка · статус · дата надсилання · видане посилання ·
//   нікнейм клієнта · дата приєднання
//
// Персональне посилання на кожного клієнта і автоматичний запис
// нікнейму — у файлі TelegramJoin.gs.
//
// ВСТАНОВЛЕННЯ — apps-script/README.md
// ============================================================


// ── Колонки ───────────────────────────────────────────────
var TG_MAIN_BTN = 20, TG_MAIN_STATUS = 21, TG_MAIN_DATE = 22, TG_MAIN_LINK = 23,
    TG_MAIN_NICK = 24, TG_MAIN_JOINED = 25, TG_MAIN_TGID = 26;
var TG_MGR_BTN  = 19, TG_MGR_STATUS  = 20, TG_MGR_DATE  = 21, TG_MGR_LINK  = 22,
    TG_MGR_NICK  = 23, TG_MGR_JOINED  = 24, TG_MGR_TGID  = 25;

// Остання колонка блоку TG. Рядок читаємо саме до неї: якби читали до
// попередньої, новий стовпчик лишався б непрочитаним — і запис блоку
// затирав би його порожнечею.
var TG_MAIN_LAST = TG_MAIN_TGID;
var TG_MGR_LAST  = TG_MGR_TGID;

// Скільки колонок блоку TG пишеться одним записом: статус → TG ID
var TG_BLOCK = 6;

var TG_HDR_BTN    = "📨 Надіслати TG";
var TG_HDR_STATUS = "Статус TG-посилання";
var TG_HDR_DATE   = "Дата надсилання TG";
var TG_HDR_LINK   = "Видане TG-посилання";
var TG_HDR_NICK   = "TG нікнейм клієнта";
var TG_HDR_JOINED = "Дата приєднання";
// Числовий Telegram-id клієнта. Нік людина може змінити будь-коли, id — ні:
// саме він звʼязує номер телефону з чатом у нашій системі.
var TG_HDR_TGID   = "TG ID клієнта";

var TG_BTN_LABEL      = "📨 Надіслати";
var TG_BTN_LABEL_SENT = "🔁 Посилання";

var TG_STATUS_SENT   = "✅ Надіслано";
// Проміжний стан: клієнт відкрив бота (ми вже знаємо його нік та id), але на
// канал ще не підписався. Без цього стану найцінніший крок клієнта — те, що
// він взагалі відгукнувся, — був би не видно в таблиці.
var TG_STATUS_BOT    = "💬 У боті";
var TG_STATUS_JOINED = "👤 Приєднався";
var TG_STATUS_LIST   = [TG_STATUS_SENT, TG_STATUS_BOT, TG_STATUS_JOINED,
                        "🚫 Не потрібно", "❌ Відмовився"];

// Одне натискання кнопки відкривало головну таблицю пʼять разів.
// Кеш живе рівно один запуск скрипта, тож дані завжди свіжі.
var TG_SS_CACHE_  = {};
var TG_MGR_CACHE_ = null;

// PropertiesService.getProperty() — окремий виклик служби щоразу, а на
// шляху кліку їх було зо пʼять. Читаємо всі властивості один раз.
var TG_PROPS_CACHE_ = null;
function tgProp_(key) {
  if (!TG_PROPS_CACHE_) {
    try { TG_PROPS_CACHE_ = PropertiesService.getScriptProperties().getProperties() || {}; }
    catch (err) { TG_PROPS_CACHE_ = {}; }
  }
  var v = TG_PROPS_CACHE_[key];
  return v === undefined || v === null ? "" : String(v).trim();
}
function tgSetProp_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, value);
  if (TG_PROPS_CACHE_) TG_PROPS_CACHE_[key] = value;
}

function tgSS_(fileId) {
  if (!TG_SS_CACHE_[fileId]) TG_SS_CACHE_[fileId] = SpreadsheetApp.openById(fileId);
  return TG_SS_CACHE_[fileId];
}
function tgMainSheetCached_() {
  return tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
}

// ID «1C-4741» → клієнт із бази 1С, «LTEX-…» → лід.
// Обидва листи мають однаковий набір колонок, тож далі код спільний.
// Перевірки typeof — щоб усе працювало і без файлу Telegram1C.gs.
function tgIs1C_(id) {
  return typeof TG1C_PREFIX === "string" && tgStr_(id).indexOf(TG1C_PREFIX) === 0;
}
function tg1CSheetName_() {
  return typeof TG1C_SHEET === "string" ? TG1C_SHEET : "";
}
function tgSheetForId_(id) {
  if (tgIs1C_(id)) {
    var sh = tgSS_(MAIN_FILE_ID).getSheetByName(tg1CSheetName_());
    if (sh) return sh;
  }
  return tgMainSheetCached_();
}
function tgMgrSheetForId_(fileId, id) {
  var ss = tgSS_(fileId);
  return tgIs1C_(id) ? ss.getSheetByName(tg1CSheetName_()) : ss.getSheets()[0];
}
function tgManagers_() {
  if (!TG_MGR_CACHE_) TG_MGR_CACHE_ = getManagers();
  return TG_MGR_CACHE_;
}

// Обмеження часу виконання Apps Script — 6 хвилин. Установка йде
// кроками з бюджетом 4 хв: що не встигли — доробить наступний запуск.
var TG_SETUP_ROWS  = 5000;          // рядків нижче заголовка оформлюємо
var TG_TIME_BUDGET = 4 * 60 * 1000; // 4 хвилини на один запуск

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
  "Вітаю! Це {manager}, компанія L-TEX 👋\n\n" +
  "👕 L-TEX — оптовий постачальник секонд-хенду та стоку з Європи\n\n" +
  "У нашому Telegram-каналі щодня:\n" +
  "📦 Нові надходження та огляди новинок\n" +
  "💰 Актуальні ціни на секонд-хенд і сток\n" +
  "🔥 Акції та спеціальні пропозиції\n" +
  "🚚 Графік доставок нашим транспортом\n" +
  "📸 Живі фото та відео лотів\n\n" +
  "🚛 Доставка по всій Україні\n" +
  "⚖️ Мінімальне замовлення — від 10 кг\n" +
  "👨‍💼 Підтримка менеджера в Telegram\n\n" +
  "📲 Приєднуйтесь — і дізнавайтесь про все першими:\n" +
  "{link}\n\n" +
  "Якщо щось буде незрозуміло — пишіть, підкажу. 🙌";


// ╔══════════════════════════════════════════════════════════╗
// ║  1. ВСТАНОВЛЕННЯ (запустити ОДИН РАЗ з редактора)        ║
// ╚══════════════════════════════════════════════════════════╝
// Безпечно запускати повторно: нічого не дублює і не затирає.
// Запускати ще раз треба після додавання НОВОГО менеджера.
function installTgColumns() {
  var report = [];
  var steps  = [];
  function add(key, title, fn) { steps.push({key: key, title: title, fn: fn}); }

  add("sheets", "Аркуші «" + TG_LINKS_SHEET + "», «" + TG_LOG_SHEET + "» і довідник статусів", function () {
    ensureTgLinksSheet_();
    ensureTgLogSheet_();
    ensureTgStatusDictionary_();
  });
  add("main.hdr", "Головна «" + MAIN_SHEET + "»: колонки T–Z", function () {
    tgSetupHeaders_(tgMainSheet_(), tgMainCols_());
  });
  add("main.fmt", "Головна: списки й підсвітка", function () {
    tgSetupFormat_(tgMainSheet_(), tgMainCols_());
  });

  var managers = tgManagers_();
  var names    = Object.keys(managers);
  for (var i = 0; i < names.length; i++) {
    var fileId = managers[names[i]].fileId;
    if (!fileId) { report.push("ℹ️ " + names[i] + ": немає файлу — пропущено"); continue; }
    add("mgr." + names[i], names[i] + ": колонки S–Y", tgSetupMgrStep_(fileId));
  }

  add("btn.main", "Кнопки в головній", function () {
    var n = tgButtonsForSheet_(tgMainSheet_(), DATA_START, COL.ID, TG_MAIN_BTN, TG_MAIN_STATUS, true);
    report.push("   проставлено кнопок: " + n);
  });
  for (var j = 0; j < names.length; j++) {
    var fid = managers[names[j]].fileId;
    if (!fid) continue;
    add("btn." + names[j], "Кнопки: " + names[j], tgButtonsMgrStep_(fid));
  }

  var res = tgRunSteps_("TG_INSTALL_DONE", steps, report);
  Logger.log(report.join("\n"));
  if (res.left > 0) {
    Logger.log("\n⏳ Не встигли за один запуск (ліміт Apps Script — 6 хв).\n" +
               "   Запустіть installTgColumns() ЩЕ РАЗ — продовжить з місця зупинки.\n" +
               "   Лишилось кроків: " + res.left + " із " + res.total);
  } else {
    Logger.log("\n🎉 Колонки й кнопки готові (" + res.total + " кроків).\n" +
               "   Далі: 1) бот і Script Properties  2) Deploy → New version\n" +
               "         3) setTelegramWebhook()  4) setupTgTrigger()  5) testTgSetup()");
  }
  return report.join("\n");
}

// Виконує список кроків із бюджетом часу і памʼяттю про зроблене.
// Повторний запуск продовжує з місця зупинки — так обходимо ліміт 6 хвилин.
function tgRunSteps_(progressKey, steps, report) {
  var t0    = Date.now();
  var props = PropertiesService.getScriptProperties();
  var done  = {};
  try { done = JSON.parse(props.getProperty(progressKey) || "{}"); } catch (err) { done = {}; }

  var left = 0;
  for (var i = 0; i < steps.length; i++) {
    var st = steps[i];
    if (done[st.key]) continue;
    if (Date.now() - t0 > TG_TIME_BUDGET) { left++; continue; }
    var s0 = Date.now();
    try {
      // Крок може повернути false — «зроблено частину, треба ще раз».
      // Тоді не позначаємо його виконаним, інакше залишок ніколи не доїде.
      var ok = st.fn();
      var sec = ((Date.now() - s0) / 1000).toFixed(1);
      if (ok === false) {
        left++;
        report.push("⏳ " + st.title + " — частково  (" + sec + " с)");
      } else {
        done[st.key] = true;
        props.setProperty(progressKey, JSON.stringify(done));
        report.push("✅ " + st.title + "  (" + sec + " с)");
      }
    } catch (err) {
      report.push("❌ " + st.title + ": " + err);
    }
  }
  return {left: left, total: steps.length};
}

function tgMainSheet_() {
  var sh = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!sh) throw new Error("аркуш «" + MAIN_SHEET + "» не знайдено");
  return sh;
}

// Замикання для кроків по менеджерах (щоб не ловити класичну пастку з var у циклі)
function tgSetupMgrStep_(fileId) {
  return function () { tgSetupSheet_(tgSS_(fileId).getSheets()[0], tgMgrCols_()); };
}
function tgButtonsMgrStep_(fileId) {
  return function () {
    var sh = tgSS_(fileId).getSheets()[0];
    tgButtonsForSheet_(sh, TG_MGR_DATA_START, 1, TG_MGR_BTN, TG_MGR_STATUS, true);
  };
}

// Проставити кнопки в одному аркуші
function tgButtonsForSheet_(sheet, startRow, idCol, btnCol, statusCol, force) {
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return 0;
  var ids = sheet.getRange(startRow, idCol, lastRow - startRow + 1, 1).getValues();
  return tgFillButtons_(sheet, startRow, ids, btnCol, statusCol, force);
}

// ── Оновлення після появи колонки «TG ID клієнта» ─────────────────────────
// installTgColumns() памʼятає зроблені кроки й НЕ переробить заголовки
// вдруге — тому для однієї нової колонки є окремий короткий запуск. Він
// нічого не ламає: додає колонку, якщо її ще немає, оновлює заголовки й
// випадний список статусів (у ньому зʼявився «💬 У боті»).
//
// Запускати РАЗ, після оновлення коду.
function upgradeTgColumns() {
  var report = ["🔧 Додаємо колонку «" + TG_HDR_TGID + "»"];
  try {
    ensureTgStatusDictionary_();
    var main = tgMainSheet_();
    if (main) {
      tgSetupHeaders_(main, tgMainCols_());
      tgSetupFormat_(main, tgMainCols_());
      report.push("✅ головна «" + MAIN_SHEET + "»");
    }
    var one = (typeof tg1CSheetName_ === "function") ? tg1CSheetName_() : "";
    if (one) {
      var sh1 = tgSS_(MAIN_FILE_ID).getSheetByName(one);
      if (sh1) { tgSetupSheet_(sh1, tgMainCols_()); report.push("✅ аркуш «" + one + "»"); }
    }
  } catch (err) { report.push("⚠️ головна таблиця: " + err); }

  var managers = tgManagers_();
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) continue;
    try {
      var ss = tgSS_(fileId);
      var sheets = ss.getSheets();
      for (var i = 0; i < sheets.length; i++) tgSetupSheet_(sheets[i], tgMgrCols_());
      report.push("✅ " + name);
    } catch (err) { report.push("⚠️ " + name + ": " + err); }
  }
  report.push("", "Готово. Дані в наявних рядках не чіпались — додано лише порожню колонку.");
  Logger.log(report.join("\n"));
}


// ── Місток з нашою системою: налаштування й перевірка ─────────────────────
// Разове ввімкнення. `secret` — те саме значення, що в нашій системі лежить
// у LEADS_TG_LINK_SECRET (а якщо її немає — у LEADS_IMPORT_SECRET).
//
// Приклад запуску з редактора:
//   setupEcoBridge("сюди-значення-секрета")
function setupEcoBridge(secret) {
  var s = (secret || "").toString().trim();
  if (s.length < 16) {
    Logger.log("❌ Потрібен секрет щонайменше на 16 символів — те саме значення, " +
               "що в нашій системі (LEADS_TG_LINK_SECRET або LEADS_IMPORT_SECRET).");
    return;
  }
  tgSetProp_("TG_LINK_SECRET", s);
  tgSetProp_("TG_CLIENT_LINK", "eco");
  Logger.log("✅ Місток увімкнено. Далі — tgEcoCheck() для перевірки.");
  tgEcoCheck();
}

// Що ще лишилось зробити руками. Пише простою мовою, без здогадок.
function tgEcoCheck() {
  var L = ["🔗 МІСТОК З НАШОЮ СИСТЕМОЮ", ""];
  var secret = tgLinkSecret_();
  L.push(secret ? "✅ Секрет підпису заданий" :
    "❌ Немає секрета. Запустіть setupEcoBridge(\"значення\") — те саме значення, " +
    "що в нашій системі (LEADS_TG_LINK_SECRET або LEADS_IMPORT_SECRET).");

  var mode = tgClientLinkMode_();
  L.push(mode === "eco" ? "✅ Кнопка веде на бота системи"
                        : "ℹ️ Режим посилання: " + mode + " (щоб змінити — TG_CLIENT_LINK = eco)");

  L.push("ℹ️ Бот системи: @" + tgEcoBotUsername_() +
         " (змінюється властивістю TG_ECO_BOT)");

  var sample = tgEcoDeepLink_("LTEX-20260101-0001");
  L.push(sample ? "✅ Приклад посилання: " + sample : "❌ Посилання не будується — див. вище");

  var url = "";
  try { url = ScriptApp.getService().getUrl(); } catch (err) { url = ""; }
  L.push("", "Що має бути в НАШІЙ системі (.env):");
  L.push("   LEADS_SHEETS_WEBHOOK_URL = " + (url || "<адреса цього веб-застосунку>"));
  L.push("   LEADS_TG_LINK_SECRET     = той самий секрет");
  L.push("   TELEGRAM_CHANNEL_USERNAME = нік каналу (напр. L_TEX)");
  L.push("", "І в Telegram:");
  L.push("   · бот @" + tgEcoBotUsername_() + " — АДМІН каналу (інакше про підписку ми не дізнаємось);");
  L.push("   · вебхук перереєстрований скриптом register-telegram-webhook.ts");
  L.push("     (він просить подію chat_member явно — без неї підписки не доїжджають).");

  if (tgProp_("TG_BOT_TOKEN") && tgProp_("TG_UPDATE_MODE") === "poll") {
    L.push("", "⚠️ Цей скрипт досі опитує свого бота (TG_UPDATE_MODE = poll).");
    L.push("   Якщо це ТОЙ САМИЙ бот, що й у системі, — опитування треба вимкнути:");
    L.push("   вебхук і опитування на одному боті не працюють разом.");
  }
  Logger.log(L.join("\n"));
}


// Почати встановлення спочатку (напр. після додавання нового менеджера
// зайве — installTgColumns() і так пропускає зроблене; потрібно лише
// якщо треба переоформити все наново)
function resetTgInstall() {
  PropertiesService.getScriptProperties().deleteProperty("TG_INSTALL_DONE");
  Logger.log("Позначки прогресу скинуто — наступний installTgColumns() зробить усе наново");
}

// Набори колонок головної таблиці та файлу менеджера
function tgMainCols_() {
  return {btn: TG_MAIN_BTN, status: TG_MAIN_STATUS, date: TG_MAIN_DATE,
          link: TG_MAIN_LINK, nick: TG_MAIN_NICK, joined: TG_MAIN_JOINED,
          tgid: TG_MAIN_TGID, last: TG_MAIN_LAST};
}
function tgMgrCols_() {
  return {btn: TG_MGR_BTN, status: TG_MGR_STATUS, date: TG_MGR_DATE,
          link: TG_MGR_LINK, nick: TG_MGR_NICK, joined: TG_MGR_JOINED,
          tgid: TG_MGR_TGID, last: TG_MGR_LAST};
}

// «Лід: LTEX-…» / «1С: 4741» у колонці дублів → ID другого рядка клієнта
function tgTwinFromDups_(v) {
  var s = tgStr_(v);
  if (!s) return "";
  var lead = /(LTEX-\d{8}-\d{4})/.exec(s);
  if (lead) return lead[1];
  var ons = /1С:\s*([A-Za-z0-9\-_]+)/i.exec(s);
  if (ons && typeof TG1C_PREFIX === "string") return TG1C_PREFIX + ons[1];
  return "";
}

// Скільки рядків нижче заголовка оформлюємо. На великих аркушах
// оформлення «до кінця сітки» (getMaxRows) з\'їдає ліміт у 6 хвилин,
// тому беремо дані + запас на зростання.
function tgFormatRows_(sheet, hdrRow) {
  var need = Math.max(TG_SETUP_ROWS, sheet.getLastRow() - hdrRow + 500);
  return Math.max(Math.min(sheet.getMaxRows() - hdrRow, need), 0);
}

// Крок 1 (швидкий і найважливіший): сітка, заголовки, ширина колонок
function tgSetupHeaders_(sheet, cols) {
  var hdrRow = tgHeaderRow_(sheet);

  if (sheet.getMaxColumns() < cols.last) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), cols.last - sheet.getMaxColumns());
  }

  // Заголовки — у стилі сусідньої колонки
  var sample = sheet.getRange(hdrRow, Math.max(1, cols.btn - 1));
  var bg = sample.getBackground(), fc = sample.getFontColor();
  sheet.getRange(hdrRow, cols.btn, 1, 7)
       .setValues([[TG_HDR_BTN, TG_HDR_STATUS, TG_HDR_DATE, TG_HDR_LINK,
                    TG_HDR_NICK, TG_HDR_JOINED, TG_HDR_TGID]])
       .setFontWeight("bold").setBackground(bg).setFontColor(fc)
       .setWrap(true).setVerticalAlignment("middle");

  sheet.setColumnWidth(cols.btn,    120);
  sheet.setColumnWidth(cols.status, 160);
  sheet.setColumnWidth(cols.date,   140);
  sheet.setColumnWidth(cols.link,   230);
  sheet.setColumnWidth(cols.nick,   170);
  sheet.setColumnWidth(cols.joined, 140);
  sheet.setColumnWidth(cols.tgid,   130);
  return hdrRow;
}

// Крок 2 (важчий): випадний список, підсвітка, вирівнювання
function tgSetupFormat_(sheet, cols) {
  var hdrRow = tgHeaderRow_(sheet);
  var nRows  = tgFormatRows_(sheet, hdrRow);
  if (nRows > 0) {
    sheet.getRange(hdrRow + 1, cols.btn,    nRows, 1).setHorizontalAlignment("center");
    sheet.getRange(hdrRow + 1, cols.status, nRows, 1).setDataValidation(tgStatusRule_());
    sheet.getRange(hdrRow + 1, cols.link,   nRows, 1).setFontSize(9).setWrap(false);
    sheet.getRange(hdrRow + 1, cols.nick,   nRows, 1).setFontWeight("bold");
  }
  tgConditionalFormat_(sheet, cols, hdrRow);

  // Якщо зверху є обʼєднана «шапка» — розтягуємо на нові колонки
  if (typeof extendTitleMerges_ === "function") {
    try { extendTitleMerges_(sheet, cols.last, hdrRow); } catch (err) { Logger.log("tgSetupSheet_ merge: " + err); }
  }
}

// Обидва кроки разом (для файлів менеджерів — вони невеликі)
function tgSetupSheet_(sheet, cols) {
  tgSetupHeaders_(sheet, cols);
  tgSetupFormat_(sheet, cols);
}

// Зелений — надіслано, жовтий — рядок з клієнтом, але посилання ще не надіслане
function tgConditionalFormat_(sheet, cols, hdrRow) {
  try {
    var firstRow = hdrRow + 1;
    var nRows = Math.max(tgFormatRows_(sheet, hdrRow), 1);
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
      .whenTextStartsWith("💬").setBackground("#fff2cc").setFontColor("#7f6000")
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

function tgRefreshJob() {
  // Один бюджет на весь запуск, а не по чотири хвилини кожному: інакше
  // два етапи разом вилітають за шестихвилинну межу Apps Script, і другий
  // обривається посеред роботи.
  var t0 = Date.now();
  tgRefreshAll_(false);
  try { if (typeof tgSyncJoins === "function") tgSyncJoins(0, t0); }
  catch (err) { Logger.log("tgSyncJoins: " + err); }
}
function refreshTgButtons()   { return tgRefreshAll_(false); }   // тільки нові рядки
function refreshTgButtonsForce() { return tgRefreshAll_(true); } // перезаписати ВСІ кнопки

function tgRefreshAll_(force) {
  var t0   = Date.now();
  var main = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!main) { Logger.log("TG: аркуш " + MAIN_SHEET + " не знайдено"); return 0; }
  var lastRow = main.getLastRow();
  if (lastRow < DATA_START) return 0;
  if (main.getMaxColumns() < TG_MAIN_LINK) { Logger.log("TG: спочатку запустіть installTgColumns()"); return 0; }

  var n       = lastRow - DATA_START + 1;
  var ids     = main.getRange(DATA_START, COL.ID,      n, 1).getValues();
  var mgrCol  = main.getRange(DATA_START, COL.MANAGER, n, 1).getValues();
  var changed = tgFillButtons_(main, DATA_START, ids, TG_MAIN_BTN, TG_MAIN_STATUS, force);

  // Мапа ID → статус у головній (для звірки з менеджерами)
  var tg = main.getRange(DATA_START, TG_MAIN_STATUS, n, TG_BLOCK).getValues();
  var byId = {};
  for (var i = 0; i < n; i++) {
    var id = ids[i][0] ? ids[i][0].toString().trim() : "";
    if (!id) continue;
    byId[id] = {
      i: i, row: DATA_START + i,
      manager: mgrCol[i][0] ? mgrCol[i][0].toString().trim() : "",
      vals:    tg[i].map(function (v) { return v === null || v === undefined ? "" : v.toString().trim(); })
    };
    byId[id].status = byId[id].vals[0];
  }

  var managers = tgManagers_(), up = 0, down = 0, skipped = 0;
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) continue;
    // Ліміт Apps Script — 6 хв. Що не встигли, доробить наступний запуск тригера.
    if (Date.now() - t0 > TG_TIME_BUDGET) { skipped++; continue; }
    try {
      var sh = tgSS_(fileId).getSheets()[0];
      var ml = sh.getLastRow();
      if (ml < TG_MGR_DATA_START) continue;
      if (sh.getMaxColumns() < TG_MGR_LINK) { Logger.log("TG: " + name + " — немає колонок, запустіть installTgColumns()"); continue; }

      var mn    = ml - TG_MGR_DATA_START + 1;
      var mIds  = sh.getRange(TG_MGR_DATA_START, 1, mn, 1).getValues();
      changed  += tgFillButtons_(sh, TG_MGR_DATA_START, mIds, TG_MGR_BTN, TG_MGR_STATUS, force);

      var mTg = sh.getRange(TG_MGR_DATA_START, TG_MGR_STATUS, mn, TG_BLOCK).getValues();
      for (var j = 0; j < mn; j++) {
        var mid = mIds[j][0] ? mIds[j][0].toString().trim() : "";
        if (!mid) continue;
        var rec = byId[mid];
        if (!rec) continue;
        var ms = mTg[j][0] ? mTg[j][0].toString().trim() : "";
        var rMain = tgRank_(rec.status), rMgr = tgRank_(ms);

        if (rMgr > rMain) {
          // менеджер просунув статус далі (напр. «👤 Приєднався») → піднімаємо в головну
          for (var v = 0; v < TG_BLOCK; v++) {
            var mv = mTg[j][v] === null || mTg[j][v] === undefined ? "" : mTg[j][v].toString().trim();
            if (v === 0 || mv) rec.vals[v] = mv;   // порожнім не затираємо те, що вже є
          }
          rec.status = rec.vals[0];
          main.getRange(rec.row, TG_MAIN_STATUS, 1, TG_BLOCK).setValues([rec.vals]);
          try {
            main.getRange(rec.row, TG_MAIN_STATUS).setNote(
              "Джерело: підтягнуто з файлу менеджера (" + name + ")\nКоли: " +
              Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm"));
          } catch (e2) { Logger.log("refresh note: " + e2); }
          up++;
        } else if (rMain > rMgr) {
          // у менеджера статус «молодший» (найчастіше порожній) → опускаємо з головної
          sh.getRange(TG_MGR_DATA_START + j, TG_MGR_STATUS, 1, TG_BLOCK).setValues([rec.vals]);
          down++;
        }
        // однаковий «вік» статусу (напр. «🚫 Не потрібно» vs «❌ Відмовився») —
        // не чіпаємо жодну зі сторін, щоб не затерти ручну правку
      }
    } catch (err) { Logger.log("tgRefreshAll_ (" + name + "): " + err); }
  }

  Logger.log("TG refresh: кнопок " + changed + ", статусів вгору " + up + ", вниз " + down +
             (skipped ? ", відкладено файлів: " + skipped + " (бюджет часу)" : ""));
  return changed;
}

// Проставляє кнопку там, де її немає (або всюди, якщо force).
//
// Кнопка — це НЕ формула, а текст із посиланням (rich text). Формула
// =HYPERLINK(...) залежить від мови таблиці: в українській локалі
// роздільник аргументів «;», а не «,», і формула з комами дає #ERROR!.
// Текст із посиланням працює однаково в будь-якій локалі, не
// перераховується і не ламається.
function tgFillButtons_(sheet, startRow, ids, btnCol, statusCol, force) {
  var n = ids.length;
  if (!n || sheet.getMaxColumns() < btnCol) return 0;
  var rng   = sheet.getRange(startRow, btnCol, n, 1);
  var cur   = rng.getRichTextValues();
  var sts   = sheet.getRange(startRow, statusCol, n, 1).getValues();
  var empty = SpreadsheetApp.newRichTextValue().setText("").build();
  var out = [], changed = 0;

  for (var i = 0; i < n; i++) {
    var id  = ids[i][0] ? ids[i][0].toString().trim() : "";
    var rt  = cur[i][0] || empty;
    var url = rt.getLinkUrl ? rt.getLinkUrl() : null;
    var txt = rt.getText ? rt.getText() : "";

    if (!id) {
      // Рядок без ID: прибираємо лише нашу кнопку, чуже не чіпаємо
      var ours = (url && url.indexOf("a=tg") >= 0) || txt === TG_BTN_LABEL || txt === TG_BTN_LABEL_SENT;
      if (ours) { out.push([empty]); changed++; } else { out.push([rt]); }
      continue;
    }

    var want = tgButtonUrl_(id, startRow + i);
    var lbl  = tgIsSent_(sts[i][0]) ? TG_BTN_LABEL_SENT : TG_BTN_LABEL;
    if (force || url !== want || txt !== lbl) {
      out.push([SpreadsheetApp.newRichTextValue().setText(lbl).setLinkUrl(want).build()]);
      changed++;
    } else {
      out.push([rt]);
    }
  }

  if (changed) {
    // clearContent прибирає старі формули =HYPERLINK, які лишились від
    // попередніх версій; далі пишемо всі клітинки діапазону разом
    rng.clearContent();
    rng.setRichTextValues(out);
  }
  return changed;
}

// Адреса, на яку веде кнопка рядка. Номер рядка (&r=) — підказка, щоб
// не перечитувати всю колонку ID; він перевіряється при відкритті, тож
// зсув рядків нічого не ламає.
function tgButtonUrl_(id, row) {
  var q = "id=" + encodeURIComponent(id) + "&t=" + tgToken_(id) + (row ? "&r=" + row : "");
  // Якщо задано TG_PAGE_URL — кнопка веде на статичну сторінку (вона
  // відкривається миттєво і сама забирає дані). Інакше — як раніше,
  // сторінку малює Apps Script.
  var page = tgProp_("TG_PAGE_URL");
  return page ? (page + (page.indexOf("?") >= 0 ? "&" : "?") + q)
              : (getTgTrackUrl_() + "?a=tg&" + q);
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

    // doGet у Code.gs пропускає сюди лише a=tg, тому і пінг, і дані для
    // статичної сторінки їдуть тим самим a=tg — з окремим прапорцем.
    // Старі назви (a=ping, a=tgjson) теж приймаємо.

    // Пінг для підігріву контейнера — відповідаємо ДО будь-яких таблиць
    if (p.ping === "1" || p.a === "ping") return ContentService.createTextOutput("pong");

    // Подія від бота нашої системи: «клієнт відкрив бота» / «підписався на
    // канал». Приходить БЕЗ ?t= (його знає лише кнопка в таблиці) — замість
    // нього підпис спільним секретом, див. tgEcoEvent_.
    if (p.act === "start" || p.act === "join") return tgEcoEvent_(p);

    // Дані для статичної сторінки на GitHub Pages
    if (p.fmt === "json" || p.a === "tgjson") return handleTgJson_(p);

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

    var r = markTgSent_(id, "кнопка в таблиці", p.r);
    if (!r.ok) return tgPage_(tgErrorBody_(r.error, ""));
    return tgPage_(tgLandingBody_(r));

  } catch (err) {
    Logger.log("handleTgClick: " + err);
    return tgPage_(tgErrorBody_("Помилка: " + err, ""));
  }
}


// ── Дані для статичної сторінки ────────────────────────────
// Сторінка на GitHub Pages відкривається миттєво (звичайний файл на
// CDN, без холодного старту Apps Script) і вже потім забирає дані
// звідси. Той самий підпис ?t=, той самий запис статусу.
function handleTgJson_(p) {
  var out;
  try {
    var id = tgStr_(p.id);
    if (!id) {
      out = {ok: false, error: "Не передано ID клієнта."};
    } else if (tgStr_(p.t) !== tgToken_(id)) {
      out = {ok: false, error: "Посилання застаріле або пошкоджене. Запустіть refreshTgButtonsForce()."};
    } else if (p.fin === "1") {
      out = {ok: true, fin: tgFinishFromPage_(id, p.r, p.lr, p.stamp)};
    } else if (p.undo === "1") {
      var u = tgUndo_(id);
      out = u.ok ? {ok: true, undo: true, name: u.name, id: u.id} : {ok: false, error: u.error};
    } else if (p.noapp) {
      out = {ok: true, marked: tgMarkNoMessenger(id, p.t, p.noapp)};
    } else {
      var r = markTgSent_(id, "кнопка в таблиці", p.r);
      out = r.ok ? tgJsonPayload_(r) : {ok: false, error: r.error};
    }
  } catch (err) {
    Logger.log("handleTgJson_: " + err);
    out = {ok: false, error: String(err)};
  }
  var body = JSON.stringify(out);

  // JSONP — запасний шлях. Якщо браузер із якоїсь причини не пускає
  // звичайний запит зі статичної сторінки, вона просить відповідь
  // тегом <script>; так дані доходять завжди.
  var cb = tgStr_(p.callback);
  if (cb && /^[A-Za-z0-9_$]{1,40}$/.test(cb)) {
    return ContentService.createTextOutput(cb + "(" + body + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(body)
    .setMimeType(ContentService.MimeType.JSON);
}

function tgJsonPayload_(r) {
  return {
    ok: true, id: r.id, name: r.name, phone: r.phone, intl: tgIntlPhone_(r.phone),
    region: r.region, city: r.city, manager: r.manager, interest: r.interest,
    link: r.link, personal: !!r.personal, noLink: !!r.noLink, viaBot: !!r.viaBot,
    viaEco: !!r.viaEco, publicChannel: !!r.publicChannel,
    linkWhy: r.linkWhy || "", notSent: !!r.notSent,
    repeat: !!r.repeat, sentAt: r.sentAt, nick: r.nick || "", joinedAt: r.joinedAt || "",
    absent: tgNoAppsFrom_(r.comment), msg: tgMessageText_(r), ms: r.ms || "",
    row: r.deferred ? r.deferred.row : 0,
    linkRow: r.deferred ? r.deferred.linkRow : 0,
    stamp: r.deferred ? r.deferred.stamp : ""
  };
}

// ── Події від бота нашої системи (ltex-ecosystem) ──────────────────────────
// Клієнт відкрив бота за посиланням з таблиці → act=start (нік + Telegram-id).
// Клієнт підписався на канал → act=join (дата приєднання).
//
// Чому це взагалі можливо у ПУБЛІЧНОМУ каналі. Запрошення там не відповідає
// на питання «хто підписався»: Telegram відкриває канал напряму й події
// приходять без запрошення. Але Telegram-id людини ми знаємо ще ДО підписки —
// вона приходить у бота за міткою з таблиці. Далі бот ловить подію про вступ
// і звіряє id. Саме тому крок «через бота» тут не зайвий, а єдиний робочий.
//
// Підпис обовʼязковий: адреса скрипта відкрита інтернету, і без нього
// будь-хто ставив би чужим рядкам «Приєднався».
function tgEcoEvent_(p) {
  var out;
  try {
    var act    = tgStr_(p.act);
    var id     = tgStr_(p.id);
    var tgId   = tgStr_(p.tg);
    var secret = tgLinkSecret_();
    if (!secret) {
      out = {ok: false, error: "не задано TG_LINK_SECRET"};
    } else if (!id || !tgId) {
      out = {ok: false, error: "потрібні id і tg"};
    } else if (tgStr_(p.sig) !== tgHmac12_("crm-lead-event", act + "|" + id + "|" + tgId, secret)) {
      out = {ok: false, error: "підпис не збігається"};
    } else {
      out = {ok: true, applied: tgApplyEcoEvent_(act, id, tgId, tgStr_(p.nick), tgStr_(p.name))};
    }
  } catch (err) {
    Logger.log("tgEcoEvent_: " + err);
    out = {ok: false, error: String(err)};
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

// Записує подію в рядок клієнта. Повертає коротке слово про те, що зробили —
// його видно і в логах нашої системи, і в ручному виклику з редактора.
//
// Правила навмисно консервативні:
//   · ручний вибір менеджера («🚫 Не потрібно», «❌ Відмовився») не чіпаємо —
//     це його рішення про рядок, а не факт про канал;
//   · дату приєднання не переписуємо: перша підписка лишається першою;
//   · дату надсилання не вигадуємо — інакше в рядку зʼявиться «надіслано»
//     там, де менеджер кнопку не тиснув;
//   · нік та id пишемо завжди: це нова інформація незалежно від статусу.
function tgApplyEcoEvent_(act, id, tgId, nick, fullName) {
  var sheet = tgSheetForId_(id);
  if (!sheet) return "no-sheet";
  var row = tgFindRow_(sheet, COL.ID, DATA_START, id);
  if (row === -1) return "not-found";

  var d     = sheet.getRange(row, 1, 1, TG_MAIN_LAST).getValues()[0];
  var cur   = tgStr_(d[TG_MAIN_STATUS - 1]);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
  var label = nick ? "@" + nick.replace(/^@/, "") : (fullName || "");

  var next = cur;
  if (tgStatusIsOurs_(cur)) {
    if (act === "join") next = TG_STATUS_JOINED;
    else if (cur !== TG_STATUS_JOINED) next = TG_STATUS_BOT;
  }

  var vals = [next,
              d[TG_MAIN_DATE - 1],
              tgStr_(d[TG_MAIN_LINK - 1]),
              label || tgStr_(d[TG_MAIN_NICK - 1]),
              act === "join" ? (d[TG_MAIN_JOINED - 1] || stamp) : d[TG_MAIN_JOINED - 1],
              tgId];
  sheet.getRange(row, TG_MAIN_STATUS, 1, TG_BLOCK).setValues([vals]);

  try {
    sheet.getRange(row, TG_MAIN_NICK).setNote(
      "Telegram id: " + tgId +
      (fullName ? "\nІмʼя в Telegram: " + fullName : "") +
      "\n" + (act === "join" ? "Підписався на канал: " : "Відкрив бота: ") + stamp);
  } catch (err) { Logger.log("tgApplyEcoEvent_ note: " + err); }

  // Нік дублюємо в «рідну» колонку Telegram, якщо вона ще порожня — звіти й
  // обдзвін дивляться саме туди.
  try {
    if (label && !tgStr_(d[COL.TG - 1])) sheet.getRange(row, COL.TG).setValue(label);
  } catch (err) { Logger.log("tgApplyEcoEvent_ TG: " + err); }

  var manager = tgStr_(d[COL.MANAGER - 1]);
  tgSyncToManager_(manager, id, vals);
  var twin = tgTwinFromDups_(tgStr_(d[COL.DUPS - 1]));
  if (twin && typeof tg1CMirrorTwin_ === "function") tg1CMirrorTwin_(twin, vals);

  tgLogAppend_([new Date(), id, tgStr_(d[COL.NAME - 1]), tgStr_(d[COL.PHONE - 1]),
                tgStr_(d[COL.REGION - 1]), manager, tgStr_(d[TG_MAIN_LINK - 1]),
                "бот системи",
                (act === "join" ? "приєднався: " : "відкрив бота: ") + (label || tgId)]);

  return next === cur ? "noted" : "status:" + next;
}


// Друга частина роботи — коли сторінка вже перед очима менеджера
function tgFinishFromPage_(id, hintRow, linkRow, stamp) {
  try {
    var sheet = tgSheetForId_(id);
    var row   = tgFindRow_(sheet, COL.ID, DATA_START, id, hintRow);
    if (row === -1) return "not-found";

    var d    = sheet.getRange(row, 1, 1, TG_MAIN_LAST).getValues()[0];
    var vals = [tgStr_(d[TG_MAIN_STATUS - 1]), tgStr_(d[TG_MAIN_DATE - 1]),
                tgStr_(d[TG_MAIN_LINK - 1]),   tgStr_(d[TG_MAIN_NICK - 1]),
                tgStr_(d[TG_MAIN_JOINED - 1]), tgStr_(d[TG_MAIN_TGID - 1])];
    var manager = tgStr_(d[COL.MANAGER - 1]);

    tgSyncToManager_(manager, id, vals);
    try {
      sheet.getRange(row, TG_MAIN_STATUS).setNote(
        "Надіслав: " + (manager || "—") + "\nДжерело: кнопка в таблиці\nОстаннє відкриття: " +
        (tgStr_(stamp) || vals[1]));
    } catch (err) { Logger.log("note: " + err); }

    var twin = tgTwinFromDups_(tgStr_(d[COL.DUPS - 1]));
    if (twin && typeof tg1CMirrorTwin_ === "function") tg1CMirrorTwin_(twin, vals);

    var lr = parseInt(linkRow, 10);
    if (lr > 0) tgBumpCounter_(lr, tgStr_(stamp));
    return "ok";
  } catch (err) {
    Logger.log("tgFinishFromPage_: " + err);
    return "error";
  }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  4. ЯДРО: проставляння статусу                           ║
// ╚══════════════════════════════════════════════════════════╝
// source: "кнопка в таблиці" | "бот Viber" | ...
// Без LockService: блокування скрипта ставить у чергу ВСІ кліки всіх
// менеджерів, а всередині ще й чекає відповіді Telegram. Різні рядки
// одне одному не заважають, а два кліки по одному рядку максимум
// перезапишуть однакові значення.
function markTgSent_(id, source, hintRow) {
  var t0 = Date.now(), T = [];
  function lap(k) { T.push(k + "=" + (Date.now() - t0)); }
  try {
    var main = tgSheetForId_(id);
    lap("відкриття");
    if (!main) return {ok: false, error: "Аркуш для " + id + " не знайдено."};
    var row = tgFindRow_(main, COL.ID, DATA_START, id, hintRow);
    if (row === -1) return {ok: false, error: "Клієнта " + id + " не знайдено в таблиці."};

    var d = main.getRange(row, 1, 1, TG_MAIN_LAST).getValues()[0];
    lap("рядок");
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
    var prevDate   = tgDateStr_(d[TG_MAIN_DATE - 1]);
    var prevLink   = tgStr_(d[TG_MAIN_LINK - 1]);
    var repeat     = tgIsSent_(prevStatus);
    info.nick      = tgStr_(d[TG_MAIN_NICK - 1]);     // якщо клієнт уже приєднався
    info.joinedAt  = tgDateStr_(d[TG_MAIN_JOINED - 1]);
    info.comment   = tgStr_(d[COL.NEW_COMMENT - 1]);  // тут же позначки «немає в Viber»

    // Той самий клієнт може бути і лідом, і карткою 1С — тоді посилання
    // в них одне: беремо вже видане з будь-якого з двох рядків.
    // Значення колонки дублів уже прочитане разом із рядком — не читаємо вдруге
    info.twinId = (typeof tgTwinFromDups_ === "function")
      ? tgTwinFromDups_(tgStr_(d[COL.DUPS - 1])) : "";
    if (!prevLink && info.twinId && typeof tg1CTwinLink_ === "function") {
      prevLink = tg1CTwinLink_(info.twinId);
    }

    // Посилання: вже видане раніше → віддаємо те саме (клієнт має на руках саме його)
    var res = tgResolveLink_(info, prevLink);
    lap("посилання");
    info.link      = res.link;
    info.linkRow   = res.row;
    info.personal  = !!res.personal;
    info.viaBot    = !!res.viaBot;
    info.viaEco    = !!res.viaEco;
    info.publicChannel = !!res.publicChannel;
    info.noLink    = !res.link;
    info.repeat    = repeat;
    info.source    = source;

    var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
    info.sentAt = repeat && prevDate ? prevDate : stamp;

    if (info.noLink && !info.linkWhy) {
      info.linkWhy = "в аркуші «" + TG_LINKS_SHEET + "» немає посилання ні для області «" +
                     (info.region || "—") + "», ні в рядку «За замовчуванням»";
    }

    // Немає посилання — немає чого надсилати. Статус не ставимо: інакше у
    // звіті буде «надіслано» там, де менеджер нічого не надіслав.
    if (!info.link && !repeat) { info.notSent = true; info.ms = T.join(" "); return info; }

    // Дату й дату приєднання при повторі повертаємо В ТОМУ САМОМУ ВИГЛЯДІ,
    // як лежали в клітинці. Якщо там справжня дата, а часовий пояс таблиці
    // не збігається з поясом скрипта, прочитаний і записаний назад рядок
    // щоразу зсувався б на різницю поясів — і дата «тікала» б у майбутнє.
    var vals = [repeat ? prevStatus : TG_STATUS_SENT,
                repeat ? d[TG_MAIN_DATE - 1] : stamp,
                info.link || prevLink,
                d[TG_MAIN_NICK - 1], d[TG_MAIN_JOINED - 1], d[TG_MAIN_TGID - 1]];
    main.getRange(row, TG_MAIN_STATUS, 1, TG_BLOCK).setValues([vals]);
    lap("статус");
    var note = "Надіслав: " + (info.manager || "—") + "\nДжерело: " + source +
               "\nОстаннє відкриття: " + stamp;

    // Лог пишемо тут, а не в другій частині: другу частину виконує вже
    // браузер, і вона може не відбутись — менеджер тисне «Viber», сторінка
    // йде в месенджер і запит гине. Звіт мусить бачити всі надсилання.
    tgLogAppend_([new Date(), id, info.name, info.phone, info.region, info.manager,
                  info.link, source, repeat ? "повторно" : "вперше"]);
    lap("лог");

    // Решту — файл менеджера і лічильник — робить tgFinishClick() уже
    // після того, як менеджер побачив сторінку. Якщо браузер закриють
    // раніше, ці дані донесе плановий tgRefreshJob (кожні 15 хв).
    if (source === "кнопка в таблиці") {
      info.deferred = {managerVals: vals, linkRow: (!repeat && res.row) ? res.row : 0,
                       stamp: stamp, twinId: info.twinId, row: row, note: note};
    } else {
      try { main.getRange(row, TG_MAIN_STATUS).setNote(note); } catch (err) { Logger.log("note: " + err); }
      tgSyncToManager_(info.manager, id, vals);
      if (!repeat && res.row) tgBumpCounter_(res.row, stamp);
      if (info.twinId && typeof tg1CMirrorTwin_ === "function") tg1CMirrorTwin_(info.twinId, vals);
    }

    info.ms = T.join(" ");
    return info;
  } catch (err) {
    Logger.log("markTgSent_: " + err);
    return {ok: false, error: "Помилка запису: " + err};
  }
}

// Викликається зі сторінки одразу після її показу: дописує статус у файл
// менеджера і збільшує лічильник видач. Винесено з doGet, щоб сторінка
// відкривалась швидше — це найповільніші дві операції (окремий файл).
function tgFinishClick(id, token, managerVals, linkRow, stamp, twinId, hintRow, note) {
  try {
    if (!id || token !== tgToken_(id)) return "bad-token";
    var main = tgSheetForId_(id);
    var row  = tgFindRow_(main, COL.ID, DATA_START, id, hintRow);
    if (row === -1) return "not-found";
    if (note) { try { main.getRange(row, TG_MAIN_STATUS).setNote(note); } catch (e) { Logger.log("note: " + e); } }
    var manager = tgStr_(main.getRange(row, COL.MANAGER).getValue());
    if (managerVals && managerVals.length) tgSyncToManager_(manager, id, managerVals);
    if (linkRow) tgBumpCounter_(linkRow, stamp || "");
    if (twinId && managerVals && typeof tg1CMirrorTwin_ === "function") {
      tg1CMirrorTwin_(twinId, managerVals);
    }
    return "ok";
  } catch (err) {
    Logger.log("tgFinishClick: " + err);
    return "error";
  }
}

// Менеджер натиснув «немає в Viber/Telegram/WhatsApp» — записуємо це
// в колонку коментаря, щоб наступного разу було видно одразу.
function tgMarkNoMessenger(id, token, app) {
  try {
    if (!id || token !== tgToken_(id)) return "bad-token";
    var names = {viber: "Viber", telegram: "Telegram", whatsapp: "WhatsApp"};
    var nm = names[tgStr_(app).toLowerCase()];
    if (!nm) return "bad-app";

    var sheet = tgSheetForId_(id);
    var row   = tgFindRow_(sheet, COL.ID, DATA_START, id);
    if (row === -1) return "not-found";

    var cell = sheet.getRange(row, COL.NEW_COMMENT);
    var cur  = tgStr_(cell.getValue());
    var mark = "❗ немає в " + nm;
    if (cur.indexOf(mark) >= 0) return nm;          // уже позначено
    var next = cur ? cur + "; " + mark : mark;
    cell.setValue(next);

    // Те саме в таблиці менеджера
    var manager = tgStr_(sheet.getRange(row, COL.MANAGER).getValue());
    tgSyncCommentToManager_(manager, id, next);
    return nm;
  } catch (err) {
    Logger.log("tgMarkNoMessenger: " + err);
    return "error";
  }
}

function tgSyncCommentToManager_(managerName, id, text) {
  try {
    if (!managerName) return;
    var m = tgManagers_()[managerName];
    if (!m || !m.fileId) return;
    var sh = tgMgrSheetForId_(m.fileId, id);
    if (!sh) return;
    var col = (typeof MGR_COL_NEW_COMMENT === "number") ? MGR_COL_NEW_COMMENT : 18;
    if (sh.getMaxColumns() < col) return;
    var row = tgFindRow_(sh, 1, TG_MGR_DATA_START, id);
    if (row !== -1) sh.getRange(row, col).setValue(text);
  } catch (err) { Logger.log("tgSyncCommentToManager_: " + err); }
}

// «❗ немає в Viber; ❗ немає в Telegram» → ["Viber", "Telegram"]
function tgNoAppsFrom_(comment) {
  var out = [], s = tgStr_(comment);
  if (!s) return out;
  var re = /немає в (Viber|Telegram|WhatsApp)/gi, m;
  while ((m = re.exec(s)) !== null) {
    var nm = m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase();
    if (nm.toLowerCase() === "whatsapp") nm = "WhatsApp";
    if (out.indexOf(nm) === -1) out.push(nm);
  }
  return out;
}

// Скасування помилкового натискання
function tgUndo_(id) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return {ok: false, error: "Система зайнята, спробуйте ще раз."};
  try {
    var main = tgSheetForId_(id);
    var row  = tgFindRow_(main, COL.ID, DATA_START, id);
    if (row === -1) return {ok: false, error: "Клієнта " + id + " не знайдено."};
    var d = main.getRange(row, 1, 1, TG_MAIN_LAST).getValues()[0];
    var info = {ok: true, id: id, name: tgStr_(d[COL.NAME - 1]), manager: tgStr_(d[COL.MANAGER - 1])};

    // Нік і дату приєднання не чіпаємо: клієнт справді в каналі
    main.getRange(row, TG_MAIN_STATUS, 1, 2).setValues([["", ""]]);
    try { main.getRange(row, TG_MAIN_STATUS).clearNote(); } catch (err) { Logger.log("clearNote: " + err); }
    var undoVals = ["", "", tgStr_(d[TG_MAIN_LINK - 1]),
                    tgStr_(d[TG_MAIN_NICK - 1]), tgStr_(d[TG_MAIN_JOINED - 1]),
                    tgStr_(d[TG_MAIN_TGID - 1])];
    tgSyncToManager_(info.manager, id, undoVals);
    var twin = (typeof tg1CTwinId_ === "function") ? tg1CTwinId_(main, row) : "";
    if (twin && typeof tg1CMirrorTwin_ === "function") tg1CMirrorTwin_(twin, undoVals);
    tgLogAppend_([new Date(), id, info.name, tgStr_(d[COL.PHONE - 1]), tgStr_(d[COL.REGION - 1]),
                  info.manager, "", "скасування", "скасовано"]);
    return info;
  } finally { lock.releaseLock(); }
}

// Пише блок TG (статус, дата, посилання, нік, дата приєднання) у файл менеджера
function tgSyncToManager_(managerName, id, vals) {
  try {
    if (!managerName) return;
    var m = tgManagers_()[managerName];
    if (!m || !m.fileId) return;
    var sh = tgMgrSheetForId_(m.fileId, id);
    if (!sh || sh.getMaxColumns() < TG_MGR_LAST) return;
    var row = tgFindRow_(sh, 1, TG_MGR_DATA_START, id);
    if (row === -1) return;
    while (vals.length < TG_BLOCK) vals.push("");
    sh.getRange(row, TG_MGR_STATUS, 1, TG_BLOCK).setValues([vals.slice(0, TG_BLOCK)]);
  } catch (err) { Logger.log("tgSyncToManager_: " + err); }
}

// hintRow — номер рядка, зашитий у саму кнопку. Перевіряємо одну
// клітинку замість того, щоб читати всю колонку ID (на листі 1С це
// майже 5000 рядків). Якщо рядок зсунувся — чесно шукаємо.
function tgFindRow_(sheet, idCol, startRow, id, hintRow) {
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return -1;

  var hint = parseInt(hintRow, 10);
  if (hint >= startRow && hint <= lastRow) {
    try {
      if (tgStr_(sheet.getRange(hint, idCol).getValue()) === id) return hint;
    } catch (err) { Logger.log("tgFindRow_ hint: " + err); }
  }

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
  var ss = tgSS_(MAIN_FILE_ID);
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
    var sh = tgSS_(MAIN_FILE_ID).getSheetByName(TG_LINKS_SHEET);
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

// Головна функція вибору посилання для клієнта.
// existing — посилання, яке цей клієнт уже отримав раніше: тоді нове
// не видаємо (клієнт має на руках старе), лише визначаємо його тип.
// Публічний канал відкривається напряму, тож запрошення в ньому не
// «спрацьовує»: у події про вступ посилання немає, і хто саме прийшов —
// невідомо. Тому клієнту даємо посилання на нашого бота з міткою:
// натиснувши «Почати», він сам себе називає, а бот уже веде в канал.
//
// TG_CLIENT_LINK: "eco"    — бот нашої системи (типово, щойно задано TG_LINK_SECRET)
//                 "invite" — пряме запрошення в канал
//                 "bot"    — бот самого скрипта (старий режим, опитування)
//
// Чому типово «eco». Бот нашої системи працює на вебхуку: відповідь клієнту
// приходить за частку секунди, а не до хвилини, як у скриптового бота на
// опитуванні. Він же одразу кладе телефон, нік і Telegram-id у базу й
// відкриває менеджеру чат — те, заради чого все й затівалось. Посилання при
// цьому збирається без жодного звернення в мережу: кнопка лишається миттєвою.
//
// Без TG_LINK_SECRET режим «eco» неможливий (нічим підписати мітку), тому
// типовим лишається пряме запрошення — нічого не ламається.
function tgClientLinkMode_() {
  var raw = tgProp_("TG_CLIENT_LINK").toLowerCase();
  if (raw === "eco")    return "eco";
  if (raw === "bot")    return "bot";
  if (raw === "invite") return "invite";
  return tgLinkSecret_() ? "eco" : "invite";
}

// ── Місток з нашою системою (ltex-ecosystem) ──────────────────────────────
// Спільний секрет: ним підписується і мітка в посиланні, і зворотний виклик
// «клієнт у боті / підписався». У нашій системі це LEADS_TG_LINK_SECRET
// (а без неї — LEADS_IMPORT_SECRET). Значення мусить збігатись до символу.
function tgLinkSecret_() {
  return tgProp_("TG_LINK_SECRET") || tgProp_("LTEX_CRM_SECRET");
}

// Імʼя бота нашої системи. Не секрет — просто щоб не зашивати намертво.
function tgEcoBotUsername_() {
  return (tgProp_("TG_ECO_BOT") || "ltex_second_stok_bot").replace(/^@/, "");
}

// Підпис HMAC-SHA256, урізаний до 12 символів base64url.
// Дзеркальна реалізація — `crm-lead-link-token.ts` у нашій системі: той самий
// алгоритм, той самий алфавіт, та сама довжина. Міняти формат можна ЛИШЕ
// одночасно в обох місцях, інакше посилання перестануть відкриватись.
//
// 12 символів = рівно 9 байтів = 72 біти: підібрати перебором через Telegram
// неможливо, а посилання лишається коротким (ліміт Telegram — 64 символи).
function tgHmac12_(domain, value, secret) {
  if (!secret) return "";
  var bytes = Utilities.computeHmacSha256Signature(domain + ":" + value, secret);
  return Utilities.base64EncodeWebSafe(bytes).substring(0, 12);
}

// Мітка рядка таблиці для deep-link: crm_<ID>_<підпис>.
// Без підпису сусідній номер рядка вгадувався б із наявного, і сторонній
// причепив би свій Telegram до чужого клієнта — менеджер побачив би чужий нік.
function tgEcoPayload_(id) {
  var clean = tgStr_(id);
  var secret = tgLinkSecret_();
  if (!secret || !/^[A-Za-z0-9-]{3,40}$/.test(clean)) return "";
  return "crm_" + clean + "_" + tgHmac12_("crm-lead-link", clean, secret);
}

// Готове посилання на бота нашої системи. Жодних звернень у мережу.
function tgEcoDeepLink_(id) {
  var payload = tgEcoPayload_(id);
  var user = tgEcoBotUsername_();
  return payload && user ? "https://t.me/" + user + "?start=" + payload : "";
}

// Імʼя бота питаємо один раз і памʼятаємо: воно не змінюється.
function tgBotUsername_() {
  var u = tgProp_("TG_BOT_USERNAME");
  if (u) return u;
  try {
    var me = tgApi_("getMe", {});
    if (me.ok && me.result && me.result.username) {
      tgSetProp_("TG_BOT_USERNAME", me.result.username);
      return me.result.username;
    }
  } catch (err) { Logger.log("tgBotUsername_: " + err); }
  return "";
}

function tgBotDeepLink_(id) {
  var user = tgBotUsername_();
  return user ? "https://t.me/" + user + "?start=" + encodeURIComponent(tgStr_(id)) : "";
}

function tgResolveLink_(info, existing) {
  var mode = tgClientLinkMode_();

  // Бот нашої системи. Посилання те саме для повторних кліків (мітка залежить
  // лише від ID рядка), тому `existing` тут не потрібен — зайвого рядка в
  // таблиці не зʼявиться, а клієнт може відкрити старе посилання повторно.
  if (mode === "eco") {
    var eco = tgEcoDeepLink_(info.id);
    if (eco) return {link: eco, row: 0, key: tgNormRegion_(info.region),
                     personal: true, viaBot: true, viaEco: true};
    info.linkWhy = tgLinkSecret_()
      ? "ID «" + info.id + "» не підходить для мітки посилання"
      : "не задано TG_LINK_SECRET — нічим підписати мітку для бота системи";
  }

  // Режим бота: жодних звернень до Telegram при кліку — посилання
  // збирається з імені бота та ID клієнта, тож сторінка відкривається швидше.
  if (mode === "bot") {
    var deep = tgBotDeepLink_(info.id);
    if (deep) return {link: deep, row: 0, key: tgNormRegion_(info.region), personal: true, viaBot: true};
    info.linkWhy = "не вдалось дізнатись імʼя бота — перевірте TG_BOT_TOKEN";
  }

  var map  = tgLinksMap_();
  var key  = tgNormRegion_(info.region);
  var rec  = key ? map[key] : null;

  if (!rec && key) {                       // часткове співпадіння («київ» ↔ «київська»)
    for (var k in map) {
      if (k.indexOf(key) === 0 || key.indexOf(k) === 0) { rec = map[k]; break; }
    }
  }
  // Запамʼятовуємо, чи для САМОЇ області щось налаштовано, — до того як
  // підставити рядок «За замовчуванням». Він спільний для всіх і окремим
  // веденням області не є.
  var ownRec = rec;
  if (!rec || !rec.link) rec = map[tgNormRegion_("За замовчуванням")] || rec;

  var regionLink = rec ? rec.link : "";
  if (existing) {
    return {link: existing, row: 0, key: key, personal: existing !== regionLink};
  }

  // Публічний канал: персональне запрошення в ньому нічого не дає. Telegram
  // відкриває сам канал, підписка йде повз посилання, і в події про вступ
  // його немає — тобто запит до Telegram на кожен клік був би ні за що.
  // Даємо всім одну адресу каналу.
  // Але лише якщо для області не налаштовано СВІЙ канал чи посилання: така
  // настройка означає, що клієнтів цієї області ведуть окремо.
  if (!(ownRec && (ownRec.link || ownRec.chatId)) && typeof tgPublicChannelLink_ === "function") {
    var pub = tgPublicChannelLink_();
    if (pub) return {link: pub, row: 0, key: key, personal: false, publicChannel: true};
  }

  var personal = tgPersonalLink_(info, rec);   // персональне для цього клієнта
  return personal ? {link: personal, row: rec ? rec.row : 0, key: key, personal: true}
                  : {link: regionLink, row: rec ? rec.row : 0, key: key, personal: false};
}

// ПЕРСОНАЛЬНЕ посилання — окреме для кожного клієнта.
// Вмикається автоматично, щойно задано Script Property TG_BOT_TOKEN
// (вимкнути: TG_LINK_MODE = "off" → працюють посилання по областях).
// Назва посилання = ID ліда + ПІБ. Саме вона привʼязує нікнейм у Telegram
// до рядка в таблиці, а отже — до номера телефону клієнта.
//   TG_LINK_MODE = "request"  (за замовчуванням) — заявка на вступ:
//        посилання багаторазове, бот бачить, ХТО подав заявку, і сам її схвалює.
//   TG_LINK_MODE = "personal" — одноразове посилання (member_limit: 1).
function tgPersonalLink_(info, rec) {
  try {
    var token = tgProp_("TG_BOT_TOKEN");
    if (!token) { info.linkWhy = "бот не підключений (немає TG_BOT_TOKEN)"; return ""; }
    var mode = (tgProp_("TG_LINK_MODE") || "request").toLowerCase();
    if (mode === "off" || mode === "ні") {
      info.linkWhy = "персональні посилання вимкнено (TG_LINK_MODE = off)"; return "";
    }
    var chatId = (rec && rec.chatId) || tgProp_("TG_CHAT_ID");
    if (!chatId) {
      info.linkWhy = "не задано ні TG_CHAT_ID, ні Chat ID області в аркуші «" + TG_LINKS_SHEET + "»";
      Logger.log("tgPersonalLink_: не задано TG_CHAT_ID / Chat ID області");
      return "";
    }

    var payload = {chat_id: chatId, name: tgLinkName_(info)};
    if (mode === "personal") payload.member_limit = 1;
    else payload.creates_join_request = true;

    var res = UrlFetchApp.fetch("https://api.telegram.org/bot" + token + "/createChatInviteLink", {
      method: "post", contentType: "application/json",
      payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    var j = JSON.parse(res.getContentText());
    if (j && j.ok && j.result && j.result.invite_link) return j.result.invite_link;
    info.linkWhy = "Telegram не дав посилання: " + (typeof tgExplainTgError_ === "function"
      ? tgExplainTgError_(j && j.description) : tgStr_(j && j.description));
    Logger.log("tgPersonalLink_: " + info.linkWhy);
  } catch (err) {
    info.linkWhy = "не вдалось звернутись до Telegram — " + err;
    Logger.log("tgPersonalLink_: " + err);
  }
  return "";
}

// Назва запрошення в Telegram: «LTEX-20260909-1234 Іванова С» (ліміт 32 символи).
// Починається з ID ліда — по ньому подія вступу знаходить рядок, а в ньому телефон.
function tgLinkName_(info) {
  var id = tgStr_(info && info.id);
  var nm = tgStr_(info && info.name);
  return (nm ? (id + " " + nm) : id).substring(0, 32);
}

// Зворотне перетворення: «LTEX-20260909-1234 Іванова С» → «LTEX-20260909-1234»
function tgLeadIdFromLinkName_(name) {
  var n = tgStr_(name);
  if (!n) return "";
  var first = n.split(/\s+/)[0];
  return /^(LTEX-|1C-)/i.test(first) ? first : "";
}

function tgBumpCounter_(row, stamp) {
  try {
    var sh = tgSS_(MAIN_FILE_ID).getSheetByName(TG_LINKS_SHEET);
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
  var ss = tgSS_(MAIN_FILE_ID);
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
  var ss  = tgSS_(MAIN_FILE_ID);
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

    var main    = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
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
      sendViber(sender.id, "⚠️ Нема чого надсилати: " + (r.linkWhy ||
        ("для області «" + (r.region || "—") + "» ще не задано посилання")) +
        (r.notSent ? "\nСтатус не проставлено." : ""));
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
    var main = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    if (!main || main.getMaxColumns() < TG_MAIN_LINK) return "";
    var lastRow = main.getLastRow();
    if (lastRow < DATA_START) return "";

    var tz   = Session.getScriptTimeZone();
    var yDay = Utilities.formatDate(new Date(Date.now() - 86400000), tz, "dd.MM.yyyy");
    var n    = lastRow - DATA_START + 1;
    var data = main.getRange(DATA_START, 1, n, TG_MAIN_LAST).getValues();

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
  if (r.nick) {
    h.push('<div class="badge badge-join">👤 Клієнт уже в каналі: ' + tgEsc_(r.nick) +
           (r.joinedAt ? ' · ' + tgEsc_(r.joinedAt) : '') + '</div>');
  }
  var absent = tgNoAppsFrom_(r.comment);
  if (absent.length) {
    h.push('<div class="badge badge-rep">❗ Номера немає в: ' + tgEsc_(absent.join(", ")) + '</div>');
  }

  h.push('<div class="card"><div class="card-t">Клієнт</div>');
  h.push(tgRow_("ПІБ", r.name));
  h.push(tgRow_("Телефон", r.phone));
  h.push(tgRow_("Область", r.region + (r.city ? ", " + r.city : "")));
  h.push(tgRow_("Менеджер", r.manager));
  h.push(tgRow_("ID", r.id));
  if (r.interest) h.push(tgRow_("Цікавить", r.interest));
  h.push('</div>');

  if (r.noLink) {
    h.push('<div class="card warn"><div class="card-t">⚠️ Немає посилання — надсилати нічого</div>' +
           '<p>' + tgEsc_(r.linkWhy || ("додайте посилання для області «" + (r.region || "—") +
           "» в аркуш «" + TG_LINKS_SHEET + "» головної таблиці")) + '</p></div>');
  } else {
    h.push('<div class="card"><div class="card-t">' +
           (r.viaBot ? 'Персональне посилання клієнта (відкриє нашого бота)'
                     : r.publicChannel ? 'Посилання на наш Telegram-канал'
                     : r.personal ? 'Персональне посилання цього клієнта'
                                  : 'Унікальне посилання для області «' + tgEsc_(r.region || "за замовчуванням") + '»') +
           '</div>');
    h.push('<div class="link" id="lnk">' + tgEsc_(r.link) + '</div>');
    if (r.publicChannel) {
      h.push('<p class="note">Канал публічний, тож адреса в усіх однакова. Нік клієнта ' +
             'зʼявиться в таблиці лише тоді, коли він відкриє нашого бота.</p>');
    } else if (r.personal && !r.nick) {
      h.push('<p class="note">Щойно клієнт перейде за ним — його нікнейм у Telegram ' +
             'сам зʼявиться в таблиці.</p>');
    }
    h.push('<button class="btn btn-p" onclick="cp(' + tgJs_(r.link) + ',this)">📋 Скопіювати посилання</button>');
    h.push('</div>');

    h.push('<div class="card"><div class="card-t">Готове повідомлення клієнту</div>');
    h.push('<textarea id="msg" rows="16">' + tgEsc_(msg) + '</textarea>');
    h.push('<button class="btn btn-p" onclick="cp(document.getElementById(\'msg\').value,this)">' +
           '📋 Скопіювати повідомлення</button>');
    h.push('</div>');

    // Кнопка відкриває ДІАЛОГ САМЕ З ЦИМ НОМЕРОМ. Текст підставити в
    // чужий чат уміє лише WhatsApp; для Viber і Telegram кладемо текст
    // у буфер у момент натискання — у чаті лишається «Вставити».
    var msgEnc  = encodeURIComponent(msg);
    var msgNoLn = encodeURIComponent(msg.split(r.link).join("").replace(/\n{3,}/g, "\n\n").trim());

    h.push('<div class="card"><div class="card-t">Написати клієнту</div>');
    if (intl) {
      h.push('<div class="grid">');
      h.push('<a class="btn btn-v" href="#" onclick="return go(' +
             tgJs_("viber://chat?number=%2B" + intl) + ',' + tgJs_(msg) + ')">Viber</a>');
      h.push('<a class="btn btn-t" href="#" onclick="return go(' +
             tgJs_("tg://resolve?phone=" + intl) + ',' + tgJs_(msg) + ')">Telegram</a>');
      h.push('<a class="btn btn-w" target="_blank" rel="noopener" href="https://wa.me/' + intl +
             '?text=' + msgEnc + '">WhatsApp</a>');
      h.push('<a class="btn btn-g" target="_blank" rel="noopener" href="' + tgEsc_(r.link) +
             '">Відкрити канал</a>');
      h.push('</div>');
      h.push('<p class="note" id="gonote">Відкриється діалог саме з ' + tgEsc_(r.phone) +
             '. Текст скопіюється сам — у чаті натисніть «Вставити». ' +
             'WhatsApp підставить текст одразу.</p>');
      h.push('<p class="note">Якщо месенджер напише, що такого номера немає — ' +
             'клієнта там справді немає. Позначити: ' +
             '<a href="#" onclick="return noApp(\'viber\')">немає в Viber</a> · ' +
             '<a href="#" onclick="return noApp(\'telegram\')">у Telegram</a> · ' +
             '<a href="#" onclick="return noApp(\'whatsapp\')">у WhatsApp</a></p>');
      h.push('<p class="note" id="marknote"></p>');
      h.push('<details><summary>Не відкривається діалог?</summary>' +
             '<div class="grid" style="margin-top:8px">' +
             '<a class="btn btn-g" target="_blank" rel="noopener" href="viber://forward?text=' + msgEnc +
             '">Viber — через список чатів</a>' +
             '<a class="btn btn-g" target="_blank" rel="noopener" href="https://t.me/share/url?url=' +
             encodeURIComponent(r.link) + '&text=' + msgNoLn + '">Telegram — через список чатів</a>' +
             '</div></details>');
    } else {
      h.push('<p class="note">У картці немає номера телефону — надішліть посилання вручну.</p>');
      h.push('<a class="btn btn-g" target="_blank" rel="noopener" href="' + tgEsc_(r.link) +
             '">Відкрити канал</a>');
    }
    h.push('</div>');
  }

  h.push('<p class="hint">Статус, дата і саме посилання вже записані в головну таблицю ' +
         'і в таблицю менеджера. Натиснули помилково? ' +
         '<a href="' + tgEsc_(undo) + '">Скасувати статус</a>.</p>');

  h.push('<script>var TG_ID=' + tgJson_(r.id) + ',TG_TOKEN=' + tgJson_(tgToken_(r.id)) + ';</script>');

  // Дописуємо файл менеджера вже після показу сторінки
  if (r.deferred) {
    h.push('<script>try{google.script.run.withFailureHandler(function(){})' +
           '.tgFinishClick(' + tgJson_(r.id) + ',' + tgJson_(tgToken_(r.id)) + ',' +
           tgJson_(r.deferred.managerVals) + ',' + (r.deferred.linkRow || 0) + ',' +
           tgJson_(r.deferred.stamp) + ',' + tgJson_(r.deferred.twinId || "") + ',' +
           (r.deferred.row || 0) + ',' + tgJson_(r.deferred.note || "") + ');}catch(e){}</script>');
  }
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
  var tpl = tgProp_("TG_MSG_TEMPLATE") || TG_MSG_DEFAULT;
  return tpl.replace(/\{name\}/g, tgFirstName_(r.name))
            .replace(/\{manager\}/g, tgFirstName_(r.manager) || "L-TEX")
            .replace(/\{link\}/g, r.link || "");
}

// «Кузенко Тарас» → «Тарас». У ПІБ імʼя зазвичай другим словом;
// якщо слово одне — його й повертаємо.
function tgFirstName_(full) {
  var parts = tgStr_(full).split(/\s+/).filter(String);
  if (!parts.length) return "";
  return parts.length > 1 ? parts[1] : parts[0];
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
    '.badge-join{background:rgba(34,158,217,.15);color:#60c5f1;border:1px solid rgba(34,158,217,.35)}' +
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
    '.note{font-size:12px;color:#6b8aaa;margin:8px 0 0}' +
    '.note a{color:#60a5fa}' +
    'details{margin-top:12px}summary{font-size:12px;color:#6b8aaa;cursor:pointer}' +
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
    // Клік по месенджеру: спершу текст у буфер, потім відкриваємо діалог
    'function go(url,text){var n=document.getElementById("gonote");' +
    'function open(okCopy){if(n)n.textContent=okCopy?"✅ Текст скопійовано — у чаті натисніть «Вставити»"' +
    ':"⚠️ Текст не скопіювався — натисніть «Скопіювати повідомлення» вище";' +
    'setTimeout(function(){window.location.href=url},120)}' +
    'try{if(navigator.clipboard&&navigator.clipboard.writeText){' +
    'navigator.clipboard.writeText(text).then(function(){open(true)},function(){open(fbq(text))})}' +
    'else{open(fbq(text))}}catch(e){open(fbq(text))}return false}' +
    // Тихе копіювання без сповіщень — повертає, чи вдалося
    'function fbq(t){var a=document.createElement("textarea");a.value=t;a.style.position="fixed";' +
    'a.style.top="0";a.style.opacity="0";document.body.appendChild(a);a.focus();a.select();' +
    'var d=false;try{d=document.execCommand("copy")}catch(e){d=false}' +
    'document.body.removeChild(a);return d}' +
    // Позначка «номера немає в месенджері»
    'function noApp(app){var n=document.getElementById("marknote");' +
    'if(n)n.textContent="…записую";' +
    'try{google.script.run.withSuccessHandler(function(res){' +
    'if(n)n.textContent=(res&&res.length>2&&res!=="error"&&res!=="bad-app")' +
    '?"❗ Позначено: немає в "+res+" — це збережено в таблиці"' +
    ':"⚠️ Не вдалось записати"})' +
    '.withFailureHandler(function(){if(n)n.textContent="⚠️ Не вдалось записати"})' +
    '.tgMarkNoMessenger(TG_ID,TG_TOKEN,app)}catch(e){if(n)n.textContent="⚠️ Недоступно"}return false}' +
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
  var u = tgProp_("TG_TRACK_URL");
  if (u) return u;
  if (typeof WEBHOOK_URL === "string" && WEBHOOK_URL) return WEBHOOK_URL;
  return ScriptApp.getService().getUrl();
}

// Підпис рядка (щоб статус не можна було проставити «з вулиці»)
function tgToken_(id) {
  var secret = tgProp_("TG_SECRET");
  if (!secret) { secret = Utilities.getUuid(); tgSetProp_("TG_SECRET", secret); }
  var sig = Utilities.computeHmacSha256Signature(String(id), secret);
  var hex = "";
  for (var i = 0; i < sig.length && hex.length < 10; i++) {
    hex += ("0" + (sig[i] & 0xFF).toString(16)).slice(-2);
  }
  return hex.substring(0, 10);
}

// «Вік» статусу для звірки таблиць: вищий виграє, однакові не чіпаємо.
// порожньо(0) < ✅ Надіслано(1) < 💬 У боті(2) < 🚫/❌/інші ручні(3) < 👤 Приєднався(4)
//
// «💬 У боті» стоїть ВИЩЕ за «Надіслано» і НИЖЧЕ за ручний вибір менеджера:
// це факт про клієнта (він відгукнувся), але рішення менеджера «не потрібно»
// воно перебивати не має.
function tgRank_(status) {
  var s = tgStr_(status);
  if (!s) return 0;
  if (s.indexOf("👤") === 0) return 4;
  if (s.indexOf("💬") === 0) return 2;
  if (s.indexOf("✅") === 0) return 1;
  return 3;
}

// Чи вважається, що посилання клієнту вже віддали (тоді клік — повторний).
function tgIsSent_(status) {
  if (!status) return false;
  var s = status.toString().trim();
  return s.indexOf("✅") === 0 || s.indexOf("💬") === 0 || s.indexOf("👤") === 0;
}

function tgStr_(v) {
  return v === null || v === undefined ? "" : v.toString().trim();
}

// Клітинка з датою віддає обʼєкт Date, і його toString() — це
// «Fri Sep 11 2026 09:18:00 GMT+0300 (…)». Для людини це шум.
function tgDateStr_(v) {
  if (v && typeof v.getTime === "function" && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "dd.MM.yyyy HH:mm");
  }
  return tgStr_(v);
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

// Для значення всередині HTML-атрибута (там сутності розкодовуються)
function tgJs_(s) {
  return tgEsc_(JSON.stringify(s === null || s === undefined ? "" : s.toString()));
}

// Для значення всередині <script> — там HTML-сутності НЕ розкодовуються,
// тому екрануємо не в HTML, а в JS: інакше «&quot;» зламав би код,
// а «</script>» усередині тексту обірвав би блок.
function tgJson_(v) {
  return JSON.stringify(v === undefined ? null : v)
    .replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

// Список статусів: колонка G аркуша «Довідники» або TG_STATUS_LIST
function getTgStatusList_() {
  try {
    var ref = tgSS_(MAIN_FILE_ID).getSheetByName("Довідники");
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
  var ref = tgSS_(MAIN_FILE_ID).getSheetByName("Довідники");
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
// ║  11. ЗВІДКИ ВЗЯВСЯ СТАТУС                                ║
// ╚══════════════════════════════════════════════════════════╝
// Кнопка, проставляючи статус, лишає примітку на клітинці: хто менеджер,
// яке джерело і коли сторінку відкривали. Якщо примітки немає — статус
// поставила НЕ кнопка: або перенесення з файлу менеджера (тригер кожні
// 15 хв підтягує статус, який менеджер вибрав руками зі списку), або
// restoreTgStatusesFromLog(), або хтось вписав значення в клітинку.
//
// tgWhoMarked("10.09.2026 23:18") — розібрати конкретну хвилину
// tgWhoMarked("10.09.2026")       — цілий день
// tgWhoMarked()                   — усі позначки
function tgWhoMarked(dateText) {
  var want = tgStr_(dateText);
  var out  = ["Шукаю позначки «надіслано»" + (want ? " з датою «" + want + "»" : "") + "\n"];
  var ss   = tgSS_(MAIN_FILE_ID);
  var names = [MAIN_SHEET];
  if (typeof TG1C_SHEET === "string" && ss.getSheetByName(TG1C_SHEET)) names.push(TG1C_SHEET);

  var total = 0, sources = {}, sample = [];
  names.forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) return;
    var lastRow = sh.getLastRow();
    var n = lastRow - DATA_START + 1;
    if (n < 1 || sh.getMaxColumns() < TG_MAIN_LINK) return;

    var ids   = sh.getRange(DATA_START, COL.ID,     n, 1).getValues();
    var mgr   = sh.getRange(DATA_START, COL.MANAGER, n, 1).getValues();
    var tg    = sh.getRange(DATA_START, TG_MAIN_STATUS, n, 3).getValues();
    var notes = sh.getRange(DATA_START, TG_MAIN_STATUS, n, 1).getNotes();

    for (var i = 0; i < n; i++) {
      if (!tgIsSent_(tgStr_(tg[i][0]))) continue;
      var dt = tgDateStr_(tg[i][1]);
      if (want && dt.indexOf(want) !== 0) continue;

      var m    = /Джерело:\s*([^\n]+)/.exec(tgStr_(notes[i][0]));
      var link = tgStr_(tg[i][2]);
      // Примітка при перенесенні значень не копіюється. Але посилання в
      // рядку могло взятись лише з реального відкриття сторінки — своєї
      // або парного рядка. Тож рядок без примітки, але з посиланням — це
      // теж клік, просто зафіксований в іншому місці.
      var src = m ? m[1].trim()
                  : (link ? "без примітки, але посилання видане — перенесено з парного рядка чи файлу менеджера"
                          : "без примітки й без посилання — вписано вручну або стара вада");
      sources[src] = (sources[src] || 0) + 1;
      total++;
      if (sample.length < 15) {
        sample.push("   рядок " + (DATA_START + i) + " · " + tgStr_(ids[i][0]) + " · " +
                    (tgStr_(mgr[i][0]) || "—") + " · " + (dt || "без дати") +
                    " · посилання: " + (link ? "є" : "НЕМА") + " · " + src);
      }
    }
  });

  out.push("Знайдено рядків: " + total);
  out.push("Джерела:");
  for (var k in sources) out.push("   " + k + " — " + sources[k]);
  if (sample.length) { out.push("Приклади:"); out = out.concat(sample); }

  // Лог веде кнопка й бот; якщо позначок більше, ніж записів у лозі,
  // різницю зробило щось інше.
  var log = ss.getSheetByName(TG_LOG_SHEET), inLog = 0;
  if (log && log.getLastRow() > 1) {
    var rows = log.getRange(2, 1, log.getLastRow() - 1, 9).getValues();
    for (var r = 0; r < rows.length; r++) {
      if (!want || tgDateStr_(rows[r][0]).indexOf(want) === 0) inLog++;
    }
  }
  out.push("Записів у лозі «" + TG_LOG_SHEET + "» " +
           (want ? "за цей час: " : "усього: ") + inLog +
           " (лог рахує кожне відкриття сторінки, тож повторні теж)");
  if (want && total > inLog) {
    out.push("⚠️ Позначок більше, ніж записів у лозі на " + (total - inLog) +
             ". Стільки статусів зʼявилось повз кнопку.");
  }

  Logger.log(out.join("\n"));
  return out.join("\n");
}


// ╔══════════════════════════════════════════════════════════╗
// ║  12. ПОЧАТИ З ЧИСТОГО АРКУША                             ║
// ╚══════════════════════════════════════════════════════════╝
// Прибирає слід тестового періоду, щоб менеджери починали з нуля.
//
//   tgResetProgress()             — лише показати, що буде прибрано
//   tgResetProgress("почати")     — статуси, дати й примітки геть;
//                                   видані посилання, ніки й дати
//                                   приєднання ЛИШАЮТЬСЯ
//   tgResetProgress("почати все") — плюс посилання, ніки, дати
//                                   приєднання і лічильники видач
//
// Чому за замовчуванням посилання й ніки лишаються: посилання клієнт
// уже міг отримати, і саме за ним бот упізнає його, коли той вступить
// у канал. Стерти посилання — значить втратити цей звʼязок і видати
// клієнту друге запрошення.
//
// Лог не видаляється — його перейменовують на «_tg_log_архів_дата»,
// а поруч зʼявляється порожній. Звіт починає рахувати з нуля, але
// історія лишається під рукою.
// Редактор Apps Script запускає функції без аргументів, тож для самого
// чищення є дві окремі — виберіть потрібну у списку функцій і ▶ Виконати.
function tgResetNow()    { return tgResetProgress("почати"); }
function tgResetNowAll() { return tgResetProgress("почати все"); }

function tgResetProgress(confirm) {
  var word = tgStr_(confirm).toLowerCase();
  var run  = word.indexOf("почати") === 0;
  var full = word.indexOf("все") > 0;
  var cols = full ? TG_BLOCK : 2;          // статус+дата, або весь блок
  var out  = [run ? "🧹 ЧИЩЕННЯ" : "👀 ПОКАЗУЮ, ЩО БУДЕ ПРИБРАНО (нічого не змінюю)",
              full ? "Режим: усе, включно з посиланнями, ніками й лічильниками"
                   : "Режим: статуси, дати й примітки; посилання, ніки й дати приєднання лишаються",
              ""];
  var t0 = Date.now(), rows = 0, sheets = 0, left = 0;

  function wipe(sh, statusCol, label) {
    if (!sh || sh.getMaxColumns() < statusCol + cols - 1) return;
    var start = (statusCol === TG_MAIN_STATUS) ? DATA_START : TG_MGR_DATA_START;
    var last  = sh.getLastRow();
    var n     = last - start + 1;
    if (n < 1) return;

    var vals = sh.getRange(start, statusCol, n, 1).getValues();
    var busy = 0;
    for (var i = 0; i < n; i++) if (tgStr_(vals[i][0])) busy++;
    if (!busy) return;

    sheets++; rows += busy;
    out.push("   " + label + ": " + busy);
    if (!run) return;

    sh.getRange(start, statusCol, n, cols).clearContent();
    try { sh.getRange(start, statusCol, n, 1).clearNote(); } catch (err) { Logger.log("clearNote: " + err); }
    // кнопка знову має бути «📨 Надіслати», а не «🔁 Посилання»
    try {
      tgButtonsForSheet_(sh, start, statusCol === TG_MAIN_STATUS ? COL.ID : 1,
                         statusCol === TG_MAIN_STATUS ? TG_MAIN_BTN : TG_MGR_BTN, statusCol, false);
    } catch (err2) { Logger.log("кнопки: " + err2); }
  }

  var ss = tgSS_(MAIN_FILE_ID);
  wipe(ss.getSheetByName(MAIN_SHEET), TG_MAIN_STATUS, "головна таблиця");
  if (typeof TG1C_SHEET === "string") {
    wipe(ss.getSheetByName(TG1C_SHEET), TG_MAIN_STATUS, "лист 1С у головній");
  }

  var managers = tgManagers_();
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) continue;
    if (Date.now() - t0 > TG_TIME_BUDGET) { left++; continue; }
    try {
      var ms = tgSS_(fileId);
      wipe(ms.getSheets()[0], TG_MGR_STATUS, name);
      if (typeof TG1C_SHEET === "string") {
        wipe(ms.getSheetByName(TG1C_SHEET), TG_MGR_STATUS, name + " (1С)");
      }
    } catch (err) { out.push("   ⚠️ " + name + ": " + err); }
  }

  if (full) {
    var links = ss.getSheetByName(TG_LINKS_SHEET);
    if (links && links.getLastRow() > 1) {
      out.push("   лічильники видач у «" + TG_LINKS_SHEET + "»");
      if (run) links.getRange(2, 4, links.getLastRow() - 1, 2).clearContent();
    }
  }

  var log = ss.getSheetByName(TG_LOG_SHEET);
  if (log && log.getLastRow() > 1) {
    out.push("   лог: " + (log.getLastRow() - 1) + " записів → в архів");
    if (run) {
      var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy_HH-mm");
      log.setName(TG_LOG_SHEET + "_архів_" + stamp);
      ensureTgLogSheet_();
    }
  }

  out.push("");
  out.push((run ? "Прибрано рядків: " : "Буде прибрано рядків: ") + rows +
           " у " + sheets + " аркуш(ах)");
  if (left) {
    out.push("⏳ Не встигли " + left + " файл(ів) — запустіть " +
             (full ? "tgResetNowAll()" : "tgResetNow()") + " ще раз");
  } else if (run) {
    out.push("✅ Готово. Кнопки на місці, менеджери починають з нуля.");
  } else {
    out.push("Щоб справді прибрати — виберіть у списку функцій tgResetNow() " +
             "(або tgResetNowAll(), якщо разом із посиланнями й ніками) і ▶ Виконати");
  }

  Logger.log(out.join("\n"));
  return out.join("\n");
}


// ╔══════════════════════════════════════════════════════════╗
// ║  13. ПІДІГРІВ КОНТЕЙНЕРА                                 ║
// ╚══════════════════════════════════════════════════════════╝
// Найдовше в кліку — холодний старт Apps Script: якщо застосунком
// давно не користувались, контейнер треба підняти (1–2 с). Легкий
// запит раз на 5 хвилин не дає йому заснути. Поза робочим часом не
// гріємо, щоб не палити квоту.
var TG_WARM_FROM = 7;   // з 7:00
var TG_WARM_TO   = 21;  // до 21:00

function setupTgWarmTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgWarmJob") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tgWarmJob").timeBased().everyMinutes(5).create();
  Logger.log("✅ Підігрів застосунку встановлено: кожні 5 хв, " +
             TG_WARM_FROM + ":00–" + TG_WARM_TO + ":00");
}

function removeTgWarmTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tgWarmJob") { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log("Видалено тригерів підігріву: " + n);
}

function tgWarmJob() {
  try {
    var h = parseInt(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "H"), 10);
    if (h < TG_WARM_FROM || h > TG_WARM_TO) return;
    UrlFetchApp.fetch(getTgTrackUrl_() + "?a=tg&ping=1", {muteHttpExceptions: true});
  } catch (err) { Logger.log("tgWarmJob: " + err); }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  14. ПЕРЕВІРКА (запустити після встановлення)            ║
// ╚══════════════════════════════════════════════════════════╝
// Що реально відповідає за адресою, на яку ведуть кнопки?
// Старий код віддає JSON {"status":"ok"}, новий — сторінку L-TEX.
// Запит безпечний: ID неіснуючий, підпис навмисно невірний — у таблицю
// нічого не пишеться.
// Чи справді лежить за адресою TG_PAGE_URL наша сторінка і чи вона
// звертається саме до цього веб-застосунку. Ловить три типові біди:
// GitHub Pages не увімкнено, файл не потрапив у потрібну гілку,
// у send.html прописано адресу старого розгортання.
function tgCheckPage_(page, execUrl) {
  try {
    var res  = UrlFetchApp.fetch(page, {muteHttpExceptions: true, followRedirects: true});
    var code = res.getResponseCode();
    if (code !== 200) {
      return {ok: false, why: "сторінка не відкривається (код " + code + "). Перевірте, що " +
                              "файл send.html лежить у гілці, з якої публікується GitHub Pages"};
    }
    var html = res.getContentText() || "";
    if (html.indexOf("fmt=json") < 0) {
      return {ok: false, why: "за цією адресою якась інша сторінка"};
    }
    var dep = /\/macros\/s\/([^/]+)\//.exec(execUrl || "");
    if (dep && html.indexOf(dep[1]) < 0) {
      return {ok: false, why: "у сторінці прописано інший веб-застосунок — виправте рядок " +
                              "API на початку send.html"};
    }
    return {ok: true};
  } catch (err) {
    return {ok: false, why: "не вдалось відкрити сторінку — " + err};
  }
}

function tgCheckDeployed_(url) {
  try {
    var res  = UrlFetchApp.fetch(url + "?a=tg&id=__test__&t=__bad__",
                                 {muteHttpExceptions: true, followRedirects: true});
    var body = res.getContentText() || "";
    if (body.indexOf('"status":"ok"') >= 0) {
      return {ok: false, why: "за адресою кнопок ще СТАРИЙ код. Перевірте рядок " +
                              "handleTgClick у doGet і зробіть Розгорнути → " +
                              "Керувати розгортаннями → ✏️ → Нова версія"};
    }
    if (body.indexOf("Посилання застаріле") < 0 && body.indexOf("L-TEX") < 0) {
      return {ok: false, why: "незрозуміла відповідь (код " + res.getResponseCode() + "): " +
                              body.substring(0, 150).replace(/\s+/g, " ")};
    }

    // Той самий шлях, яким ходить швидка сторінка. Ловить випадок, коли
    // сторінка-кнопка вже нова, а даних вона не отримує.
    // Застосунок іноді відповідає порожнім тілом, якщо саме зараз зайнятий
    // (тригери, самовиклик). Порожньо — не доказ старого коду, тож пробуємо
    // ще раз і лише тоді робимо висновок.
    var j = "";
    for (var attempt = 0; attempt < 2; attempt++) {
      j = UrlFetchApp.fetch(url + "?a=tg&fmt=json&id=__test__&t=__bad__",
                            {muteHttpExceptions: true, followRedirects: true}).getContentText() || "";
      if (j) break;
      Utilities.sleep(1500);
    }
    if (!j) {
      return {ok: true, why: "", note: "запит по дані (fmt=json) відповів порожнім — застосунок був зайнятий"};
    }
    if (j.indexOf('"ok":') < 0) {
      return {ok: false, why: "кнопка відкривається, але запит по дані (fmt=json) віддає не те: " +
                              j.substring(0, 120).replace(/\s+/g, " ") +
                              " — найчастіше деплой ще зі старим TelegramLink.gs"};
    }
    return {ok: true};
  } catch (err) {
    return {ok: false, why: "не вдалось звернутись за адресою кнопок — " + err};
  }
}

function testTgSetup() {
  var out = [];
  var url = getTgTrackUrl_();
  out.push("URL веб-застосунку: " + url);

  // Часта пастка: WEBHOOK_URL у Code.gs прописаний руками і може вести на
  // старий деплой. Порівнювати з ScriptApp.getService().getUrl() не можна —
  // у редакторі він віддає тестову адресу /dev з іншим ідентифікатором.
  // Тому питаємо сам URL кнопок: який код там відповідає.
  var dep = tgCheckDeployed_(url);
  out.push(dep.ok ? "✅ За адресою кнопок відповідає новий код (деплой оновлено)"
                  : "❌ Деплой: " + dep.why);
  if (dep.ok && dep.note) out.push("   ℹ️ " + dep.note);

  var main = tgSS_(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  if (!main || main.getMaxColumns() < TG_MAIN_LINK) {
    out.push("Колонки головної: ❌ не встановлені — запустіть installTgColumns()");
  } else {
    var hdr = main.getRange(tgHeaderRow_(main), TG_MAIN_BTN, 1, 6).getValues()[0];
    out.push("Колонки головної: " + (hdr[0] === TG_HDR_BTN ? "✅ " + hdr.join(" | ") : "❌ не встановлені"));
  }

  var managers = tgManagers_();
  for (var name in managers) {
    if (!managers[name].fileId) continue;
    try {
      var sh = tgSS_(managers[name].fileId).getSheets()[0];
      var h  = sh.getRange(tgHeaderRow_(sh), TG_MGR_BTN).getValue();
      out.push((h === TG_HDR_BTN ? "✅ " : "❌ ") + name);
    } catch (err) { out.push("❌ " + name + ": " + err); }
  }

  var map = tgLinksMap_(), withLink = 0, noLink = [];
  for (var k in map) { if (map[k].link) withLink++; else noLink.push(k); }
  var hasBot = !!(PropertiesService.getScriptProperties().getProperty("TG_BOT_TOKEN") || "").trim();
  var defRec = map[tgNormRegion_("За замовчуванням")];
  if (hasBot) {
    out.push("Посилання по областях: " + withLink + " з " + Object.keys(map).length +
             " — необовʼязкові, бо бот видає персональні");
    if (!defRec || !defRec.link) {
      out.push("   ℹ️ Варто заповнити хоча б рядок «За замовчуванням» в аркуші «" +
               TG_LINKS_SHEET + "» — підстрахує, якщо бот раптом не відповість");
    }
  } else {
    out.push("Посилань заповнено: " + withLink + " з " + Object.keys(map).length);
    if (noLink.length) out.push("Без посилання: " + noLink.join(", "));
  }

  var trig = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === "tgRefreshJob";
  }).length;
  out.push("Тригер оновлення кнопок: " + (trig ? "✅ встановлено" : "❌ немає — запустіть setupTgTrigger()"));

  var page = tgProp_("TG_PAGE_URL");
  if (page) {
    var chk = tgCheckPage_(page, url);
    out.push(chk.ok ? "Кнопки ведуть на швидку сторінку: ✅ " + page
                    : "Швидка сторінка (" + page + "): ❌ " + chk.why);
  } else {
    out.push("Кнопки ведуть на Apps Script (повільніше). Швидку сторінку вмикає " +
             "властивість TG_PAGE_URL");
  }

  var warm = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === "tgWarmJob";
  }).length;
  out.push("Підігрів застосунку: " + (warm ? "✅ увімкнено" : "❌ немає — запустіть setupTgWarmTrigger()"));

  // Часовий пояс таблиці й скрипта мусять збігатися, інакше дати «їдуть»:
  // скрипт пише час по-своєму, а таблиця показує його по-своєму.
  try {
    var tzScript = Session.getScriptTimeZone();
    var tzSheet  = tgSS_(MAIN_FILE_ID).getSpreadsheetTimeZone();
    // Порівнювати назви не можна: «Europe/Kyiv» і «Europe/Kiev» — той самий
    // пояс, просто нова й стара назва. Питання лише в зсуві від Гринвіча.
    var now  = new Date();
    var offS = Utilities.formatDate(now, tzScript, "Z");
    var offT = Utilities.formatDate(now, tzSheet,  "Z");
    if (offS === offT) {
      out.push("Часовий пояс: ✅ " + tzScript +
               (tzScript === tzSheet ? "" : " / таблиця «" + tzSheet + "» — той самий зсув " + offS));
    } else {
      out.push("Часовий пояс: ❌ скрипт «" + tzScript + "» (" + offS +
               "), таблиця «" + tzSheet + "» (" + offT + ")");
      out.push("   Через це дати в колонці надсилання показуються зі зсувом.");
      out.push("   Таблиця: Файл → Налаштування → Часовий пояс.");
      out.push("   Скрипт: ⚙️ Налаштування проєкту → Часовий пояс.");
    }
  } catch (err) { Logger.log("tz: " + err); }

  Logger.log(out.join("\n"));
  return out.join("\n");
}
