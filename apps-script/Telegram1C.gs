// ============================================================
// L-TEX CRM | Telegram1C.gs  ·  v1.0
// ------------------------------------------------------------
// Клієнти з бази 1С — окремим листом у кожного менеджера,
// з тією самою кнопкою «📨 Надіслати» і тими самими статусами.
//
// ЩО ЦЕ ДАЄ
//   Персональне посилання на Telegram-канал можна надіслати не лише
//   новому ліду, а й КОЖНОМУ клієнту, який уже є в 1С. Нікнейм так
//   само сам потрапляє в таблицю, коли клієнт переходить.
//
// ЯК ВЛАШТОВАНО
//   1. База 1С (тільки читаємо, нічого туди не пишемо)
//        ↓ sync1CRegister()
//   2. Головна таблиця → лист «🏭 Клієнти 1С» — той самий набір
//      колонок, що й у «🔒 2026», ID виду «1C-4741»
//        ↓ sync1CToManagers()
//   3. Файл менеджера → лист «🏭 Клієнти 1С» — той самий набір
//      колонок, що й у його робочому листі «Клієнти»
//
// ЗБІГИ МІЖ БАЗАМИ
//   Той самий клієнт може бути і лідом, і карткою в 1С. Ми звіряємо
//   за номером телефону і звʼязуємо рядки: у колонці «⚠️ Дублі
//   телефону» ліда зʼявляється «1С: 4741», а в рядку 1С — «Лід:
//   LTEX-…». Далі це одна людина: обидва рядки отримують ОДНЕ
//   посилання, а статус і нікнейм проставляються в обох.
//
// ЗАПУСК (по черзі, кожну можна повторювати):
//   install1CTelegram()   — усе разом, кроками
//   setup1CTrigger()      — щоденне оновлення з 1С
// ============================================================


var TG1C_PREFIX     = "1C-";              // ID рядка 1С: «1C-4741»
var TG1C_SHEET      = "🏭 Клієнти 1С";     // лист у головній і в менеджера
var TG1C_AGENTS     = "🏭 Агенти 1С";      // відповідність «агент 1С → менеджер»
var TG1C_BATCH      = 4000;               // скільки нових рядків додаємо за один запуск

// Колонки бази 1С, яких немає в ONS_COL (шукаються за заголовком)
var ONS_HDR_CHANNEL = ["канал пошуку", "канал"];
var ONS_HDR_CAT     = ["категорія тт", "категория тт", "категорія"];
var ONS_HDR_TT      = ["назва тт", "название тт"];

// Статуси 1С, яким посилання не надсилаємо (порожньо = надсилаємо всім).
// Значення звіряються без урахування регістру, напр. ["закрився"].
var TG1C_SKIP_STATUS = [];


// ╔══════════════════════════════════════════════════════════╗
// ║  1. ВСТАНОВЛЕННЯ                                         ║
// ╚══════════════════════════════════════════════════════════╝
// Безпечно запускати повторно: пропускає зроблене, продовжує з місця
// зупинки, якщо вичерпався ліміт Apps Script (6 хвилин).
function install1CTelegram() {
  var report = [];
  var steps  = [];
  function add(key, title, fn) { steps.push({key: key, title: title, fn: fn}); }

  add("agents", "Лист «" + TG1C_AGENTS + "»: відповідність агентів менеджерам", function () {
    var n = ensure1CAgentsSheet_();
    report.push("   агентів у базі 1С: " + n);
  });
  add("register", "Лист «" + TG1C_SHEET + "» у головній таблиці", function () {
    ensure1CRegisterSheet_();
  });
  add("sync", "Перенесення клієнтів із бази 1С", function () {
    var r = sync1CRegister();
    report.push("   додано: " + r.added + ", оновлено: " + r.updated +
                ", звʼязано з лідами: " + r.linked + (r.more ? ", ЩЕ ЛИШИЛОСЬ: " + r.more : ""));
    return r.more === 0;   // false → крок не завершено, потрібен ще один запуск
  });
  add("register.fmt", "Головна: списки й кнопки на листі 1С", function () {
    var sh = tg1CRegister_();
    tgSetupFormat_(sh, tgMainCols_());
    tgButtonsForSheet_(sh, DATA_START, COL.ID, TG_MAIN_BTN, TG_MAIN_STATUS, true);
  });

  // Розкладати по менеджерах є сенс лише коли всі клієнти вже в головній.
  // Ключ кроку містить кількість рядків реєстру: побільшав реєстр —
  // ключ інший, отже крок виконається знову і донесе нові рядки.
  var props    = PropertiesService.getScriptProperties();
  var progress = {};
  try { progress = JSON.parse(props.getProperty("TG1C_INSTALL_DONE") || "{}"); } catch (err) { progress = {}; }

  var managers = tgManagers_();
  var names    = Object.keys(managers);
  if (progress.sync) {
    var regRows = tg1CRegisterRows_();
    for (var i = 0; i < names.length; i++) {
      var fileId = managers[names[i]].fileId;
      if (!fileId) continue;
      add("mgr." + names[i] + "." + regRows, names[i] + ": лист «" + TG1C_SHEET + "»",
          tg1CMgrStep_(names[i], fileId));
    }
  }

  var res = tgRunSteps_("TG1C_INSTALL_DONE", steps, report);

  var after = {};
  try { after = JSON.parse(props.getProperty("TG1C_INSTALL_DONE") || "{}"); } catch (err) { after = {}; }
  var needMore = res.left > 0 || !after.sync || !progress.sync;

  Logger.log(report.join("\n"));
  if (needMore) {
    Logger.log("\n⏳ Ще не все. Запустіть install1CTelegram() ЩЕ РАЗ — продовжить з місця зупинки." +
               (!after.sync ? "\n   Клієнти з 1С перенесені не всі — наступний запуск довантажить решту."
                            : "\n   Лишилось кроків: " + res.left + " із " + res.total));
  } else {
    Logger.log("\n🎉 Клієнти 1С розкладені по менеджерах.\n" +
               "   У головній таблиці рядків 1С: " + tg1CRegisterRows_() + "\n" +
               "   Перевірте лист «" + TG1C_AGENTS + "»: якщо навпроти агента порожньо — " +
               "впишіть менеджера вручну, далі sync1CRegister() і sync1CToManagers().\n" +
               "   Далі: setup1CTrigger() — щоденне оновлення з 1С.");
  }
  return report.join("\n");
}

// Скільки рядків з клієнтами вже в реєстрі
function tg1CRegisterRows_() {
  try {
    var sh = tgSS_(MAIN_FILE_ID).getSheetByName(TG1C_SHEET);
    return sh ? Math.max(sh.getLastRow() - DATA_START + 1, 0) : 0;
  } catch (err) { return 0; }
}

function reset1CInstall() {
  PropertiesService.getScriptProperties().deleteProperty("TG1C_INSTALL_DONE");
  Logger.log("Прогрес установки 1С скинуто");
}

function tg1CMgrStep_(name, fileId) {
  return function () { sync1CToManager_(name, fileId); };
}


// ╔══════════════════════════════════════════════════════════╗
// ║  2. БАЗА 1С → ЛИСТ «🏭 Клієнти 1С» У ГОЛОВНІЙ            ║
// ╚══════════════════════════════════════════════════════════╝
function sync1CRegister() {
  var srcId = PropertiesService.getScriptProperties().getProperty("ONS_FILE_ID");
  if (!srcId) throw new Error("не задано Script Property ONS_FILE_ID (файл бази 1С)");

  var src     = tgSS_(srcId).getSheets()[0];
  var lastRow = src.getLastRow();
  if (lastRow < 2) return {added: 0, updated: 0, linked: 0, more: 0};

  var numCols = Math.max(src.getLastColumn(), 18);
  var header  = src.getRange(1, 1, 1, numCols).getValues()[0];
  var c = {
    code:   ONS_COL.CODE,   name: ONS_COL.NAME,   phone: ONS_COL.PHONE,
    city:   ONS_COL.CITY,   region: ONS_COL.REGION, agent: ONS_COL.AGENT,
    date:   ONS_COL.DATE,
    status: tg1CCol_(header, ONS_HDR_STATUS,    ONS_COL.STATUS),
    op:     tg1CCol_(header, ONS_HDR_OP_STATUS, ONS_COL.OP_STATUS),
    chan:   tg1CCol_(header, ONS_HDR_CHANNEL,   10),
    cat:    tg1CCol_(header, ONS_HDR_CAT,       13),
    tt:     tg1CCol_(header, ONS_HDR_TT,        12)
  };
  var data   = src.getRange(2, 1, lastRow - 1, numCols).getValues();
  var agents = tg1CAgentMap_();
  var tz     = Session.getScriptTimeZone();

  // Ліди: телефон → ID (для звʼязку баз)
  var leads = tg1CLeadIndex_();

  var reg     = tg1CRegister_();
  var regLast = reg.getLastRow();
  var regRows = regLast >= DATA_START
    ? reg.getRange(DATA_START, 1, regLast - DATA_START + 1, TG_MAIN_JOINED).getValues() : [];
  var byId = {};
  for (var i = 0; i < regRows.length; i++) {
    var rid = tgStr_(regRows[i][COL.ID - 1]);
    if (rid) byId[rid] = i;
  }

  var added = 0, updated = 0, linked = 0, more = 0, changed = false;
  var newRows = [], leadLinks = {};

  for (var r = 0; r < data.length; r++) {
    var row   = data[r];
    var code  = tgStr_(row[c.code - 1]);
    var phone = tg1CPhone_(row[c.phone - 1]);
    if (!code || !phone) continue;                       // папки й сміття з 1С

    var status1c = tgStr_(row[c.status - 1]);
    if (tg1CSkip_(status1c)) continue;

    var id      = TG1C_PREFIX + code;
    var agent   = tgStr_(row[c.agent - 1]);
    var manager = agents[tg1CNormName_(agent)] || "";
    // Дата в 1С буває і справжньою датою, і текстом («19.1.2024», «7.2.2025»)
    var dateRaw = row[c.date - 1];
    var dateStr = "", year = "";
    if (dateRaw instanceof Date) {
      dateStr = Utilities.formatDate(dateRaw, tz, "dd.MM.yyyy");
      year    = dateRaw.getFullYear();
    } else {
      dateStr = tgStr_(dateRaw);
      var ym  = /(\d{4})/.exec(dateStr);
      if (ym) year = parseInt(ym[1], 10);
    }
    var opStat  = tgStr_(row[c.op - 1]);
    var tt      = tgStr_(row[c.tt - 1]);
    var interest = "1С: " + (status1c || "—") + (opStat ? " · Оп: " + opStat : "") +
                   (tt ? " · " + tt : "");

    // Звʼязок із лідом за номером
    var leadId = leads[phone.slice(-9)] || "";
    var dups   = leadId ? "Лід: " + leadId : "";
    if (leadId) { linked++; leadLinks[leadId] = code; }

    var idx = byId[id];
    if (idx === undefined) {
      if (newRows.length >= TG1C_BATCH) { more++; continue; }
      var fresh = new Array(TG_MAIN_JOINED);
      for (var k = 0; k < TG_MAIN_JOINED; k++) fresh[k] = "";
      fresh[COL.ID - 1] = id;
      fresh[COL.STATUS - 1] = "Очікує";
      tg1CFill_(fresh, {date: dateStr, name: tgStr_(row[c.name - 1]), cat: tgStr_(row[c.cat - 1]),
                        region: tgStr_(row[c.region - 1]), city: tgStr_(row[c.city - 1]),
                        phone: phone, interest: interest, manager: manager,
                        channel: tgStr_(row[c.chan - 1]), year: year, dups: dups});
      newRows.push(fresh);
      added++;
    } else {
      var cur = regRows[idx];
      if (tg1CFill_(cur, {date: dateStr, name: tgStr_(row[c.name - 1]), cat: tgStr_(row[c.cat - 1]),
                          region: tgStr_(row[c.region - 1]), city: tgStr_(row[c.city - 1]),
                          phone: phone, interest: interest, manager: manager,
                          channel: tgStr_(row[c.chan - 1]), year: year, dups: dups})) {
        updated++; changed = true;
      }
    }
  }

  if (changed && regRows.length) {
    reg.getRange(DATA_START, 1, regRows.length, TG_MAIN_JOINED).setValues(regRows);
  }
  if (newRows.length) {
    var start = Math.max(reg.getLastRow() + 1, DATA_START);
    if (reg.getMaxRows() < start + newRows.length - 1) {
      reg.insertRowsAfter(reg.getMaxRows(), start + newRows.length - 1 - reg.getMaxRows());
    }
    reg.getRange(start, 1, newRows.length, TG_MAIN_JOINED).setValues(newRows);
    reg.getRange(start, COL.PHONE, newRows.length, 1).setNumberFormat("@");
  }

  tg1CMarkLeads_(leadLinks);
  Logger.log("sync1CRegister: додано " + added + ", оновлено " + updated +
             ", звʼязано з лідами " + linked + (more ? ", лишилось на наступний запуск " + more : ""));
  return {added: added, updated: updated, linked: linked, more: more};
}

// Записує в рядок реєстру дані з 1С. Повертає true, якщо щось змінилось.
// Колонки, які заповнює менеджер (контакт, активність, статус дії,
// оновлений статус, коментар) і весь TG-блок не чіпаємо.
function tg1CFill_(row, v) {
  var map = [
    [COL.DATE,     v.date],
    [COL.NAME,     v.name],
    [COL.CAT,      v.cat],
    [COL.REGION,   v.region],
    [COL.CITY,     v.city],
    [COL.PHONE,    v.phone],
    [COL.INTEREST, v.interest],
    [COL.CHANNEL,  v.channel],
    [COL.YEAR,     v.year]
  ];
  if (v.manager) map.push([COL.MANAGER, v.manager]);
  if (v.dups)    map.push([COL.DUPS,    v.dups]);

  var changed = false;
  for (var i = 0; i < map.length; i++) {
    var col = map[i][0], val = map[i][1];
    if (tgStr_(row[col - 1]) !== tgStr_(val)) { row[col - 1] = val; changed = true; }
  }
  return changed;
}

function tg1CRegister_() {
  var sh = tgSS_(MAIN_FILE_ID).getSheetByName(TG1C_SHEET);
  if (!sh) throw new Error("лист «" + TG1C_SHEET + "» не знайдено — запустіть install1CTelegram()");
  return sh;
}

// Створює лист реєстру із заголовками, скопійованими з «🔒 2026»,
// щоб набір колонок був точно такий самий.
function ensure1CRegisterSheet_() {
  var ss = tgSS_(MAIN_FILE_ID);
  var sh = ss.getSheetByName(TG1C_SHEET);
  if (sh) return sh;

  var main   = tgMainSheet_();
  var hdrRow = tgHeaderRow_(main);
  var hdrs   = main.getRange(hdrRow, 1, 1, TG_MAIN_JOINED).getValues();

  sh = ss.insertSheet(TG1C_SHEET);
  if (sh.getMaxColumns() < TG_MAIN_JOINED) {
    sh.insertColumnsAfter(sh.getMaxColumns(), TG_MAIN_JOINED - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, TG_MAIN_JOINED).merge()
    .setValue("🏭 Клієнти з бази 1С | L-TEX — розсилка посилання на Telegram-канал")
    .setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center");
  sh.getRange(2, 1, 1, TG_MAIN_JOINED).merge()
    .setValue("Дані тягнуться з бази 1С. Колонки менеджера і TG-блок не перезаписуються.")
    .setFontStyle("italic");
  sh.getRange(hdrRow, 1, 1, TG_MAIN_JOINED).setValues(hdrs)
    .setFontWeight("bold").setBackground("#2E6DA4").setFontColor("#FFFFFF").setWrap(true);
  sh.setFrozenRows(hdrRow);
  sh.setColumnWidth(COL.INTEREST, 260);
  Logger.log("Створено лист «" + TG1C_SHEET + "» у головній таблиці");
  return sh;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  3. РЕЄСТР → ЛИСТ 1С У ФАЙЛІ МЕНЕДЖЕРА                   ║
// ╚══════════════════════════════════════════════════════════╝
function sync1CToManagers() {
  var managers = tgManagers_(), n = 0;
  for (var name in managers) {
    if (!managers[name].fileId) continue;
    try { n += sync1CToManager_(name, managers[name].fileId); }
    catch (err) { Logger.log("sync1CToManagers (" + name + "): " + err); }
  }
  Logger.log("sync1CToManagers: перенесено рядків " + n);
  return n;
}

function sync1CToManager_(name, fileId) {
  var reg     = tg1CRegister_();
  var regLast = reg.getLastRow();
  if (regLast < DATA_START) return 0;

  var all  = reg.getRange(DATA_START, 1, regLast - DATA_START + 1, TG_MAIN_JOINED).getValues();
  var mine = [];
  for (var i = 0; i < all.length; i++) {
    if (tgStr_(all[i][COL.MANAGER - 1]) === name && tgStr_(all[i][COL.ID - 1])) mine.push(all[i]);
  }

  var sh = ensure1CMgrSheet_(fileId);
  var shLast = sh.getLastRow();
  var cur = shLast >= TG_MGR_DATA_START
    ? sh.getRange(TG_MGR_DATA_START, 1, shLast - TG_MGR_DATA_START + 1, TG_MGR_JOINED).getValues() : [];
  var byId = {};
  for (var j = 0; j < cur.length; j++) {
    var id = tgStr_(cur[j][0]);
    if (id) byId[id] = j;
  }

  var newRows = [], changed = false;
  for (var m = 0; m < mine.length; m++) {
    var vals = tg1CMainRowToMgr_(mine[m]);
    var idx  = byId[tgStr_(mine[m][COL.ID - 1])];
    if (idx === undefined) {
      newRows.push(vals);
    } else {
      // Колонки, які веде менеджер у себе, не затираємо
      var keep = [8, 9, 10, 16, 17];   // Перший контакт, Активність, Статус дії, Онов. статус, Коментар
      for (var k = 0; k < keep.length; k++) {
        if (tgStr_(cur[idx][keep[k]])) vals[keep[k]] = cur[idx][keep[k]];
      }
      for (var q = 0; q < TG_MGR_JOINED; q++) {
        if (tgStr_(cur[idx][q]) !== tgStr_(vals[q])) { cur[idx][q] = vals[q]; changed = true; }
      }
    }
  }

  if (changed && cur.length) {
    sh.getRange(TG_MGR_DATA_START, 1, cur.length, TG_MGR_JOINED).setValues(cur);
  }
  if (newRows.length) {
    var start = Math.max(sh.getLastRow() + 1, TG_MGR_DATA_START);
    if (sh.getMaxRows() < start + newRows.length - 1) {
      sh.insertRowsAfter(sh.getMaxRows(), start + newRows.length - 1 - sh.getMaxRows());
    }
    sh.getRange(start, 1, newRows.length, TG_MGR_JOINED).setValues(newRows);
    sh.getRange(start, 7, newRows.length, 1).setNumberFormat("@");
  }

  tgButtonsForSheet_(sh, TG_MGR_DATA_START, 1, TG_MGR_BTN, TG_MGR_STATUS, false);
  Logger.log("sync1CToManager_ " + name + ": усього " + mine.length + ", нових " + newRows.length);
  return mine.length;
}

// Рядок головної (25 колонок) → рядок менеджера (24 колонки).
// Той самий порядок, що й у syncToManager для лідів: колонка
// «Менеджер» пропускається, «Рік» і «Дублі» міняються місцями.
function tg1CMainRowToMgr_(row) {
  var out = [];
  for (var c = 0; c < 10; c++) out.push(row[c] || "");          // 1–10
  for (var d = 11; d < 15; d++) out.push(row[d] || "");         // 12–15 → 11–14
  out.push(row[16] || "");                                      // Рік    → 15
  out.push(row[15] || "");                                      // Дублі  → 16
  out.push(row[17] || "");                                      // Онов. статус → 17
  out.push(row[18] || "");                                      // Коментар     → 18
  for (var t = TG_MAIN_STATUS - 1; t < TG_MAIN_JOINED; t++) {   // TG-блок → 19–24
    out.push(row[t] || "");
  }
  out.splice(TG_MGR_BTN - 1, 0, "");                            // місце під кнопку
  return out.slice(0, TG_MGR_JOINED);
}

function ensure1CMgrSheet_(fileId) {
  var ss = tgSS_(fileId);
  var sh = ss.getSheetByName(TG1C_SHEET);
  if (sh) return sh;

  var work   = ss.getSheets()[0];
  var hdrRow = tgHeaderRow_(work);
  var hdrs   = work.getRange(hdrRow, 1, 1, TG_MGR_JOINED).getValues();

  sh = ss.insertSheet(TG1C_SHEET);
  if (sh.getMaxColumns() < TG_MGR_JOINED) {
    sh.insertColumnsAfter(sh.getMaxColumns(), TG_MGR_JOINED - sh.getMaxColumns());
  }
  sh.getRange(1, 1, 1, TG_MGR_JOINED).merge()
    .setValue("🏭 Мої клієнти з бази 1С | L-TEX")
    .setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center");
  sh.getRange(2, 1, 1, TG_MGR_JOINED).merge()
    .setValue("Ті самі колонки, що й на робочому листі. Кнопка «📨 Надіслати» — так само.")
    .setFontStyle("italic");
  sh.getRange(hdrRow, 1, 1, TG_MGR_JOINED).setValues(hdrs)
    .setFontWeight("bold").setBackground("#2E6DA4").setFontColor("#FFFFFF").setWrap(true);
  sh.setFrozenRows(hdrRow);
  tgSetupFormat_(sh, tgMgrCols_());
  return sh;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  4. АГЕНТИ 1С → МЕНЕДЖЕРИ                                ║
// ╚══════════════════════════════════════════════════════════╝
// У 1С імʼя торгового агента може бути записане інакше, ніж у CRM
// («Володимир» замість «Мельник Володимир»). Лист із відповідністю
// заповнюється здогадкою, а адмін може виправити будь-який рядок.
function ensure1CAgentsSheet_() {
  var ss = tgSS_(MAIN_FILE_ID);
  var sh = ss.getSheetByName(TG1C_AGENTS);
  if (!sh) {
    sh = ss.insertSheet(TG1C_AGENTS);
    sh.getRange(1, 1, 1, 3).setValues([["Торговий агент у 1С", "Менеджер у CRM", "Клієнтів"]])
      .setFontWeight("bold").setBackground("#2E6DA4").setFontColor("#FFFFFF");
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 230); sh.setColumnWidth(2, 230); sh.setColumnWidth(3, 100);
  }

  // Рахуємо агентів у базі 1С
  var srcId = PropertiesService.getScriptProperties().getProperty("ONS_FILE_ID");
  if (!srcId) throw new Error("не задано Script Property ONS_FILE_ID (файл бази 1С)");
  var src = tgSS_(srcId).getSheets()[0];
  var lastRow = src.getLastRow();
  if (lastRow < 2) return 0;

  var rows  = src.getRange(2, 1, lastRow - 1, Math.max(src.getLastColumn(), 6)).getValues();
  var count = {};
  for (var i = 0; i < rows.length; i++) {
    if (!tg1CPhone_(rows[i][ONS_COL.PHONE - 1])) continue;
    var a = tgStr_(rows[i][ONS_COL.AGENT - 1]);
    if (a) count[a] = (count[a] || 0) + 1;
  }

  // Наявні рядки не чіпаємо — адмін міг виправити руками
  var last = sh.getLastRow();
  var have = {};
  if (last >= 2) {
    var cur = sh.getRange(2, 1, last - 1, 2).getValues();
    for (var j = 0; j < cur.length; j++) {
      var nm = tgStr_(cur[j][0]);
      if (nm) have[nm] = j + 2;
    }
  }

  var names = Object.keys(tgManagers_());
  var add = [];
  for (var agent in count) {
    if (have[agent]) {
      sh.getRange(have[agent], 3).setValue(count[agent]);
      continue;
    }
    add.push([agent, tg1CGuessManager_(agent, names), count[agent]]);
  }
  if (add.length) {
    add.sort(function (x, y) { return y[2] - x[2]; });
    sh.getRange(sh.getLastRow() + 1, 1, add.length, 3).setValues(add);
  }
  return Object.keys(count).length;
}

// Мапа: нормалізоване імʼя агента → менеджер
function tg1CAgentMap_() {
  var map = {};
  try {
    var sh = tgSS_(MAIN_FILE_ID).getSheetByName(TG1C_AGENTS);
    if (!sh || sh.getLastRow() < 2) return map;
    var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    for (var i = 0; i < rows.length; i++) {
      var agent = tgStr_(rows[i][0]), mgr = tgStr_(rows[i][1]);
      if (agent && mgr) map[tg1CNormName_(agent)] = mgr;
    }
  } catch (err) { Logger.log("tg1CAgentMap_: " + err); }
  return map;
}

// Здогадка: точний збіг → початок рядка → прізвище → імʼя
function tg1CGuessManager_(agent, names) {
  var a = tg1CNormName_(agent);
  if (!a) return "";
  var i;
  for (i = 0; i < names.length; i++) if (tg1CNormName_(names[i]) === a) return names[i];
  for (i = 0; i < names.length; i++) {
    var n = tg1CNormName_(names[i]);
    if (n.indexOf(a) === 0 || a.indexOf(n) === 0) return names[i];
  }
  var parts = a.split(" ");
  for (i = 0; i < names.length; i++) {
    var np = tg1CNormName_(names[i]).split(" ");
    if (np[0] && np[0] === parts[0]) return names[i];              // прізвище
    if (np[1] && parts[0] && np[1] === parts[0]) return names[i];  // саме імʼя
  }
  return "";
}

function tg1CNormName_(s) {
  return tgStr_(s).toLowerCase().replace(/[’'`ʼ]/g, "").replace(/\s+/g, " ").trim();
}


// ╔══════════════════════════════════════════════════════════╗
// ║  5. ЗБІГИ МІЖ БАЗАМИ                                     ║
// ╚══════════════════════════════════════════════════════════╝
// Телефон (9 цифр) → ID ліда з «🔒 2026»
function tg1CLeadIndex_() {
  var idx  = {};
  var main = tgMainSheet_();
  var last = main.getLastRow();
  if (last < DATA_START) return idx;
  var data = main.getRange(DATA_START, 1, last - DATA_START + 1, COL.PHONE).getValues();
  for (var i = 0; i < data.length; i++) {
    var id = tgStr_(data[i][COL.ID - 1]);
    var ph = tgStr_(data[i][COL.PHONE - 1]).replace(/\D/g, "").slice(-9);
    if (id && ph.length >= 8 && !idx[ph]) idx[ph] = id;
  }
  return idx;
}

// Позначає в лідах, що клієнт уже є в 1С: «1С: 4741» у колонці дублів
function tg1CMarkLeads_(leadLinks) {
  var ids = Object.keys(leadLinks);
  if (!ids.length) return;
  try {
    var main = tgMainSheet_();
    var last = main.getLastRow();
    if (last < DATA_START) return;
    var n    = last - DATA_START + 1;
    var col  = main.getRange(DATA_START, COL.ID,   n, 1).getValues();
    var dups = main.getRange(DATA_START, COL.DUPS, n, 1).getValues();
    var changed = false;
    for (var i = 0; i < n; i++) {
      var id = tgStr_(col[i][0]);
      if (!id || !leadLinks[id]) continue;
      var want = "1С: " + leadLinks[id];
      var cur  = tgStr_(dups[i][0]);
      if (cur.indexOf(want) === -1) {
        dups[i][0] = cur ? (cur + "; " + want) : want;
        changed = true;
      }
    }
    if (changed) main.getRange(DATA_START, COL.DUPS, n, 1).setValues(dups);
  } catch (err) { Logger.log("tg1CMarkLeads_: " + err); }
}

// Другий рядок того самого клієнта: лід ↔ картка 1С
function tg1CTwinId_(sheet, row) {
  try {
    var v = tgStr_(sheet.getRange(row, COL.DUPS).getValue());
    if (!v) return "";
    var lead = /(LTEX-\d{8}-\d{4})/.exec(v);
    if (lead) return lead[1];
    var ons = /1С:\s*([A-Za-z0-9\-_]+)/i.exec(v);
    if (ons) return TG1C_PREFIX + ons[1];
  } catch (err) { Logger.log("tg1CTwinId_: " + err); }
  return "";
}

// Посилання, яке вже видане другому рядку того самого клієнта
function tg1CTwinLink_(twinId) {
  try {
    if (!twinId) return "";
    var sheet = tgSheetForId_(twinId);
    if (!sheet) return "";
    var row = tgFindRow_(sheet, COL.ID, DATA_START, twinId);
    if (row === -1) return "";
    return tgStr_(sheet.getRange(row, TG_MAIN_LINK).getValue());
  } catch (err) { Logger.log("tg1CTwinLink_: " + err); return ""; }
}

// Переносить TG-блок на другий рядок того самого клієнта
function tg1CMirrorTwin_(twinId, vals) {
  try {
    if (!twinId) return;
    var sheet = tgSheetForId_(twinId);
    if (!sheet) return;
    var row = tgFindRow_(sheet, COL.ID, DATA_START, twinId);
    if (row === -1) return;
    sheet.getRange(row, TG_MAIN_STATUS, 1, TG_BLOCK).setValues([vals]);
    var manager = tgStr_(sheet.getRange(row, COL.MANAGER).getValue());
    tgSyncToManager_(manager, twinId, vals);
    Logger.log("tg1CMirrorTwin_: " + twinId + " ← той самий клієнт");
  } catch (err) { Logger.log("tg1CMirrorTwin_: " + err); }
}


// ╔══════════════════════════════════════════════════════════╗
// ║  6. ДОПОМІЖНІ                                            ║
// ╚══════════════════════════════════════════════════════════╝
function tg1CCol_(header, names, fallback) {
  if (typeof findOnsCol_ === "function") return findOnsCol_(header, names, fallback);
  for (var n = 0; n < names.length; n++) {
    var want = names[n].trim().toLowerCase();
    for (var c = 0; c < header.length; c++) {
      if (tgStr_(header[c]).toLowerCase() === want) return c + 1;
    }
  }
  return fallback;
}

// Телефон із 1С: «672081633» → «0672081633».
// Усе, що не схоже на український номер (іноземні коди, сміття виду
// 1111111111), відкидаємо: краще пропустити рядок, ніж надіслати
// повідомлення чужій людині.
function tg1CPhone_(v) {
  var d = tgStr_(v).replace(/\D/g, "");
  if (d.length < 9) return "";
  if (/^(\d)\1+$/.test(d)) return "";                                   // 1111111111, 77777777
  if (d.length === 9)  return "0" + d;                                   // 672081633
  if (d.length === 10) return d.charAt(0) === "0" ? d : "";              // 0672081633
  if (d.length === 11 && d.indexOf("38")  === 0) return "0" + d.substring(2);
  if (d.length === 12 && d.indexOf("380") === 0) return "0" + d.substring(3);
  return "";                                                             // 353830438055 — не наш
}

function tg1CSkip_(status) {
  if (!TG1C_SKIP_STATUS.length) return false;
  var s = tgStr_(status).toLowerCase();
  for (var i = 0; i < TG1C_SKIP_STATUS.length; i++) {
    if (s.indexOf(TG1C_SKIP_STATUS[i].toLowerCase()) >= 0) return true;
  }
  return false;
}


// ╔══════════════════════════════════════════════════════════╗
// ║  7. ЩОДЕННЕ ОНОВЛЕННЯ І ПЕРЕВІРКА                        ║
// ╚══════════════════════════════════════════════════════════╝
function setup1CTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tg1CSyncJob") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("tg1CSyncJob").timeBased().everyDays(1).atHour(6).create();
  Logger.log("✅ Щоденне оновлення з 1С встановлено на 6:00");
}

function remove1CTrigger() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tg1CSyncJob") { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log("Видалено тригерів: " + n);
}

function tg1CSyncJob() {
  try {
    ensure1CAgentsSheet_();
    sync1CRegister();
    tg1CRefreshButtons();
    sync1CToManagers();
  } catch (err) { Logger.log("tg1CSyncJob: " + err); }
}

// Кнопки новим рядкам 1С у головній і в менеджерів.
// Аркушів багато й вони великі, тому з бюджетом часу: що не встигли,
// доробить наступний запуск (або щоденне tg1CSyncJob).
function tg1CRefreshButtons() {
  var t0 = Date.now();
  var n = 0, left = 0;

  var reg = tgSS_(MAIN_FILE_ID).getSheetByName(TG1C_SHEET);
  if (reg) n += tgButtonsForSheet_(reg, DATA_START, COL.ID, TG_MAIN_BTN, TG_MAIN_STATUS, false);

  var managers = tgManagers_();
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) continue;
    if (Date.now() - t0 > TG_TIME_BUDGET) { left++; continue; }
    try {
      var sh = tgSS_(fileId).getSheetByName(TG1C_SHEET);
      if (sh) n += tgButtonsForSheet_(sh, TG_MGR_DATA_START, 1, TG_MGR_BTN, TG_MGR_STATUS, false);
    } catch (err) { Logger.log("tg1CRefreshButtons (" + name + "): " + err); }
  }

  Logger.log("tg1CRefreshButtons: кнопок " + n +
             (left ? "\n⏳ Не встигли " + left + " файл(ів) — запустіть tg1CRefreshButtons() ще раз"
                   : "\n✅ Усі листи 1С оновлено"));
  return n;
}

function test1CSetup() {
  var out = [];
  var srcId = PropertiesService.getScriptProperties().getProperty("ONS_FILE_ID");
  out.push(srcId ? "✅ ONS_FILE_ID задано" : "❌ ONS_FILE_ID не задано — база 1С недоступна");
  if (!srcId) { Logger.log(out.join("\n")); return out.join("\n"); }

  try {
    var src = tgSS_(srcId).getSheets()[0];
    out.push("✅ База 1С: «" + tgSS_(srcId).getName() + "», рядків: " + (src.getLastRow() - 1));
  } catch (err) { out.push("❌ База 1С недоступна: " + err); }

  var reg = tgSS_(MAIN_FILE_ID).getSheetByName(TG1C_SHEET);
  out.push(reg ? "✅ Лист «" + TG1C_SHEET + "»: рядків " + Math.max(reg.getLastRow() - DATA_START + 1, 0)
               : "❌ Листа «" + TG1C_SHEET + "» немає — запустіть install1CTelegram()");

  var ag = tgSS_(MAIN_FILE_ID).getSheetByName(TG1C_AGENTS);
  if (ag && ag.getLastRow() >= 2) {
    var rows = ag.getRange(2, 1, ag.getLastRow() - 1, 3).getValues();
    var noMgr = [];
    for (var i = 0; i < rows.length; i++) {
      if (!tgStr_(rows[i][1])) noMgr.push(tgStr_(rows[i][0]) + " (" + rows[i][2] + ")");
    }
    out.push(noMgr.length ? "⚠️ Без менеджера в «" + TG1C_AGENTS + "»: " + noMgr.join(", ")
                          : "✅ Усі агенти 1С звʼязані з менеджерами");
  }

  var managers = tgManagers_();
  for (var name in managers) {
    if (!managers[name].fileId) continue;
    try {
      var sh = tgSS_(managers[name].fileId).getSheetByName(TG1C_SHEET);
      out.push((sh ? "✅ " : "❌ ") + name + ": " +
               (sh ? "рядків " + Math.max(sh.getLastRow() - TG_MGR_DATA_START + 1, 0) : "листа немає"));
    } catch (err) { out.push("❌ " + name + ": " + err); }
  }

  Logger.log(out.join("\n"));
  return out.join("\n");
}
