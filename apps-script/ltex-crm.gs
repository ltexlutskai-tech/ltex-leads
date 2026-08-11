// ============================================================
// L-TEX CRM | Google Apps Script v6.5
// Нове у v6.5: колонки «Оновлений статус» та
//   «Коментар (результат розмови), НПТ (не піднімає трубку)»
//   у головній таблиці та в таблицях усіх менеджерів
//   + двостороння синхронізація цих колонок
//   + разова міграція addUpdatedStatusColumns()
//
// v6.4: синхронізація ТАБЛИЦЯ МЕНЕДЖЕРА → ГОЛОВНА
// v6.3: сповіщення менеджеру при повторному запиті,
//       автозапис лідів з Gmail (5 типів), розподіл за областями
// ============================================================

// ⚠️ РЕКОМЕНДАЦІЯ БЕЗПЕКИ: перенесіть ключі в Script Properties:
//   Файл → Властивості проекту → Властивості скрипту
//   VIBER_TOKEN, ANTHROPIC_KEY → зчитуйте через:
//   PropertiesService.getScriptProperties().getProperty("VIBER_TOKEN")

const VIBER_TOKEN = PropertiesService.getScriptProperties().getProperty("VIBER_TOKEN");
const MAIN_SHEET   = "🔒 2026";
const MGR_SHEET    = "⚙️ Менеджери";
const DATA_START   = 5;
const PHONE_COL    = 7;
const MAIN_FILE_ID = "1C-d_w2qr3CWn7RZZlWr6W8GE7VIiGBwSAx1ZmDAOfCA";
const WEBHOOK_URL  = "https://script.google.com/macros/s/AKfycbz658U5qNEK-dpod2GOHWiKYW3jnta1zKBosKNvIbL6NvU8V_uC6HYIax0cWP0wodST/exec";
const ADMIN_VIBER_ID = "yz7qkyTVUGuGHAGoSvdEmQ==";
const ANTHROPIC_KEY = PropertiesService.getScriptProperties().getProperty("ANTHROPIC_KEY");
const COL = {
  ID:1,DATE:2,NAME:3,CAT:4,REGION:5,CITY:6,PHONE:7,
  INTEREST:8,CONTACT:9,ACTIVITY:10,MANAGER:11,STATUS:12,
  CHANNEL:13,SITE:14,TG:15,DUPS:16,YEAR:17,
  // ── v6.5: обдзвін і актуалізація бази ──
  NEW_STATUS:18,   // R — «Оновлений статус»
  NEW_COMMENT:19   // S — «Коментар (результат розмови), НПТ»
};
const MGR_COL = {NAME:1,ROLE:2,VIBER_ID:3,FILE_ID:4,ADDED:5,ACTIVE:6};
const ONS_COL = {CODE:1, NAME:2, PHONE:3, CITY:4, REGION:5, AGENT:6, DATE:16};

// ── v6.5: нові колонки актуалізації ──────────────────────
// Головна таблиця: 19 колонок (R = Оновлений статус, S = Коментар)
// Файл менеджера:  18 колонок (Q = Оновлений статус, R = Коментар)
const MAIN_LAST_COL         = 19;
const MGR_LAST_COL          = 18;
const MGR_COL_NEW_STATUS    = 17;  // Q у файлі менеджера
const MGR_COL_NEW_COMMENT   = 18;  // R у файлі менеджера
const HDR_NEW_STATUS        = "Оновлений статус";
const HDR_NEW_COMMENT       = "Коментар (результат розмови), НПТ (не піднімає трубку)";
const NEW_STATUS_LIST       = ["Карточка клієнта", "без змін", "НПТ", "вилучити"];

// ── Розподіл менеджерів за областями ──────────────────────
// Якщо область не знайдена — призначається ADMIN_MANAGER
var ADMIN_MANAGER = "Кузенко Тарас";
var REGION_TO_MANAGER = {
  "житомирська":        "Гуменюк Євген",
  "вінницька":          "Гуменюк Євген",
  "черкаська":          "Гуменюк Євген",
  "хмельницька":        "Гуменюк Євген",
  "тернопільська":      "Гуменюк Євген",
  "львівська":          "Дунас Богдан",
  "івано-франківська":  "Дунас Богдан",
  "івано франківська":  "Дунас Богдан",
  "чернівецька":        "Дунас Богдан",
  "волинська":          "Захарчук Олександра",
  "рівненська":         "Захарчук Олександра",
  "донецька":           "Кузенко Тарас",
  "луганська":          "Кузенко Тарас",
  "харківська":         "Кузенко Тарас",
  "полтавська":         "Кузенко Тарас",
  "чернігівська":       "Кузенко Тарас",
  "київська":           "Кузенко Тарас",
  "одеська":            "Максимюк Анна",
  "миколаївська":       "Максимюк Анна",
  "запорізька":         "Максимюк Анна",
  "запоріжзька":        "Максимюк Анна",
  "кіровоградська":     "Максимюк Анна",
  "дніпропетровська":   "Максимюк Анна",
  "закарпатська":       "Максимюк Анна",
  "сумська":            "Максимюк Анна",
};

function getManagerByRegion(region) {
  if (!region) return ADMIN_MANAGER;
  var key = region.toString().trim().toLowerCase();
  return REGION_TO_MANAGER[key] || ADMIN_MANAGER;
}

// ── Менеджери ─────────────────────────────────────────────

function getManagers() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MGR_SHEET);
  if (!sheet) { createManagerSheet(ss); return {}; }
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  var data = sheet.getRange(2,1,lastRow-1,6).getValues();
  var managers = {};
  data.forEach(function(row) {
    var name = row[MGR_COL.NAME-1] ? row[MGR_COL.NAME-1].toString().trim() : "";
    var active = row[MGR_COL.ACTIVE-1];
    if (!name) return;
    if (active===false||active==="ні"||active==="нi") return;
    managers[name] = {
      role:    row[MGR_COL.ROLE-1]     ? row[MGR_COL.ROLE-1].toString().trim()     : "менеджер",
      viberId: row[MGR_COL.VIBER_ID-1] ? row[MGR_COL.VIBER_ID-1].toString().trim() : "",
      fileId:  row[MGR_COL.FILE_ID-1]  ? row[MGR_COL.FILE_ID-1].toString().trim()  : "",
    };
  });
  return managers;
}

function createManagerSheet(ss) {
  var sheet = ss.insertSheet(MGR_SHEET);
  // ⚠️ Колонка 3 = Viber ID (не Telegram!)
  var headers = ["Ім'я","Роль","Viber ID","ID файлу Google Sheets","Дата реєстрації","Активний"];
  sheet.getRange(1,1,1,headers.length).setValues([headers]).setFontWeight("bold");
  sheet.setFrozenRows(1);
  var existing = [
    ["Гуменюк Євген",       "менеджер","74Euz37CsyzOD+LHbnCsfQ==","1Q4xnVymuv4zFiGJRg6DphgxBQgsUcHhDFBe63WQRVyg",new Date(),true],
    ["Дунас Богдан",        "менеджер","3noJ3lapnzzhCUFBOSly9Q==","1CkjKcNL3YseHpyAYQSTY4Hp4O1LTa_xJrA-syLTb9Vk",new Date(),true],
    ["Захарчук Олександра", "менеджер","D2mgNVbG8j6f/babC7EVYQ==","1GXJiBdTorGrvecn7tn03_gx3WXDS-LEl-1Hzl2fYPfw", new Date(),true],
    ["Кузенко Тарас",       "менеджер","yz7qkyTVUGuGHAGoSvdEmQ==","1kJupQUVXtCG4wRcYzGDDzigPVXdExQ85WhOy2CPExus", new Date(),true],
    ["Максимюк Анна",       "менеджер","pF0eb5ERSVv2FQyPkzFM0g==","1RGkvIGgXo_gu45oUBIIGQa3_3fWBFZNZ0eaiVMYsNS4", new Date(),true],
  ];
  sheet.getRange(2,1,existing.length,existing[0].length).setValues(existing);
  Logger.log("✅ Аркуш менеджерів створено");
}

function addManagerToSheet(name,role,viberId,fileId) {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MGR_SHEET);
  if (!sheet) { createManagerSheet(ss); sheet=ss.getSheetByName(MGR_SHEET); }
  sheet.appendRow([name,role,viberId,fileId,new Date(),true]);
}


// ── onEdit ────────────────────────────────────────────────

function onEdit(e) {
  try {
    var sheet = e.range.getSheet();
    if (sheet.getName()!==MAIN_SHEET) return;
    var row = e.range.getRow();
    if (row<DATA_START) return;
    var idCell = sheet.getRange(row,COL.ID);
    if (!idCell.getValue()) idCell.setValue(generateId());
    var rowData = sheet.getRange(row,1,1,sheet.getLastColumn()).getValues()[0];
    var manager = rowData[COL.MANAGER-1] ? rowData[COL.MANAGER-1].toString().trim() : "";
    var rowId   = rowData[COL.ID-1]      ? rowData[COL.ID-1].toString()             : "";
    if (!manager||!rowId) return;
    var managers = getManagers();
    if (!managers[manager]) return;
    var mgr = managers[manager];
    var editCol = e.range.getColumn();

    // ── ВИПРАВЛЕННЯ: якщо рядок видалено зі статусом вилучити → синхронізуємо до менеджера ──
    var status = rowData[COL.STATUS-1] ? rowData[COL.STATUS-1].toString().trim() : "";
    if (editCol===COL.STATUS && status==="вилучити") {
      // Синхронізуємо статус вилучити до менеджера
      syncStatusToManager(rowId, "вилучити", mgr.fileId);
    }

    syncToManager(rowData,rowId,mgr.fileId,manager);

    if (editCol===COL.MANAGER && mgr.viberId) {
      var msg = "Новий клієнт призначено тобі!\n\n"+
        "ID: "+rowId+"\nІм'я: "+(rowData[COL.NAME-1]||"—")+
        "\nТелефон: "+(rowData[COL.PHONE-1]||"—")+
        "\nОбласть: "+(rowData[COL.REGION-1]||"—")+
        "\nЦікавить: "+(rowData[COL.INTEREST-1]||"—");
      sendViber(mgr.viberId, msg);
    }
    if (editCol===COL.STATUS) {
      var newStatus = e.range.getValue();
      if (newStatus) {
        notifyOwners("Зміна статусу!\nМенеджер: "+manager+"\nКлієнт: "+(rowData[COL.NAME-1]||"—")+"\nСтатус: "+newStatus);
      }
    }
  } catch(err) { Logger.log("onEdit: "+err); }
}

// ── НОВИЙ: Синхронізація статусу вилучити до менеджера ───
function syncStatusToManager(rowId, status, fileId) {
  if (!fileId) return;
  try {
    var ss = SpreadsheetApp.openById(fileId);
    var sheet = ss.getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < 5) return;
    var idData = sheet.getRange(5,1,lastRow-4,1).getValues();
    for (var i=0;i<idData.length;i++) {
      if (idData[i][0]&&idData[i][0].toString()===rowId) {
        // Col 11 = Статус дії у менеджера
        sheet.getRange(5+i, 11).setValue(status);
        Logger.log("syncStatusToManager: "+rowId+" → "+status);
        return;
      }
    }
  } catch(err) { Logger.log("syncStatusToManager: "+err); }
}


// ── doPost ────────────────────────────────────────────────

function doPost(e) {
  try {
    var data = e.postData ? JSON.parse(e.postData.contents) : (e.parameter||{});

    if (data.action==="parse") return handleParseRequest(data);
    if (data.type==="sync_from_manager") { handleSyncFromManager(data); return okResponse(); }

  // ── Дедуплікація ──
    var senderId = data.sender ? data.sender.id : "";
    var msgTime  = data.timestamp ? parseInt(data.timestamp) : 0;

    // Ігноруємо повідомлення старші за 5 хвилин
    if (msgTime > 0 && (Date.now() - msgTime) > 300000) return okResponse();

    // Токен = відправник + текст (80 символів). Viber retry має той самий текст → блокується
    var token = senderId + "_" + (data.message ? (data.message.text||"").substring(0,80) : (data.event||""));

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return okResponse();
    try {
      var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
      var logSheet = ss.getSheetByName("_log");
      if (!logSheet) { logSheet=ss.insertSheet("_log"); logSheet.hideSheet(); }
      // Дедуплікація з часовим вікном: блокуємо лише ретраї Viber (повтор за останні 2 хв),
      // але дозволяємо повторний запит того ж номера пізніше.
      var DEDUP_WINDOW_MS = 120000; // 2 хвилини
      var nowMs = Date.now();
      var isDup = false;
      if (logSheet.getLastRow() > 0) {
        var logRows = logSheet.getRange(1,1,logSheet.getLastRow(),2).getValues();
        for (var li = logRows.length - 1; li >= 0; li--) {
          if (logRows[li][0] === token) {
            var ts = logRows[li][1] instanceof Date ? logRows[li][1].getTime() : 0;
            if (nowMs - ts < DEDUP_WINDOW_MS) isDup = true;
            break;
          }
        }
      }
      if (isDup) return okResponse();
      logSheet.appendRow([token, new Date()]);
      SpreadsheetApp.flush(); // примусово записуємо на диск ДО виходу з lock
      if (logSheet.getLastRow()>500) logSheet.deleteRows(1, logSheet.getLastRow()-500);
    } finally {
      lock.releaseLock();
    }

    // ── КРИТИЧНО: ці рядки були відсутні ──
    var event  = data.event;
    var sender = data.sender;
    if (!sender) return okResponse();

    if (event==="conversation_started") {
      sendViber(sender.id,"Вітаємо, "+sender.name+"!\n\nКоманди:\n/шаблон — шаблон для ліда\n/лід — додати клієнта\n/допомога — всі команди");
      return okResponse();
    }
    if (event!=="message"||!data.message||data.message.type!=="text") return okResponse();

    var text = data.message.text.trim();
    var tl   = text.toLowerCase();

    if (text==="/шаблон")    { sendViber(sender.id,getTemplate()); return okResponse(); }
    if (text==="/менеджери") {
      var managers=getManagers();
      var list=Object.keys(managers).map(function(n){return"  - "+n+" ("+managers[n].role+")"}).join("\n");
      sendViber(sender.id,"Активні менеджери:\n"+list);
      return okResponse();
    }
    if (text==="/допомога") {
      sendViber(sender.id,
        "L-TEX CRM — команди:\n\n/шаблон — шаблон\n/лід — додати клієнта\n/менеджери — список\n/1с 0981234567 — пошук в базі 1С\n/допомога — довідка"+
        (sender.id===ADMIN_VIBER_ID?"\n\nАдмін:\n/реєстрація — новий менеджер\n/довідник — оновити списки":""));
      return okResponse();
    }

    // ── Пошук по базі 1С: /1с 0981234567 ──
    if (tl.startsWith("/1с")||tl.startsWith("/1c")) {
      var qPhone = text.replace(/^\/(1с|1c)\s*/i,"").trim().replace(/\D/g,"").slice(-10);
      if (!qPhone || qPhone.length < 8) {
        sendViber(sender.id, "Формат команди:\n/1с 0981234567");
        return okResponse();
      }
      var r1c = check1CByPhone(qPhone);
      if (r1c) {
        sendViber(sender.id,
          "✅ Знайдено в базі 1С:\n\n"+
          "Код 1С: "+r1c.code+"\nПІБ: "+r1c.name+
          "\nТелефон: "+r1c.phone+"\nМісто: "+r1c.city+
          "\nТорговий агент: "+r1c.agent+"\nДата додавання: "+r1c.date);
      } else {
        sendViber(sender.id, "❌ Клієнт з номером "+qPhone+" не знайдений в базі 1С.");
      }
      return okResponse();
    }

    if (tl.startsWith("/довідник")&&sender.id===ADMIN_VIBER_ID) { handleDictionaryCommand(text,sender); return okResponse(); }
    if (tl.startsWith("/реєстрація")&&sender.id===ADMIN_VIBER_ID) { handleRegistration(text,sender); return okResponse(); }
    if (tl==="/старт"||tl==="/start") { handleNewUserStart(sender); return okResponse(); }

    var managers = getManagers();
    var isRegistered = false;
    for (var mn in managers) {
      if (managers[mn].viberId === sender.id) { isRegistered = true; break; }
    }

    var isLead=tl.startsWith("/лід")||tl.startsWith("/lid")||tl.startsWith("/add")||tl.startsWith("/новий");
    if (isLead) { text=text.replace(/^\/(лід|lid|add|новий)\s*/i,"").trim(); tl=text.toLowerCase(); }

    // Ліди з полями Телефон+Менеджер приймаємо від будь-кого (включно з групами/каналами)
    var isLeadByFields = tl.indexOf("телефон:")>=0 && tl.indexOf("менеджер:")>=0;

    if (!isRegistered && !isLead && !isLeadByFields) return okResponse();

    if (isLead||isLeadByFields) {
      var result=parseAndSave(text,sender);
      if (result.success) {
        sendViber(sender.id,"Клієнт збережений!\nID: "+result.id+"\nІм'я: "+result.name+"\nМенеджер: "+result.manager);
      } else {
        sendViber(sender.id,"Помилка:\n"+result.error+"\n\nНадішли /шаблон для прикладу.");
      }
      return okResponse();
    }

    // ── Автоперевірка номера телефону (просто надіслати 0981234567) ──
    var digitsOnly = text.replace(/\D/g,"");
    var phoneMatch = digitsOnly.length >= 9 && digitsOnly.length <= 13;
    if (phoneMatch) {
      var qPhone = "0" + digitsOnly.slice(-9);
      var results = [];

      // Перевірка CRM
      var ssCrm   = SpreadsheetApp.openById(MAIN_FILE_ID);
      var sheetCrm = ssCrm.getSheetByName(MAIN_SHEET);
      var lastRow  = sheetCrm.getLastRow();
      if (lastRow >= DATA_START) {
        var allData = sheetCrm.getRange(DATA_START, 1, lastRow-DATA_START+1, MAIN_LAST_COL).getValues();
        for (var di=0; di<allData.length; di++) {
          var ph = allData[di][COL.PHONE-1] ? allData[di][COL.PHONE-1].toString().replace(/\D/g,"").slice(-9) : "";
          if (ph.length >= 8 && ph === qPhone.slice(-9)) {
            var dupDateRaw = allData[di][COL.DATE-1];
            var dupDate    = dupDateRaw instanceof Date
              ? Utilities.formatDate(dupDateRaw, Session.getScriptTimeZone(), "dd.MM.yyyy")
              : (dupDateRaw ? dupDateRaw.toString().substring(0,10) : "—");
            results.push(
              "📋 Знайдено в CRM:\n"+
              "ID: "+       (allData[di][COL.ID-1]      || "—")+"\n"+
              "ПІБ: "+      (allData[di][COL.NAME-1]    || "—")+"\n"+
              "Дата: "+     dupDate+"\n"+
              "Менеджер: "+ (allData[di][COL.MANAGER-1] || "—")+"\n"+
              "Статус: "+   (allData[di][COL.STATUS-1]  || "—")+"\n"+
              "Оновлений статус: "+ (allData[di][COL.NEW_STATUS-1] || "—")
            );
            break;
          }
        }
      }

      // Перевірка 1С
      var ons = check1CByPhone(qPhone);
      if (ons) {
        results.push(
          "🏭 Знайдено в базі 1С:\n"+
          "Код: "+   ons.code+"\n"+
          "ПІБ: "+   ons.name+"\n"+
          "Агент: "+ ons.agent+"\n"+
          "Дата: "+  ons.date
        );
      }

      if (results.length > 0) {
        sendViber(sender.id, "🔍 Перевірка номера "+qPhone+":\n\n"+results.join("\n\n"));
      } else {
       sendViber(sender.id,
          "❌ Номер "+qPhone+" не знайдено ні в CRM, ні в базі 1С.\n\n"+
          "Щоб додати ліда — напишіть команду /шаблон\nабо перейдіть за посиланням:\nhttps://ltexlutskai-tech.github.io/ltex-leads/"
        );
      }
      return okResponse();
    }

    return okResponse();
  } catch(err) { Logger.log("doPost: "+err); return okResponse(); }
}

// ── НОВИЙ: /довідник через бота ──────────────────────────
// Формат: /довідник
// Тип: статус
// Значення: Нове значення

function handleDictionaryCommand(text, sender) {
  try {
    var lines = text.split("\n").map(function(l){return l.trim();}).filter(function(l){return l.length>0;});
    function getField(key){
      var line=lines.find(function(l){return l.toLowerCase().indexOf(key.toLowerCase()+":")===0;});
      return line?line.substring(line.indexOf(":")+1).trim():"";
    }
    var type  = getField("тип");
    var value = getField("значення");
    if (!type||!value) {
      sendViber(sender.id,
        "Формат команди /довідник:\n\n"+
        "/довідник\nТип: статус\nЗначення: Нове значення\n\n"+
        "Доступні типи:\n  статус, категорія, активність, канал, оновлений статус");
      return;
    }
    var typeMap = {
      "статус":"B","статуси":"B",
      "категорія":"C","категорії":"C",
      "активність":"D","активності":"D",
      "канал":"E","канали":"E",
      // ── v6.5 ──
      "оновлений статус":"F","оновлений":"F","новий статус":"F","актуалізація":"F"
    };
    var col = typeMap[type.toLowerCase()];
    if (!col) {
      sendViber(sender.id,"Невірний тип. Доступні: статус, категорія, активність, канал, оновлений статус");
      return;
    }
    var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
    var refSheet = ss.getSheetByName("Довідники");
    if (!refSheet) { sendViber(sender.id,"Аркуш Довідники не знайдено"); return; }
    // Перевіряємо дублікат
    var colData = refSheet.getRange(col+"2:"+col+"100").getValues().flat().filter(String);
    if (colData.map(function(v){return v.toLowerCase();}).indexOf(value.toLowerCase())!==-1) {
      sendViber(sender.id,'"'+value+'" вже є в довіднику!');
      return;
    }
    // Додаємо в перший порожній рядок стовпця
    var lastUsed = 1;
    for (var r=2;r<=100;r++) {
      if (refSheet.getRange(col+r).getValue()) lastUsed=r;
    }
    refSheet.getRange(col+(lastUsed+1)).setValue(value);
    // Синхронізуємо в усі файли менеджерів
    syncDictionary();
    sendViber(sender.id,"✅ Додано в довідник ("+type+"): "+value+"\nОновлено у всіх менеджерів!");
    Logger.log("Довідник: "+type+" → "+value);
  } catch(err) { Logger.log("handleDictionaryCommand: "+err); sendViber(sender.id,"Помилка: "+err.toString()); }
}


// ── doGet ─────────────────────────────────────────────────

function doGet(e) {
  if (e&&e.parameter&&e.parameter.action==="parse") return handleParseRequest(e.parameter);
  return ContentService.createTextOutput('{"status":"ok"}').setMimeType(ContentService.MimeType.JSON);
}


// ── Парсер лідів для HTML сторінки ───────────────────────

function handleParseRequest(data) {
  try {
    var text      = data.text      || "";
    var image     = data.image     || "";
    var imageMime = data.imageMime || "image/jpeg";
    var content   = [];
    if (image) content.push({type:"image",source:{type:"base64",media_type:imageMime,data:image}});
    content.push({type:"text",text:
      (text?"Текст:\n"+text+"\n\n":"")+
      "Витягни дані клієнта і поверни ТІЛЬКИ валідний JSON без коментарів та без markdown:\n"+
      '{"name":"","phone":"","region":"","city":"","interest":"","category":"","channel":"","date":"","site":""}\n\n'+

      "=== ПРАВИЛА ЗАПОВНЕННЯ ===\n\n"+


      "ГОЛОВНЕ ПРАВИЛО: якщо інформації для поля НЕ ЗНАЙДЕНО — залишай поле порожнім \"\". "+
      "НІКОЛИ не вигадуй, не припускай і не підставляй значення за замовчуванням.\n\n"+

      "name — повне ім'я або нікнейм клієнта. Якщо не знайдено — \"\".\n\n"+

      "phone — тільки якщо є чіткий номер телефону. "+
      "ДУЖЕ ВАЖЛИВО: зчитуй кожну цифру окремо і уважно — не пропускай і не переставляй цифри. "+
      "Формат результату: рівно 10 цифр, починається з 0. "+
      "Конвертація: якщо номер починається з +380 або 380 — прибери +38 або 38, залишиться 10 цифр з 0. "+
      "Приклад: +380636412512 → 0636412512, 380965832697 → 0965832697. "+
      "Якщо не впевнений у якійсь цифрі — залишай поле порожнім \"\". "+
"Якщо номера немає — \"\".\n\n"+

      "region — область України (тільки якщо чітко вказано або однозначно випливає з міста). "+
      "Формат: «Київська», «Львівська» тощо. Якщо не визначено — \"\".\n\n"+

      "city — місто або населений пункт тільки якщо явно вказано. Якщо не вказано — \"\".\n\n"+

      "interest — ВСЯ корисна інформація для менеджера, яка не є контактними даними чи класифікацією. "+
      "Сюди входить: що цікавить клієнта, який товар шукає, назва товару, артикул, штрихкод, код продукту, "+
      "ціна або бюджет, кількість, побажання, запитання клієнта, суть звернення, будь-який коментар. "+
      "ВАЖЛИВО: передавай текст ДОСЛІВНО як є в оригіналі — не скорочуй, не перефразовуй, не підсумовуй. "+
      "Якщо є кілька елементів — перелічуй через «; ». Якщо нічого корисного немає — \"\".\n\n"+

      "category — категорія торгової точки клієнта. "+
      "Заповнюй ТІЛЬКИ якщо в тексті є чіткі ознаки: "+
      "«Інтернет» (є інтернет-магазин/сайт), "+
      "«Магазин» (є фізичний магазин), "+
      "«Хоче почати» (починає бізнес, ще не торгує), "+
      "«TikTok/Ефір» (продає через TikTok ефір), "+
      "«Ринок стаціонарний» (торгує на ринку), "+
      "«Для себе» (купує для особистого використання), "+
      "«Виїздна торгівля» (торгує на виїзді/ярмарках). "+
      "Якщо жодна ознака не присутня явно — обов'язково залишай \"\".\n\n"+

      "channel — канал, через який клієнт знайшов компанію. "+
      "Заповнюй ТІЛЬКИ якщо клієнт або контекст явно вказує звідки він: "+
      "«TikTok», «TikTok Ефір», «Google», «OLX», «Instagram», «YouTube», «bricabrac», «Рекомендація», «Інше». "+
      "Якщо джерело не вказано — обов'язково залишай \"\".\n\n"+

      "date — дата звернення або заявки у форматі YYYY-MM-DD. "+
      "Якщо не вказано — \"\".\n\n"+

      "site — посилання на сторінки клієнта в соцмережах або інтернет-магазин. "+
      "Збирай ВСІ знайдені посилання: TikTok, Instagram, Telegram (t.me), Facebook, YouTube, OLX, сайти тощо. "+
      "Якщо кілька — через « | ». Якщо посилань немає — \"\"."
    });
    var resp = UrlFetchApp.fetch("https://api.anthropic.com/v1/messages",{
      method:"post",
      headers:{"Content-Type":"application/json","x-api-key":ANTHROPIC_KEY,"anthropic-version":"2023-06-01"},
      payload:JSON.stringify({model:"claude-sonnet-4-5-20250929",max_tokens:1500,messages:[{role:"user",content:content}]}),
      muteHttpExceptions:true
    });
    var result = JSON.parse(resp.getContentText());
    var out = result.content&&result.content[0] ? result.content[0].text : "{}";
    // Очищаємо markdown якщо модель все ж додала ```json ... ```
    out = out.replace(/^```[a-z]*\s*/i,"").replace(/```\s*$/,"").trim();
    return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    Logger.log("handleParseRequest: "+err);
    return ContentService.createTextOutput('{"error":"'+err.toString()+'"}').setMimeType(ContentService.MimeType.JSON);
  }
}


// ── Реєстрація ────────────────────────────────────────────

function handleRegistration(text,sender) {
  try {
    var lines=text.split("\n").map(function(l){return l.trim();}).filter(function(l){return l.length>0;});
    function getField(key){
      var line=lines.find(function(l){return l.toLowerCase().indexOf(key.toLowerCase()+":")===0;});
      return line?line.substring(line.indexOf(":")+1).trim():"";
    }
    var name=getField("ім'я")||getField("імя")||getField("name");
    var role=getField("роль")||"менеджер";
    var fileId=getField("файл")||getField("file")||"";
    if (!name) { sendViber(sender.id,"Не знайдено ім'я.\n\nФормат:\n/реєстрація\nІм'я: Петренко Олег\nРоль: менеджер\nФайл: ID"); return; }
    var managers=getManagers();
    if (managers[name]) { sendViber(sender.id,'Менеджер "'+name+'" вже зареєстрований!'); return; }
    addManagerToSheet(name,role,"",fileId);
    if (fileId&&role==="менеджер") setupManagerFile(fileId,name);
    sendViber(sender.id,"✅ "+name+" зареєстровано як "+role+"!\n\nПопроси "+name+" написати боту /старт для реєстрації Viber ID.");
  } catch(err) { Logger.log("handleRegistration: "+err); sendViber(sender.id,"Помилка: "+err.toString()); }
}

function handleNewUserStart(sender) {
  try {
    var ss=SpreadsheetApp.openById(MAIN_FILE_ID);
    var sheet=ss.getSheetByName(MGR_SHEET);
    if (!sheet) { sendViber(sender.id,"Система не налаштована."); return; }
    var lastRow=sheet.getLastRow();
    if (lastRow<2) { sendViber(sender.id,"Вас не знайдено. Зверніться до адміністратора."); return; }
    var data=sheet.getRange(2,1,lastRow-1,6).getValues();
    var found=false;
    for (var i=0;i<data.length;i++) {
      var vid=data[i][MGR_COL.VIBER_ID-1]?data[i][MGR_COL.VIBER_ID-1].toString().trim():"";
      if (vid===sender.id) { sendViber(sender.id,"Вітаємо, "+data[i][0]+"! Ви вже зареєстровані."); found=true; break; }
    }
    if (!found) {
      // Автозаповнення Viber ID якщо ім'я менеджера збігається
      for (var j=0;j<data.length;j++) {
        var existingVid=data[j][MGR_COL.VIBER_ID-1]?data[j][MGR_COL.VIBER_ID-1].toString().trim():"";
        if (!existingVid) {
          // Питаємо адміна підтвердити
          break;
        }
      }
      var pendingSheet=ss.getSheetByName("_pending");
      if (!pendingSheet) { pendingSheet=ss.insertSheet("_pending"); pendingSheet.hideSheet(); }
      pendingSheet.appendRow([sender.id,sender.name,new Date()]);
      sendViber(sender.id,"Ваш запит отримано!\nВаш Viber ID: "+sender.id);
      sendViber(ADMIN_VIBER_ID,"Новий запит реєстрації!\nІм'я: "+sender.name+"\nViber ID: "+sender.id+"\n\nВстав ID в аркуш \"⚙️ Менеджери\", колонка C (Viber ID).");
    }
  } catch(err) { Logger.log("handleNewUserStart: "+err); }
}

function setupManagerFile(fileId,managerName) {
  try {
    var ss=SpreadsheetApp.openById(fileId);
    var sheet=ss.getSheets()[0];
    // ── v6.5: 18 колонок — додано «Оновлений статус» (Q) та «Коментар» (R) ──
    var headers=["ID","Дата","ПІБ контрагента","Категорія ТТ","Область","Місто","Номер тел.",
                 "Цікавить","Перший контакт","Активність","Статус дії","Канал пошуку",
                 "Інет сторінка","Telegram","Рік","⚠️ Дублі телефону",
                 HDR_NEW_STATUS, HDR_NEW_COMMENT];
    sheet.clearContents(); sheet.setName("Клієнти");
    sheet.getRange(1,1,1,MGR_LAST_COL).merge().setValue("👤 "+managerName+" — Мої клієнти | L-TEX").setFontWeight("bold").setFontSize(13).setHorizontalAlignment("center");
    sheet.getRange(2,1,1,MGR_LAST_COL).merge().setValue("⚠️ Цей файл призначений ТІЛЬКИ для вас.").setFontStyle("italic");
    sheet.getRange(4,1,1,headers.length).setValues([headers]).setFontWeight("bold").setBackground("#2E6DA4").setFontColor("#FFFFFF").setWrap(true);
    sheet.setFrozenRows(4);
    sheet.getRange("K5:K5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Готово","Очікує","НПТ","вилучити"],true).setAllowInvalid(true).build());
    sheet.getRange("D5:D5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Інтернет","Магазин","Хоче почати","TikTok/Ефір","Ринок стаціонарний","Для себе","Виїздна торгівля"],true).setAllowInvalid(true).build());
    sheet.getRange("J5:J5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["переписка Viber","Переписка Telegram","карточка клієнта","НПТ","вилучити"],true).setAllowInvalid(true).build());
    sheet.getRange("L5:L5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["TikTok","TikTok Ефір","Google","OLX","Instagram","YouTube","bricabrac","Рекомендація","Інше"],true).setAllowInvalid(true).build());
    // ── v6.5: Оновлений статус (Q) + Коментар (R) ──
    sheet.getRange("Q5:Q5000").setDataValidation(newStatusRule_());
    sheet.getRange("R5:R5000").setWrap(true);
    sheet.setColumnWidth(MGR_COL_NEW_STATUS, 150);
    sheet.setColumnWidth(MGR_COL_NEW_COMMENT, 300);
    // Підсвітка дублів в колонці G (телефон)
    var dupsRule = SpreadsheetApp.newConditionalFormatRule()
      .withCriteria(SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA, ['=COUNTIF($G$5:$G$5000,G5)>1'])
      .setBackground("#FF6B6B").setFontColor("#FFFFFF")
      .setRanges([sheet.getRange("G5:G5000")]).build();
    sheet.setConditionalFormatRules([dupsRule]);
    Logger.log("✅ Файл "+managerName+" налаштовано з "+MGR_LAST_COL+" колонками");
    return true;
  } catch(err) { Logger.log("setupManagerFile: "+err); return false; }
}


// ── Синхронізація ─────────────────────────────────────────

function handleSyncFromManager(data) {
  try {
    var rowId   = data.rowId;
    var rowData = data.rowData;
    var action  = data.action;

    var ss    = SpreadsheetApp.openById(MAIN_FILE_ID);
    var sheet = ss.getSheetByName(MAIN_SHEET);
    if (!sheet) return;

    var idColData = sheet.getRange(DATA_START, COL.ID, sheet.getLastRow()-DATA_START+1, 1).getValues();
    var targetRow = -1;
    for (var i = 0; i < idColData.length; i++) {
      if (idColData[i][0] && idColData[i][0].toString() === rowId) {
        targetRow = DATA_START + i; break;
      }
    }
    if (targetRow === -1) { Logger.log("Рядок " + rowId + " не знайдено"); return; }

    if (action === "delete") {
      sheet.getRange(targetRow, COL.STATUS).setValue("вилучити");
      return;
    }

    if (action === "update" && rowData) {
      // Маппінг: індекс у rowData (0-based) → колонка в головній (COL.*)
      // Файл менеджера:  col3=ПІБ, col4=Кат, col5=Обл, col6=Місто, col7=Тел,
      //                  col9=Перший контакт, col10=Активність, col11=Статус,
      //                  col12=Канал, col13=Сторінка, col14=TG,
      //                  col17=Оновлений статус, col18=Коментар (v6.5)
      var mapping = [
        { idx: 2,  col: COL.NAME        },  // ПІБ контрагента
        { idx: 3,  col: COL.CAT         },  // Категорія ТТ
        { idx: 4,  col: COL.REGION      },  // Область
        { idx: 5,  col: COL.CITY        },  // Місто
        { idx: 6,  col: COL.PHONE       },  // Номер тел.
        { idx: 8,  col: COL.CONTACT     },  // Перший контакт
        { idx: 9,  col: COL.ACTIVITY    },  // Активність
        { idx: 10, col: COL.STATUS      },  // Статус дії
        { idx: 11, col: COL.CHANNEL     },  // Канал пошуку
        { idx: 12, col: COL.SITE        },  // Інет сторінка
        { idx: 13, col: COL.TG          },  // Telegram
        { idx: 16, col: COL.NEW_STATUS  },  // v6.5 Оновлений статус
        { idx: 17, col: COL.NEW_COMMENT },  // v6.5 Коментар (результат розмови)
      ];

      for (var m = 0; m < mapping.length; m++) {
        var val = rowData[mapping[m].idx];
        if (val !== undefined && val !== null) {
          var cell = sheet.getRange(targetRow, mapping[m].col);
          cell.setValue(val);
          // Телефон зберігаємо як текст
          if (mapping[m].col === COL.PHONE) cell.setNumberFormat("@");
        }
      }

      Logger.log("Оновлено рядок " + rowId + " від менеджера");
    }
  } catch(err) { Logger.log("handleSyncFromManager: " + err); }
}

function syncToManager(rowData,rowId,fileId,managerName) {
  if (!fileId) { Logger.log(managerName+" не має файлу"); return true; }
  try {
    var ss=SpreadsheetApp.openById(fileId);
    var sheet=ss.getSheets()[0];
    var lastRow=sheet.getLastRow(), targetRow=-1;
    if (lastRow>=5) {
      var idData=sheet.getRange(5,1,lastRow-4,1).getValues();
      for (var i=0;i<idData.length;i++) {
        if (idData[i][0]&&idData[i][0].toString()===rowId) { targetRow=i+5; break; }
      }
    }
    var formatted=rowData.map(function(cell){
      if (cell instanceof Date) return Utilities.formatDate(cell,Session.getScriptTimeZone(),"dd.MM.yyyy");
      return cell;
    });
    // Маппінг: ГОЛОВНА (19 кол) → МЕНЕДЖЕР (18 кол)
    // Головна:  1  2  3  4  5  6  7  8  9  10  [11=Менеджер-SKIP]  12  13  14  15  16=Дублі  17=Рік  18=Онов.статус 19=Коментар
    // Менеджер: 1  2  3  4  5  6  7  8  9  10   11=Статус            12  13  14  15=Рік       16=Дублі 17=Онов.статус 18=Коментар
    var mgrFormatted = [];
    // Cols 1-10: ID..Активність (індекси 0-9)
    for (var c=0;c<10;c++) mgrFormatted.push(formatted[c]||"");
    // Col 11 головної = Менеджер → ПРОПУСКАЄМО (індекс 10)
    // Cols 12-15 головної = Статус,Канал,Сторінка,TG (індекси 11-14)
    for (var c=11;c<15;c++) mgrFormatted.push(formatted[c]||"");
    // Col 17 головної = Рік (індекс 16)
    mgrFormatted.push(formatted[16]||"");
    // Col 16 головної = Дублі (індекс 15) — ставимо в кінець (col 16 менеджера)
    mgrFormatted.push(formatted[15]||"");
    // ── v6.5: Оновлений статус (індекс 17) → col 17, Коментар (індекс 18) → col 18
    mgrFormatted.push(formatted[17]||"");
    mgrFormatted.push(formatted[18]||"");

    if (targetRow===-1) {
      if (mgrFormatted.length > 8) mgrFormatted[8]="";  // Перший контакт
      if (mgrFormatted.length > 9) mgrFormatted[9]="";  // Активність
      sheet.appendRow(mgrFormatted);
      targetRow=sheet.getLastRow();
    } else {
      var existingRow=sheet.getRange(targetRow,1,1,Math.max(mgrFormatted.length,10)).getValues()[0];
      if (mgrFormatted.length > 8) mgrFormatted[8]=existingRow[8];  // Зберігаємо Перший контакт
      if (mgrFormatted.length > 9) mgrFormatted[9]=existingRow[9];  // Зберігаємо Активність
      // ── v6.5: колонки обдзвону заповнює менеджер у своєму файлі.
      // Якщо в головній порожньо — НЕ затираємо те, що вже ввів менеджер.
      if (mgrFormatted.length > 16 && mgrFormatted[16]==="") mgrFormatted[16]=existingRow[16]||"";
      if (mgrFormatted.length > 17 && mgrFormatted[17]==="") mgrFormatted[17]=existingRow[17]||"";
      sheet.getRange(targetRow,1,1,mgrFormatted.length).setValues([mgrFormatted]);
    }
    sheet.getRange(targetRow,7).setNumberFormat("@");
    return true;
  } catch(err) { Logger.log("syncToManager ("+managerName+"): "+err); return false; }
}

function parseAndSave(text,sender) {
  try {
    var lines=text.split("\n").map(function(l){return l.trim();}).filter(function(l){return l.length>0;});
    function getField(keys){
      var allKeys=["ім'я","імя","name","телефон","тел","область","регіон","місто",
                   "категорія","канал","посилання","сайт","інет сторінка","сторінка",
                   "цікавить","контакт","менеджер","дата"];
      for (var i=0;i<keys.length;i++){
        var k=keys[i].toLowerCase();
        var values=[];
        var capturing=false;
        for (var j=0;j<lines.length;j++){
          var lineLow=lines[j].toLowerCase();
          if (lineLow.indexOf(k+":")===0){
            var val=lines[j].substring(lines[j].indexOf(":")+1).trim();
            capturing=true;
            if (val){ values.push(val); }
            else if (j+1<lines.length&&lines[j+1].trim().match(/^https?:\/\//i)){
              values.push(lines[j+1].trim()); capturing=false;
            }
          } else if (capturing){
            var isNewKey=false;
            for (var kk=0;kk<allKeys.length;kk++){
              if (lineLow.indexOf(allKeys[kk]+":")===0){ isNewKey=true; break; }
            }
            if (isNewKey){ capturing=false; }
            else{ values.push(lines[j]); }
          }
        }
        if (values.length>0) return values.join("; ");
      }
      return "";
    }
    var name    = getField(["ім'я","імя","name"]);
    var phone   = getField(["телефон","тел"]);
    // Нормалізуємо телефон: 380xxxxxxxxx → 0xxxxxxxxx
    if (phone) {
      var digitsOnly = phone.replace(/\D/g,"");
      if (digitsOnly.length === 12 && digitsOnly.startsWith("380")) {
        phone = "0" + digitsOnly.substring(3);
      } else if (digitsOnly.length === 11 && digitsOnly.startsWith("38")) {
        phone = "0" + digitsOnly.substring(2);
      }
    }
    var region  = getField(["область","регіон"]);
    var city    = getField(["місто"]);
    var category= getField(["категорія"]);
    var channel = getField(["канал"]);
    var site    = getField(["посилання","сайт","інет сторінка","сторінка"]);
    var interest= getField(["цікавить"]);
    var contact = getField(["контакт"]);
    var manager = getField(["менеджер"]);
    var dateVal = new Date();
    var dateStr = getField(["дата"]);
    if (dateStr) {
      var p=dateStr.split(".");
      if (p.length===3) { var d=new Date(parseInt(p[2]),parseInt(p[1])-1,parseInt(p[0])); if (!isNaN(d.getTime())) dateVal=d; }
    }

    if (!name)    return {success:false,error:"Не знайдено поле 'Ім'я:'"};
    if (!phone)   return {success:false,error:"Не знайдено поле 'Телефон:'"};
    if (!manager) return {success:false,error:"Не знайдено поле 'Менеджер:'"};

    var managers = getManagers();
    if (!managers[manager]) return {success:false,error:'Менеджер "'+manager+'" не знайдений.\nДоступні: '+Object.keys(managers).join(", ")};

    // ── Захист від дублів з блокуванням до кінця збереження ──
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(8000)) return {success:false, error:"Система зайнята, спробуй ще раз"};

    try {
      var ss    = SpreadsheetApp.openById(MAIN_FILE_ID);
      var sheet = ss.getSheetByName(MAIN_SHEET);
      var lastR = sheet.getLastRow();

     // Перевірка дубля по телефону (CRM)
      if (lastR >= DATA_START && phone) {
        var allData = sheet.getRange(DATA_START, 1, lastR-DATA_START+1, MAIN_LAST_COL).getValues();
        for (var di = 0; di < allData.length; di++) {
         var ph = allData[di][COL.PHONE-1] ? allData[di][COL.PHONE-1].toString().trim().replace(/\D/g,"").slice(-9) : "";
          var phone9 = phone.replace(/\D/g,"").slice(-9);
          if (ph.length >= 8 && ph === phone9) {
            var dupId      = allData[di][COL.ID-1]      || "—";
            var dupName    = allData[di][COL.NAME-1]    || "—";
            var dupMgr     = allData[di][COL.MANAGER-1] || "—";
            var dupDateRaw = allData[di][COL.DATE-1];
            var dupDate    = dupDateRaw instanceof Date
              ? Utilities.formatDate(dupDateRaw, Session.getScriptTimeZone(), "dd.MM.yyyy")
              : (dupDateRaw ? dupDateRaw.toString().substring(0,10) : "—");

            // ── v6.3: сповіщаємо менеджера який веде цього клієнта ──
            var dupRegion  = allData[di][COL.REGION-1]  || "—";
            var dupCity    = allData[di][COL.CITY-1]    || "—";
            var dupInterest= allData[di][COL.INTEREST-1]|| "—";
            var dupPhone   = allData[di][COL.PHONE-1]   || "—";
            if (dupMgr && dupMgr !== "—" && managers[dupMgr] && managers[dupMgr].viberId) {
              sendViber(managers[dupMgr].viberId,
                "🔁 Повторний запит!\n\n"+
                "ID: "+dupId+"\n"+
                "Ім'я: "+dupName+"\n"+
                "Телефон: "+dupPhone+"\n"+
                "Область: "+dupRegion+"\n"+
                "Місто: "+dupCity+"\n"+
                "Цікавить: "+dupInterest
              );
            }

            return {success:false, error:
              "⚠️ Клієнт з таким телефоном вже є в CRM!\n"+
              "ID: "+dupId+"\nПІБ: "+dupName+"\nДата: "+dupDate+"\nМенеджер: "+dupMgr
            };
          }
        }
      }

      // Перевірка дубля по телефону (база 1С)
      var ons = check1CByPhone(phone);
      if (ons) {
        // Якщо торговий агент із 1С є зареєстрованим менеджером — сповіщаємо його
        var onsAgent = ons.agent ? ons.agent.toString().trim() : "";
        if (onsAgent && onsAgent !== "—" && managers[onsAgent] && managers[onsAgent].viberId) {
          sendViber(managers[onsAgent].viberId,
            "🔁 Повторний запит (клієнт є в базі 1С)!\n\n"+
            "Код 1С: "+ons.code+"\n"+
            "ПІБ: "+ons.name+"\n"+
            "Телефон: "+phone+"\n"+
            "Місто: "+ons.city+"\n"+
            "Торговий агент: "+ons.agent+"\n"+
            "Дата в 1С: "+ons.date
          );
        }
        return {success:false, error:
          "⚠️ Клієнт знайдений в базі 1С!\n"+
          "Код 1С: "+ons.code+"\nПІБ: "+ons.name+
          "\nТорговий агент: "+ons.agent+"\nДата: "+ons.date+
          "\n\nЯкщо це новий контакт — зверніться до адміна."
        };
      }

      // Зберігаємо (всередині lock!)
      var newId = generateId();
      // 19 колонок: останні дві (Оновлений статус, Коментар) заповнює менеджер під час обдзвону
      var row = [newId,Utilities.formatDate(dateVal,Session.getScriptTimeZone(),"dd.MM.yyyy"),name,category,region,city,phone,interest,contact,"Viber бот",manager,"Очікує",channel,site,"","",dateVal.getFullYear(),"",""];
      var lr = sheet.getLastRow() + 1;
      sheet.getRange(lr, COL.PHONE).setNumberFormat("@");
      sheet.getRange(lr, 1, 1, row.length).setValues([row]);

    } finally {
      lock.releaseLock();
    }

    // Синхронізація і сповіщення (поза lock — не блокуємо довго)
    var mgr = managers[manager];
    syncToManager(row,newId,mgr.fileId,manager);
    var registrar = (sender && sender.name) ? sender.name : "невідомо";
    var senderId = (sender && sender.id) ? sender.id : "";
    Logger.log("parseAndSave: notifyOwners → ID="+newId+", менеджер="+manager+", registrar="+registrar+", senderId="+senderId);
    notifyOwners("Клієнт збережений!\nID: "+newId+"\nІм'я: "+name+"\nМенеджер: "+manager+"\nДодав: "+registrar);
    // Сповіщаємо менеджера завжди, окрім випадку коли він сам додав через свій особистий Viber
    var senderIsManager = senderId && mgr.viberId && senderId === mgr.viberId;
    if (mgr.viberId && !senderIsManager) {
      sendViber(mgr.viberId,"Новий клієнт призначено тобі!\n\nID: "+newId+"\nІм'я: "+name+"\nТелефон: "+phone+"\nОбласть: "+(region||"—")+"\nМісто: "+(city||"—")+"\nЦікавить: "+(interest||"—"));
    }
    Logger.log("parseAndSave: сповіщення менеджеру "+(senderIsManager?"ПРОПУЩЕНО (сам додав)":"НАДІСЛАНО → "+mgr.viberId));
    return {success:true,id:newId,name:name,manager:manager,row:lr};

  } catch(err) { Logger.log("parseAndSave: "+err); return {success:false,error:err.toString()}; }
}



// ╔══════════════════════════════════════════════════════════╗
// ║         Gmail-інтеграція: автозапис лідів з пошти       ║
// ╚══════════════════════════════════════════════════════════╝
//
// Запуск: один раз вручну викликати setupEmailTrigger()
// Після цього processIncomingEmails() запускатиметься кожні 5 хв
// При першому запуску скрипт попросить дозвіл на доступ до Gmail

function processIncomingEmails() {
  try {
    // Зберігаємо оброблені ID повідомлень в Script Properties
    var props = PropertiesService.getScriptProperties();
    var processedRaw = props.getProperty("processed_msg_ids") || "{}";
    var processedIds = JSON.parse(processedRaw);

    // Очищаємо записи старіші за 30 днів
    var now = Date.now();
    var cleaned = {};
    for (var pid in processedIds) {
      if (now - processedIds[pid] < 30 * 24 * 60 * 60 * 1000) cleaned[pid] = processedIds[pid];
    }
    processedIds = cleaned;

    // Шукаємо непрочитані без фільтра по мітці треда
    var queries = [
      'subject:"[POPUP] Заявка з форми підписки" is:unread',
      'from:submissions@formsubmit.co subject:"Запит на каталог" is:unread',
      'from:submissions@formsubmit.co subject:"Запит на консультацію" is:unread',
    ];

    var managers = getManagers();
    var processedCount = 0;

    for (var q = 0; q < queries.length; q++) {
      var threads = GmailApp.search(queries[q], 0, 20);
      for (var t = 0; t < threads.length; t++) {
        var thread = threads[t];
        var messages = thread.getMessages();
        for (var m = 0; m < messages.length; m++) {
          var msg = messages[m];
          if (!msg.isUnread()) continue;

          // Перевіряємо чи вже оброблено це конкретне повідомлення
          var msgId = msg.getId();
          if (processedIds[msgId]) { msg.markRead(); continue; }

          var subject = msg.getSubject();
          var body    = msg.getPlainBody();
          var emailData = parseEmailLead(subject, body);
          if (!emailData) { msg.markRead(); continue; }

          emailData.manager = ADMIN_MANAGER; // Gmail ліди завжди до адміна для ручного розподілу

          // ── Перевірка дубля перед сповіщенням ──
          var alreadyInCRM = false;
          if (emailData.phone) {
            var ssDup = SpreadsheetApp.openById(MAIN_FILE_ID);
            var shDup = ssDup.getSheetByName(MAIN_SHEET);
            var lastRDup = shDup.getLastRow();
            if (lastRDup >= DATA_START) {
              var ph9dup = emailData.phone.replace(/\D/g,"").slice(-9);
              var dupData = shDup.getRange(DATA_START,1,lastRDup-DATA_START+1,MAIN_LAST_COL).getValues();
              for (var dd=0; dd<dupData.length; dd++) {
                var phd = dupData[dd][COL.PHONE-1] ? dupData[dd][COL.PHONE-1].toString().replace(/\D/g,"").slice(-9) : "";
                if (phd.length>=8 && phd===ph9dup) { alreadyInCRM=true; break; }
              }
            }
          }
          if (alreadyInCRM) {
            Logger.log("Gmail: дубль з Gmail — "+emailData.phone);
            // Сповіщаємо менеджера який веде цього клієнта
            for (var dd2=0; dd2<dupData.length; dd2++) {
              var phd2 = dupData[dd2][COL.PHONE-1] ? dupData[dd2][COL.PHONE-1].toString().replace(/\D/g,"").slice(-9) : "";
              if (phd2.length>=8 && phd2===ph9dup) {
                var dupMgr2 = dupData[dd2][COL.MANAGER-1] ? dupData[dd2][COL.MANAGER-1].toString().trim() : "";
                if (dupMgr2 && managers[dupMgr2] && managers[dupMgr2].viberId) {
                  sendViber(managers[dupMgr2].viberId,
                    "🔁 Повторний запит з сайту!\n\n"+
                    "ID: "+(dupData[dd2][COL.ID-1]||"—")+"\n"+
                    "Ім'я: "+(dupData[dd2][COL.NAME-1]||"—")+"\n"+
                    "Телефон: "+emailData.phone+"\n"+
                    "Область: "+(emailData.region||"—")+"\n"+
                    "Цікавить: "+emailData.interest
                  );
                }
                break;
              }
            }
            msg.markRead();
            continue;
          }

          // ── Сповіщення адміну (без збереження в CRM) ──
          var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd.MM.yyyy");
          // Визначаємо менеджера тільки при точному співпадінні області
          var regionKey = emailData.region ? emailData.region.toString().trim().toLowerCase() : "";
          var detectedMgr = (regionKey && REGION_TO_MANAGER[regionKey]) ? REGION_TO_MANAGER[regionKey] : "—";

          // Повідомлення 1 — всі дані
          var infoMsg =
            "📧 Новий лід з сайту ("+emailData.channel+")\n\n"+
            "Ім'я: "+emailData.name+"\n"+
            "Телефон: "+emailData.phone+"\n"+
            (emailData.region ? "Область: "+emailData.region+"\n" : "")+
            (emailData.city   ? "Місто: "+emailData.city+"\n"     : "")+
            "Канал: "+emailData.channel+"\n"+
            "Дата: "+today+"\n"+
            "Менеджер: "+detectedMgr+"\n"+
            "Цікавить: "+emailData.interest;
          notifyOwners(infoMsg);

          // Повідомлення 2 — готовий шаблон для копіювання і вставки в парсер
          var templateMsg =
            "Ім'я: "+emailData.name+"\n"+
            "Телефон: "+emailData.phone+"\n"+
            (emailData.region ? "Область: "+emailData.region+"\n" : "")+
            (emailData.city   ? "Місто: "+emailData.city+"\n"     : "")+
            "Канал: "+emailData.channel+"\n"+
            "Дата: "+today+"\n"+
            "Менеджер: "+(detectedMgr !== "—" ? detectedMgr : "");
          notifyOwners(templateMsg);

          // Повідомлення 3 — посилання на парсер
          notifyOwners(
            "⚠️ Перепризначте менеджера через парсер:\n"+
            "https://ltexlutskai-tech.github.io/ltex-leads/"
          );

          Logger.log("Gmail: сповіщено адміна — "+emailData.name+", "+emailData.phone);
          processedCount++;

          // Зберігаємо ID повідомлення як оброблене
          processedIds[msgId] = Date.now();
          msg.markRead();
        }
      }
    }

    // Зберігаємо оновлений список оброблених ID
    props.setProperty("processed_msg_ids", JSON.stringify(processedIds));

    if (processedCount > 0) Logger.log("Gmail: оброблено "+processedCount+" нових лідів");
  } catch(err) { Logger.log("processIncomingEmails: "+err); }
}

function parseEmailLead(subject, body) {
  var subjectLow = subject.toLowerCase();
  var name   = extractEmailField(body, ["name","ім'я","імя"]);
  var phone  = extractEmailField(body, ["phone","телефон","тел"]);
  var region = extractEmailField(body, ["region","область","регіон"]);
  var city   = extractEmailField(body, ["city","місто"]);

  if (phone) {
    var d = phone.replace(/\D/g,"");
    if      (d.length >= 12 && d.startsWith("380")) d = "0" + d.substring(3);
    else if (d.length === 11 && d.startsWith("38"))  d = "0" + d.substring(2);
    else if (d.length === 9)                          d = "0" + d;
    phone = d;
  }

  if (!name && !phone) return null;

  var interest = "";
  var channel  = "";

  if (subjectLow.indexOf("[popup] заявка з форми підписки") !== -1) {
    interest = "Заповнив(ла) форму, щоб отримати доступ до телеграм каналу bric a brac. Потрібно скинути посилання на канал, каталог та уточнити чи вдалось перейти в канал та чи все зрозуміло";
    channel  = "bricabrac";
  }
  else if (subjectLow.indexOf("запит на каталог l-tex") !== -1) {
    interest = "Заповнив(ла) форму на сайті secondopt, щоб отримати доступ до каталогу. Потрібно скинути посилання на наші ресурси, каталог та уточнити чи вдалось перейти в каталог та чи все зрозуміло";
    channel  = "secondopt";
  }
  else if (subjectLow.indexOf("запит на каталог") !== -1) {
    interest = "Заповнив(ла) форму на сайті secondopt, щоб отримати доступ до каталогу. Потрібно скинути посилання на наші ресурси, каталог та уточнити чи вдалось перейти в каталог та чи все зрозуміло";
    channel  = "secondopt";
  }
  else if (subjectLow.indexOf("запит на консультацію") !== -1) {
    interest = "Заповнив(ла) форму на сайті secondopt, щоб отримати консультацію. Потрібно скинути посилання на наші ресурси, каталог та проконсультувати";
    channel  = "secondopt";
  }
  else {
    Logger.log("parseEmailLead: невідомий тип — "+subject);
    return null;
  }

  var categoryField = extractEmailField(body, ["category","категорія"]);
  if (categoryField && categoryField !== "*") interest += "; Категорія товару: " + categoryField;
  var sourceField = extractEmailField(body, ["source","джерело"]);
  if (sourceField && sourceField !== "*") interest += "; Джерело: " + sourceField;

  return {
    name:     name    || "Невідоме ім'я",
    phone:    phone   || "",
    region:   region  || "",
    city:     city    || "",
    interest: interest,
    channel:  channel,
    category: "",
    manager:  "",
  };
}

function extractEmailField(body, keys) {
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    // Формат FormSubmit: "*name: *  сапир  -----"
    var re1 = new RegExp("\\*" + key + ":\\s*\\*\\s*(.+?)(?:\\s*-{5,}|\\s*Submitted|$)", "i");
    var m1  = body.match(re1);
    if (m1 && m1[1] && m1[1].trim() && m1[1].trim() !== "*") return m1[1].trim();
    // Формат Formspree: "name: Наталія   phone:..." (все в одному рядку)
    var re2 = new RegExp(key + ":\\s*(.+?)(?:\\s{2,}|\\n|$)", "i");
    var m2  = body.match(re2);
    if (m2 && m2[1] && m2[1].trim() && m2[1].trim() !== "*") return m2[1].trim();
  }
  return "";
}

function saveEmailLead(emailData, managers) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(8000)) return {success:false, error:"Система зайнята"};
  try {
    var ss    = SpreadsheetApp.openById(MAIN_FILE_ID);
    var sheet = ss.getSheetByName(MAIN_SHEET);
    var lastR = sheet.getLastRow();

    if (lastR >= DATA_START && emailData.phone) {
      var phone9 = emailData.phone.replace(/\D/g,"").slice(-9);
      if (phone9.length >= 8) {
        var allData = sheet.getRange(DATA_START, 1, lastR-DATA_START+1, MAIN_LAST_COL).getValues();
        for (var di = 0; di < allData.length; di++) {
          var ph = allData[di][COL.PHONE-1] ? allData[di][COL.PHONE-1].toString().replace(/\D/g,"").slice(-9) : "";
          if (ph.length >= 8 && ph === phone9) {
            return {
              success:    false,
              duplicate:  true,
              dupId:      allData[di][COL.ID-1]      || "",
              dupName:    allData[di][COL.NAME-1]    || "",
              dupManager: allData[di][COL.MANAGER-1] || "",
              error:      "Дубль: "+emailData.phone
            };
          }
        }
      }
    }

    if (emailData.phone) {
      var ons = check1CByPhone(emailData.phone);
      if (ons) Logger.log("Gmail: клієнт є в 1С ("+ons.name+"), але зберігаємо лід з сайту");
    }

    var dateVal = new Date();
    var newId   = generateId();
    var row = [
      newId,
      Utilities.formatDate(dateVal, Session.getScriptTimeZone(), "dd.MM.yyyy"),
      emailData.name,
      emailData.category || "",
      emailData.region   || "",
      emailData.city     || "",
      emailData.phone    || "",
      emailData.interest || "",
      "",
      "",
      emailData.manager  || "",
      "Очікує",
      emailData.channel  || "",
      "", "", "",
      dateVal.getFullYear(),
      "", ""   // v6.5: Оновлений статус, Коментар
    ];
    var lr = sheet.getLastRow() + 1;
    sheet.getRange(lr, COL.PHONE).setNumberFormat("@");
    sheet.getRange(lr, 1, 1, row.length).setValues([row]);

    if (emailData.manager && managers[emailData.manager] && managers[emailData.manager].fileId) {
      syncToManager(row, newId, managers[emailData.manager].fileId, emailData.manager);
    }

    return {success:true, id:newId, row:lr};
  } catch(err) {
    Logger.log("saveEmailLead: "+err);
    return {success:false, error:err.toString()};
  } finally {
    lock.releaseLock();
  }
}

function setupEmailTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "processIncomingEmails") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger("processIncomingEmails")
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log("✅ Тригер Gmail встановлено: кожні 5 хвилин");
}

// ── Довідник ──────────────────────────────────────────────

function syncDictionary() {
  var ss=SpreadsheetApp.openById(MAIN_FILE_ID);
  var refSheet=ss.getSheetByName("Довідники");
  if (!refSheet) { Logger.log("Аркуш Довідники не знайдено"); return; }
  var statuses  =refSheet.getRange("B2:B"+refSheet.getLastRow()).getValues().flat().filter(String);
  var cats      =refSheet.getRange("C2:C"+refSheet.getLastRow()).getValues().flat().filter(String);
  var activities=refSheet.getRange("D2:D"+refSheet.getLastRow()).getValues().flat().filter(String);
  var channels  =refSheet.getRange("E2:E"+refSheet.getLastRow()).getValues().flat().filter(String);
  var newStatuses = getNewStatusList_();   // v6.5: колонка F або значення за замовчуванням
  var managers=getManagers();
  for (var mgrName in managers) {
    var fileId=managers[mgrName].fileId; if (!fileId) continue;
    try {
      var mgrSheet=SpreadsheetApp.openById(fileId).getSheets()[0];
      if (statuses.length)   mgrSheet.getRange("K5:K5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(statuses,true).setAllowInvalid(true).build());
      if (cats.length)       mgrSheet.getRange("D5:D5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(cats,true).setAllowInvalid(true).build());
      if (activities.length) mgrSheet.getRange("J5:J5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(activities,true).setAllowInvalid(true).build());
      if (channels.length)   mgrSheet.getRange("L5:L5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(channels,true).setAllowInvalid(true).build());
      // v6.5: Оновлений статус — колонка Q у менеджера
      if (newStatuses.length) mgrSheet.getRange("Q5:Q5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(newStatuses,true).setAllowInvalid(true).build());
      Logger.log("✅ "+mgrName+": довідник оновлено");
    } catch(err) { Logger.log("❌ "+mgrName+": "+err); }
  }
  Logger.log("=== Довідник синхронізовано! ===");
}
// ── Перевірка телефону в базі 1С ─────────────────────────

function check1CByPhone(phone) {
  var fileId = PropertiesService.getScriptProperties().getProperty("ONS_FILE_ID");
  if (!fileId) { Logger.log("ONS_FILE_ID не встановлено"); return null; }
  try {
    var ss      = SpreadsheetApp.openById(fileId);
    var sheet   = ss.getSheets()[0];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var data    = sheet.getRange(2, 1, lastRow-1, 18).getValues();
    // Нормалізуємо вхідний номер: залишаємо тільки останні 9 цифр
    var phone9 = phone.replace(/\D/g,"").slice(-9);
    if (phone9.length < 8) return null;
    Logger.log("check1CByPhone: шукаємо "+phone9+" серед "+data.length+" рядків");
    for (var i=0; i<data.length; i++) {
      var raw = data[i][ONS_COL.PHONE-1] ? data[i][ONS_COL.PHONE-1].toString().trim() : "";
      if (!raw) continue;
      var ph9 = raw.replace(/\D/g,"").slice(-9);
      if (ph9.length < 8) continue;
      if (ph9 === phone9) {
        var dateRaw = data[i][ONS_COL.DATE-1];
        var dateStr = dateRaw instanceof Date
          ? Utilities.formatDate(dateRaw, Session.getScriptTimeZone(), "dd.MM.yyyy")
          : (dateRaw ? dateRaw.toString().substring(0,10) : "—");
        Logger.log("check1CByPhone: знайдено → "+data[i][ONS_COL.NAME-1]);
        return {
          code:  data[i][ONS_COL.CODE-1]  || "—",
          name:  data[i][ONS_COL.NAME-1]  || "—",
          phone: raw,
          city:  data[i][ONS_COL.CITY-1]  || "—",
          agent: data[i][ONS_COL.AGENT-1] || "—",
          date:  dateStr
        };
      }
    }
    Logger.log("check1CByPhone: не знайдено");
    return null;
  } catch(err) { Logger.log("check1CByPhone: "+err); return null; }
}

// ── Допоміжні ─────────────────────────────────────────────

function generateId() {
  return "LTEX-"+Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"yyyyMMdd")+"-"+(Math.floor(Math.random()*9000)+1000);
}

function sendViber(viberId,text) {
  try {
    var res=UrlFetchApp.fetch("https://chatapi.viber.com/pa/send_message",{
      method:"post",contentType:"application/json",
      headers:{"X-Viber-Auth-Token":VIBER_TOKEN},
      payload:JSON.stringify({receiver:viberId,type:"text",text:text,sender:{name:"L-TEX CRM",avatar:""},min_api_version:1}),
      muteHttpExceptions:true
    });
    var r=JSON.parse(res.getContentText());
    if (r.status!==0) Logger.log("Viber: "+r.status_message);
  } catch(err) { Logger.log("sendViber: "+err); }
}

function getTemplate() {
  var today=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"dd.MM.yyyy");
  var managers=getManagers();
  var mgrList=Object.keys(managers).filter(function(n){return managers[n].role==="менеджер";}).map(function(m){return"  - "+m;}).join("\n");
 return "ШАБЛОН:\n\nІм'я: Іванова Світлана\nТелефон: 0671234567\nОбласть: Київська\nМісто: Київ\nКатегорія: Магазин\nКанал: Google\nЦікавить: Bric-a-Brac оптом\nКонтакт: Хоче замовити палету\nДата: "+today+"\nМенеджер: Дунас Богдан\n\nОбов'язкові: Ім'я, Телефон, Менеджер\nРешта можна пропускати\n\nДоступні менеджери:\n"+mgrList+"\n\n🔗 Парсер лідів (AI):\nhttps://ltexlutskai-tech.github.io/ltex-leads/";
}

function okResponse() {
  return ContentService.createTextOutput(JSON.stringify({status:"ok"})).setMimeType(ContentService.MimeType.JSON);
}

function setViberWebhook() {
  var res=UrlFetchApp.fetch("https://chatapi.viber.com/pa/set_webhook",{
    method:"post",contentType:"application/json",
    headers:{"X-Viber-Auth-Token":VIBER_TOKEN},
    payload:JSON.stringify({url:WEBHOOK_URL,event_types:["message","conversation_started"],send_name:true}),
    muteHttpExceptions:true
  });
  Logger.log(JSON.parse(res.getContentText()).status===0?"✅ Webhook OK!":"❌ Помилка");
}

// ── ВИПРАВЛЕННЯ: fixManagerColumns — 18 колонок (v6.5) ──
function fixManagerColumns() {
  var correctHeaders=["ID","Дата","ПІБ контрагента","Категорія ТТ","Область","Місто","Номер тел.",
                      "Цікавить","Перший контакт","Активність","Статус дії","Канал пошуку",
                      "Інет сторінка","Telegram","Рік","⚠️ Дублі телефону",
                      HDR_NEW_STATUS, HDR_NEW_COMMENT];
  var managers=getManagers();
  for (var mgrName in managers) {
    if (!managers[mgrName].fileId) continue;
    try {
      var ss=SpreadsheetApp.openById(managers[mgrName].fileId);
      var sheet=ss.getSheets()[0];
      if (sheet.getMaxColumns() < correctHeaders.length)
        sheet.insertColumnsAfter(sheet.getMaxColumns(), correctHeaders.length - sheet.getMaxColumns());
      var lastCol=Math.max(sheet.getLastColumn(), correctHeaders.length);
      var currentHdrs=sheet.getRange(4,1,1,lastCol).getValues()[0];
      var headerMap={};
      currentHdrs.forEach(function(h,i){if(h)headerMap[h]=i+1;});
      var lastRow=sheet.getLastRow();
      var allData=lastRow>=5?sheet.getRange(5,1,lastRow-4,lastCol).getValues():[];
      var newData=allData.map(function(row){return correctHeaders.map(function(h){var c=headerMap[h];return c?row[c-1]:"";});});
      if (lastRow>=4) sheet.getRange(4,1,lastRow-3,Math.max(lastCol,correctHeaders.length)).clearContent();
      sheet.getRange(4,1,1,correctHeaders.length).setValues([correctHeaders])
           .setFontWeight("bold").setBackground("#2E6DA4").setFontColor("#FFFFFF").setWrap(true);
      if (newData.length>0) {
        sheet.getRange(5,1,newData.length,correctHeaders.length).setValues(newData);
        sheet.getRange(5,7,newData.length,1).setNumberFormat("@");
      }
      // Dropdown (setAllowInvalid=true щоб не блокувати існуючі дані)
      sheet.getRange("K5:K5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Готово","Очікує","НПТ","вилучити"],true).setAllowInvalid(true).build());
      sheet.getRange("D5:D5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["Інтернет","Магазин","Хоче почати","TikTok/Ефір","Ринок стаціонарний","Для себе","Виїздна торгівля"],true).setAllowInvalid(true).build());
      sheet.getRange("J5:J5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["переписка Viber","Переписка Telegram","карточка клієнта","НПТ","вилучити"],true).setAllowInvalid(true).build());
      sheet.getRange("L5:L5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(["TikTok","TikTok Ефір","Google","OLX","Instagram","YouTube","bricabrac","Рекомендація","Інше"],true).setAllowInvalid(true).build());
      // v6.5: Оновлений статус (Q) + Коментар (R)
      sheet.getRange("Q5:Q5000").setDataValidation(newStatusRule_());
      sheet.getRange("R5:R5000").setWrap(true);
      sheet.setColumnWidth(MGR_COL_NEW_STATUS, 150);
      sheet.setColumnWidth(MGR_COL_NEW_COMMENT, 300);
      // Підсвітка дублів телефону
      var dupsRule = SpreadsheetApp.newConditionalFormatRule()
        .withCriteria(SpreadsheetApp.BooleanCriteria.CUSTOM_FORMULA, ['=COUNTIF($G$5:$G$5000,G5)>1'])
        .setBackground("#FF6B6B").setFontColor("#FFFFFF")
        .setRanges([sheet.getRange("G5:G5000")]).build();
      sheet.setConditionalFormatRules([dupsRule]);
      Logger.log("✅ "+mgrName+": виправлено ("+correctHeaders.length+" колонок)");
    } catch(err) { Logger.log("❌ "+mgrName+": "+err); }
  }
  Logger.log("=== Готово! Всі файли менеджерів оновлено ===");
}

function assignIds2026() {
  var ss=SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet=ss.getSheetByName("🔒 2026"); if (!sheet) return;
  var lastRow=sheet.getLastRow(),count=0;
  for (var r=DATA_START;r<=lastRow;r++){var c=sheet.getRange(r,COL.ID);if(!c.getValue()){c.setValue(generateId());Utilities.sleep(10);count++;}}
  Logger.log("2026: "+count+" нових ID");
}

function assignIds2025() {
  var ss=SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet=ss.getSheetByName("📅 2025"); if (!sheet) return;
  var lastRow=sheet.getLastRow(),count=0;
  for (var r=DATA_START;r<=lastRow;r++){var c=sheet.getRange(r,COL.ID);if(!c.getValue()){c.setValue(generateId());Utilities.sleep(10);count++;}}
  Logger.log("2025: "+count+" нових ID");
}

// ── ВИПРАВЛЕННЯ: fixManagersViberId — виправляє заголовок колонки ──
function fixManagersViberId() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MGR_SHEET);
  if (!sheet) { Logger.log("Аркуш менеджерів не знайдено"); return; }
  // Виправляємо заголовок колонки 3: Telegram ID → Viber ID
  sheet.getRange(1, 3).setValue("Viber ID");
  Logger.log("✅ Заголовок колонки 3 виправлено: Viber ID");
  Logger.log("⚠️ Не забудь вручну заповнити Viber ID для кожного менеджера!");
  Logger.log("   Попроси кожного менеджера написати /старт в бот.");
}

function initManagerSheet() {
  var ss=SpreadsheetApp.openById(MAIN_FILE_ID);
  createManagerSheet(ss);
}

function testAll() {
  Logger.log("=== ТЕСТ v6.5 ===");
  var res=UrlFetchApp.fetch("https://chatapi.viber.com/pa/get_account_info",{method:"post",contentType:"application/json",headers:{"X-Viber-Auth-Token":VIBER_TOKEN},payload:"{}",muteHttpExceptions:true});
  var info=JSON.parse(res.getContentText());
  Logger.log(info.status===0?"✅ Viber OK: "+info.name:"❌ Viber: "+info.status_message);
  var managers=getManagers();
  Logger.log("Менеджерів: "+Object.keys(managers).length);
  for(var n in managers){
    if(!managers[n].fileId){Logger.log("  - "+n+" (оператор)");continue;}
    try{Logger.log("  ✅ "+n+": "+SpreadsheetApp.openById(managers[n].fileId).getName());}
    catch(err){Logger.log("  ❌ "+n+": недоступний");}
  }
  var today=Utilities.formatDate(new Date(),Session.getScriptTimeZone(),"dd.MM.yyyy");
  var r=parseAndSave("Ім'я: Тест v6.1\nТелефон: 0671234567\nДата: "+today+"\nМенеджер: Кузенко Тарас",{id:"test",name:"test"});
  Logger.log(r.success?"✅ Парсинг OK: рядок "+r.row:"❌ "+r.error);
  Logger.log("=== КІНЕЦЬ ===");
}


// ╔══════════════════════════════════════════════════════════╗
// ║        Сповіщення про нові ліди і зміну статусу         ║
// ╚══════════════════════════════════════════════════════════╝

var NOTIFY_IDS = [
  "6UpDIrwBWnH6escgZLEzvQ==",  // Кузенко Тарас
  "UTkC8aAOlMi67hNtFyd25g==",  // Мельник Володимир
];

function notifyOwners(text) {
  for (var i=0;i<NOTIFY_IDS.length;i++) {
    if (NOTIFY_IDS[i]) sendViber(NOTIFY_IDS[i], text);
  }
}


// ╔══════════════════════════════════════════════════════════╗
// ║              Щоденний звіт о 9:00                       ║
// ╚══════════════════════════════════════════════════════════╝

function sendDailyReport() {
  try {
    var ss    = SpreadsheetApp.openById(MAIN_FILE_ID);
    var sheet = ss.getSheetByName(MAIN_SHEET);
    if (!sheet) return;
    var tz        = Session.getScriptTimeZone();
    var today     = new Date();
    var yesterday = new Date(today.getTime() - 24*60*60*1000);
    var yDate     = Utilities.formatDate(yesterday, tz, "dd.MM.yyyy");
    var lastRow   = sheet.getLastRow();
    if (lastRow < DATA_START) return;
    var data = sheet.getRange(DATA_START, 1, lastRow-DATA_START+1, MAIN_LAST_COL).getValues();

    var newLeads      = {};   // нові ліди вчора по менеджерах
    var totalNew      = 0;
    var totalStatuses = {};   // всі статуси по базі
    var waitingByMgr  = {};   // "Очікує" по менеджерах
    var doneYestByMgr = {};   // "Готово" вчора по менеджерах
    var totalDoneYest = 0;

    // ── v6.5: прогрес обдзвону (актуалізація бази) ──
    var totalClients   = 0;   // всього рядків з клієнтами
    var updatedTotal   = 0;   // скільки вже мають «Оновлений статус»
    var updatedByValue = {};  // розподіл за значеннями оновленого статусу
    var updatedByMgr   = {};  // скільки опрацював кожен менеджер
    var pendingByMgr   = {};  // скільки ще залишилось у кожного

    data.forEach(function(row) {
      var dateCell = row[COL.DATE-1];
      var manager  = row[COL.MANAGER-1] ? row[COL.MANAGER-1].toString().trim() : "Без менеджера";
      var status   = row[COL.STATUS-1]  ? row[COL.STATUS-1].toString().trim()  : "";
      var dateStr  = "";
      if (dateCell instanceof Date) {
        dateStr = Utilities.formatDate(dateCell, tz, "dd.MM.yyyy");
      } else if (dateCell) {
        dateStr = dateCell.toString().substring(0,10);
      }

      // Загальні статуси
      if (status) totalStatuses[status] = (totalStatuses[status]||0) + 1;

      // Нові ліди вчора
      if (dateStr === yDate) {
        totalNew++;
        newLeads[manager] = (newLeads[manager]||0) + 1;
      }

      // Очікує — розподіл по менеджерах
      if (status === "Очікує") {
        waitingByMgr[manager] = (waitingByMgr[manager]||0) + 1;
      }

      // Готово вчора — по менеджерах
      // ⚠️ Дата в полі DATE — це дата створення ліда, а не зміни статусу.
      // Тому рахуємо "Готово" що були створені вчора (найближче до реальності без окремого лога змін)
      if (status === "Готово" && dateStr === yDate) {
        totalDoneYest++;
        doneYestByMgr[manager] = (doneYestByMgr[manager]||0) + 1;
      }

      // ── v6.5: прогрес актуалізації ──
      if (row[COL.NAME-1] || row[COL.PHONE-1]) {
        totalClients++;
        var upd = row[COL.NEW_STATUS-1] ? row[COL.NEW_STATUS-1].toString().trim() : "";
        if (upd) {
          updatedTotal++;
          updatedByValue[upd]  = (updatedByValue[upd]||0) + 1;
          updatedByMgr[manager]= (updatedByMgr[manager]||0) + 1;
        } else {
          pendingByMgr[manager]= (pendingByMgr[manager]||0) + 1;
        }
      }
    });

    var report = "Звіт L-TEX CRM за " + yDate + "\n";
    report += "================================\n\n";

    // Нові ліди
    report += "📥 Нових лідів: " + totalNew + "\n";
    if (totalNew > 0) {
      report += "По менеджерах:\n";
      for (var mgr in newLeads) report += "  - " + mgr + ": " + newLeads[mgr] + "\n";
    }

    // Статус Готово вчора
    report += "\n✅ Статус «Готово» вчора: " + totalDoneYest + "\n";
    if (totalDoneYest > 0) {
      for (var mgr in doneYestByMgr) report += "  - " + mgr + ": " + doneYestByMgr[mgr] + "\n";
    }

    // Статуси всієї бази
    report += "\n📊 Статуси всієї бази:\n";
    var statusOrder = ["Готово","Очікує","НПТ","вилучити"];
    statusOrder.forEach(function(s) {
      if (totalStatuses[s]) report += "  " + s + ": " + totalStatuses[s] + "\n";
    });

    // Очікує по менеджерах
    if (totalStatuses["Очікує"] > 0) {
      report += "\n⏳ «Очікує» по менеджерах:\n";
      // Сортуємо по спаданню
      var waitList = [];
      for (var mgr in waitingByMgr) waitList.push({name:mgr, count:waitingByMgr[mgr]});
      waitList.sort(function(a,b){return b.count-a.count;});
      waitList.forEach(function(item){
        report += "  - " + item.name + ": " + item.count + "\n";
      });
    }

    // ── v6.5: прогрес обдзвону ──
    if (totalClients > 0) {
      var pct = Math.round(updatedTotal * 100 / totalClients);
      report += "\n🔄 Актуалізація бази (обдзвін): " + updatedTotal + " з " + totalClients + " (" + pct + "%)\n";
      var updKeys = Object.keys(updatedByValue);
      if (updKeys.length) {
        report += "Оновлені статуси:\n";
        updKeys.forEach(function(k){ report += "  " + k + ": " + updatedByValue[k] + "\n"; });
      }
      var pendList = [];
      for (var mgr in pendingByMgr) pendList.push({name:mgr, count:pendingByMgr[mgr], done:(updatedByMgr[mgr]||0)});
      if (pendList.length) {
        pendList.sort(function(a,b){return b.count-a.count;});
        report += "Залишилось продзвонити:\n";
        pendList.forEach(function(item){
          report += "  - " + item.name + ": " + item.count + " (опрацьовано " + item.done + ")\n";
        });
      }
    }

    notifyOwners(report);
    Logger.log("Звіт надіслано:\n" + report);
  } catch(err) { Logger.log("sendDailyReport: " + err); }
}

function setupDailyReportTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i=0;i<triggers.length;i++) {
    if (triggers[i].getHandlerFunction()==="sendDailyReport") ScriptApp.deleteTrigger(triggers[i]);
  }
  ScriptApp.newTrigger("sendDailyReport").timeBased().everyDays(1).atHour(9).create();
  Logger.log("Тригер щоденного звіту встановлено о 9:00!");
}

function syncAllManagersFromMain() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MAIN_SHEET);
  if (!sheet) { Logger.log("Аркуш 2026 не знайдено"); return; }
  var lastRow = sheet.getLastRow();
  if (lastRow < DATA_START) { Logger.log("Немає даних"); return; }
  var managers = getManagers();
  var counts = {};
  var errors = 0;
  Logger.log("=== Починаємо синхронізацію " + (lastRow - DATA_START + 1) + " рядків... ===");
  for (var row = DATA_START; row <= lastRow; row++) {
    var rowData = sheet.getRange(row, 1, 1, MAIN_LAST_COL).getValues()[0];
    var rowId   = rowData[COL.ID-1]      ? rowData[COL.ID-1].toString()      : "";
    var name    = rowData[COL.NAME-1]    ? rowData[COL.NAME-1].toString()    : "";
    var manager = rowData[COL.MANAGER-1] ? rowData[COL.MANAGER-1].toString().trim() : "";
    if (!name || !rowId || !manager) continue;
    if (!managers[manager] || !managers[manager].fileId) continue;
    var ok = syncToManager(rowData, rowId, managers[manager].fileId, manager);
    if (ok) { counts[manager] = (counts[manager] || 0) + 1; } else { errors++; }
    if ((row - DATA_START) % 50 === 0 && row > DATA_START) {
      Utilities.sleep(1000);
      Logger.log("Оброблено: " + (row - DATA_START) + " рядків...");
    }
  }
  Logger.log("=== РЕЗУЛЬТАТ ===");
  for (var mgr in counts) { Logger.log("  " + mgr + ": " + counts[mgr] + " записів"); }
  if (errors > 0) Logger.log("Помилок: " + errors);
  Logger.log("=== Готово! ===");
}


function fixPhones380() {
  var totalFixed = 0;
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MAIN_SHEET);
  var lastRow = sheet.getLastRow();
  var fixedMain = 0;
  for (var row = DATA_START; row <= lastRow; row++) {
    var cell = sheet.getRange(row, COL.PHONE);
    var val = cell.getValue();
    if (!val) continue;
    var ph = val.toString().trim();
    if (ph.startsWith("380") && ph.length === 12) {
      cell.setValue("0" + ph.substring(3));
      cell.setNumberFormat("@");
      fixedMain++;
    }
  }
  Logger.log("Головна: виправлено " + fixedMain);
  totalFixed += fixedMain;
  var managers = getManagers();
  for (var mgrName in managers) {
    if (!managers[mgrName].fileId) continue;
    try {
      var mgrSheet = SpreadsheetApp.openById(managers[mgrName].fileId).getSheets()[0];
      var mgrLast = mgrSheet.getLastRow();
      var fixedMgr = 0;
      for (var r = 5; r <= mgrLast; r++) {
        var mCell = mgrSheet.getRange(r, 7);
        var mVal = mCell.getValue();
        if (!mVal) continue;
        var mPh = mVal.toString().trim();
        if (mPh.startsWith("380") && mPh.length === 12) {
          mCell.setValue("0" + mPh.substring(3));
          mCell.setNumberFormat("@");
          fixedMgr++;
        }
      }
      Logger.log(mgrName + ": " + fixedMgr);
      totalFixed += fixedMgr;
    } catch(err) { Logger.log(mgrName + " помилка: " + err); }
  }
  Logger.log("=== Всього виправлено: " + totalFixed + " ===");
}
function syncDictionaryAll() {
  // Оновлює і головну таблицю і всі файли менеджерів
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var refSheet = ss.getSheetByName("Довідники");
  if (!refSheet) { Logger.log("Довідники не знайдено"); return; }

  var statuses   = refSheet.getRange("B2:B"+refSheet.getLastRow()).getValues().flat().filter(String);
  var cats       = refSheet.getRange("C2:C"+refSheet.getLastRow()).getValues().flat().filter(String);
  var activities = refSheet.getRange("D2:D"+refSheet.getLastRow()).getValues().flat().filter(String);
  var channels   = refSheet.getRange("E2:E"+refSheet.getLastRow()).getValues().flat().filter(String);
  var newStatuses = getNewStatusList_();   // v6.5

  // Оновлюємо головну таблицю
  var mainSheet = ss.getSheetByName(MAIN_SHEET);
  if (mainSheet && statuses.length)
    mainSheet.getRange("L5:L5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(statuses,true).setAllowInvalid(true).build());
  if (mainSheet && cats.length)
    mainSheet.getRange("D5:D5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(cats,true).setAllowInvalid(true).build());
  if (mainSheet && channels.length)
    mainSheet.getRange("M5:M5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(channels,true).setAllowInvalid(true).build());
  // v6.5: Оновлений статус — колонка R головної таблиці
  if (mainSheet && newStatuses.length)
    mainSheet.getRange("R5:R5000").setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(newStatuses,true).setAllowInvalid(true).build());
  Logger.log("✅ Головна таблиця: довідник оновлено");

  // Оновлюємо файли менеджерів
  syncDictionary();
}

function clearLog() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var log = ss.getSheetByName("_log");
  if (log) log.clearContents();
  else Logger.log("_log не знайдено");
}
// ╔══════════════════════════════════════════════════════════╗
// ║   Додавання нових менеджерів + таблиць (червень 2026)    ║
// ╚══════════════════════════════════════════════════════════╝
// Запустити ОДИН РАЗ вручну з редактора Apps Script.
// Створює таблиці, додає/оновлює менеджерів в аркуші "⚙️ Менеджери".
// Безпечно запускати повторно — існуючі таблиці НЕ дублюються.

function addNewTeamMembers2026() {
  var newMembers = [
    { name: "Савчук Павло",      role: "менеджер" },  // новий
    { name: "Бойко Катерина",    role: "менеджер" },  // новий
    { name: "Мельник Володимир", role: "менеджер" },  // був оператор → робимо менеджером + таблиця
  ];

  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MGR_SHEET);
  if (!sheet) { createManagerSheet(ss); sheet = ss.getSheetByName(MGR_SHEET); }

  var lastRow = sheet.getLastRow();
  var existing = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, 6).getValues() : [];

  newMembers.forEach(function(member) {
    var rowIdx = -1;
    for (var i = 0; i < existing.length; i++) {
      var nm = existing[i][MGR_COL.NAME-1] ? existing[i][MGR_COL.NAME-1].toString().trim() : "";
      if (nm === member.name) { rowIdx = i; break; }
    }

    var fileId = (rowIdx !== -1 && existing[rowIdx][MGR_COL.FILE_ID-1])
      ? existing[rowIdx][MGR_COL.FILE_ID-1].toString().trim() : "";

    // 1) Створюємо таблицю, якщо її ще немає
    if (!fileId) {
      var newFile = SpreadsheetApp.create("👤 " + member.name + " — Мої клієнти | L-TEX");
      fileId = newFile.getId();
      setupManagerFile(fileId, member.name);
      Logger.log("✅ Створено таблицю для " + member.name + " → " + fileId);
    } else {
      Logger.log("ℹ️ " + member.name + " вже має таблицю (" + fileId + ") — пропускаю створення");
    }

    // 2) Додаємо / оновлюємо рядок у "⚙️ Менеджери"
    if (rowIdx !== -1) {
      var sheetRow = rowIdx + 2; // existing[0] = рядок 2
      sheet.getRange(sheetRow, MGR_COL.ROLE).setValue(member.role);   // оператор → менеджер
      sheet.getRange(sheetRow, MGR_COL.FILE_ID).setValue(fileId);     // прив'язуємо таблицю
      sheet.getRange(sheetRow, MGR_COL.ACTIVE).setValue(true);
      // Viber ID НЕ чіпаємо — у Мельника він вже є
      Logger.log("✅ Оновлено: " + member.name + " → роль «" + member.role + "», таблиця прив'язана");
    } else {
      // Viber ID порожній — заповниться після /старт
      sheet.appendRow([member.name, member.role, "", fileId, new Date(), true]);
      Logger.log("✅ Додано нового менеджера: " + member.name + " (Viber ID — після /старт)");
    }
  });

  // 3) Підтягуємо довідники (dropdown-и) у нові таблиці
  syncDictionary();

  Logger.log("=== Готово! Перевір аркуш «⚙️ Менеджери» ===");
}
function listManagerViberIds() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MGR_SHEET);
  var lastRow = sheet.getLastRow();
  var data = sheet.getRange(2, 1, lastRow - 1, 6).getValues();
  data.forEach(function(row) {
    var name = row[MGR_COL.NAME-1];
    var vid  = row[MGR_COL.VIBER_ID-1] ? row[MGR_COL.VIBER_ID-1].toString() : "(порожньо)";
    Logger.log(name + " | [" + vid + "] довжина=" + vid.length);
  });
}// ── Додати менеджерів у дропдаун колонки "Менеджер" головної таблиці ──
function addManagersToDropdown() {
  var NEW = ["Савчук Павло", "Бойко Катерина"];
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var sheet = ss.getSheetByName(MAIN_SHEET);
  var col = COL.MANAGER; // 11 = колонка K

  // Беремо існуючу перевірку даних з першої комірки даних
  var rule = sheet.getRange(DATA_START, col).getDataValidation();
  var items = [];
  if (rule) {
    var type = rule.getCriteriaType();
    if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      var cv = rule.getCriteriaValues();
      items = Array.isArray(cv[0]) ? cv[0].slice() : [];
    } else if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      items = rule.getCriteriaValues()[0].getValues().flat().filter(String);
    }
  }

  // Доливаємо нові імена (без дублів)
  var existing = items.map(function(x){ return x.toString().trim(); });
  NEW.forEach(function(n){ if (existing.indexOf(n) === -1) items.push(n); });

  // Перевстановлюємо на всю колонку Менеджер (K5:K5000)
  var newRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(items, true)
    .setAllowInvalid(true)
    .build();
  sheet.getRange(DATA_START, col, 5000, 1).setDataValidation(newRule);

  Logger.log("✅ Дропдаун «Менеджер» оновлено (" + items.length + " імен): " + items.join(", "));
}
// ╔══════════════════════════════════════════════════════════╗
// ║   v6.4 | Синхронізація: ТАБЛИЦЯ МЕНЕДЖЕРА → ГОЛОВНА       ║
// ╚══════════════════════════════════════════════════════════╝
// Причина бага: у файлах менеджерів не було тригера, який ловить
// редагування і пише зміни назад у головну. Тому статуси «Готово»,
// «Активність» тощо лишались тільки в таблиці менеджера.
//
// ▶ ПОРЯДОК ЗАПУСКУ (один раз, з редактора Apps Script):
//   1) installManagerSyncTriggers   — навісити тригери на всі файли
//   2) backfillStatusesFromManagers — підтягнути вже зроблені зміни

var MGR_DATA_START = 5; // дані в таблицях менеджерів — з 5-го рядка

// 1) Встановити тригери на всі файли менеджерів (безпечно запускати повторно)
function installManagerSyncTriggers() {
  var managers = getManagers();
  var existing = {};
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onManagerEdit") existing[t.getTriggerSourceId()] = true;
  });
  var installed = 0, skipped = 0, errors = 0;
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) continue;
    if (existing[fileId]) { skipped++; Logger.log("ℹ️ " + name + ": тригер вже є"); continue; }
    try {
      ScriptApp.newTrigger("onManagerEdit").forSpreadsheet(SpreadsheetApp.openById(fileId)).onEdit().create();
      installed++;
      Logger.log("✅ " + name + ": тригер синхронізації встановлено");
    } catch (err) { errors++; Logger.log("❌ " + name + " (" + fileId + "): " + err); }
  }
  Logger.log("=== Встановлено: " + installed + ", пропущено: " + skipped + ", помилок: " + errors + " ===");
}

// Прибрати тригери (якщо колись знадобиться)
function removeManagerSyncTriggers() {
  var removed = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === "onManagerEdit") { ScriptApp.deleteTrigger(t); removed++; }
  });
  Logger.log("Видалено тригерів: " + removed);
}

// Обробник редагувань у файлі менеджера → пише назад у головну за ID
function onManagerEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getIndex() !== 1) return;             // лише перший (робочий) аркуш
    var startRow = e.range.getRow();
    var numRows  = e.range.getNumRows();
    var lastRow  = sheet.getLastRow();
    for (var r = startRow; r < startRow + numRows; r++) {
      if (r < MGR_DATA_START || r > lastRow) continue;
      // v6.5: читаємо 18 колонок — разом з «Оновлений статус» і «Коментар»
      var rowData = sheet.getRange(r, 1, 1, MGR_LAST_COL).getValues()[0];
      var rowId   = rowData[0] ? rowData[0].toString().trim() : "";
      if (!rowId) continue;
      handleSyncFromManager({ type:"sync_from_manager", action:"update", rowId:rowId, rowData:rowData });
      Logger.log("onManagerEdit: рядок " + r + " (ID " + rowId + ") → головна");
    }
  } catch (err) { Logger.log("onManagerEdit: " + err); }
}

// 2) Разовий перенос уже зроблених змін
//    (Статус / Активність / Перший контакт + v6.5 Оновлений статус / Коментар)
function backfillStatusesFromManagers() {
  var mainSheet = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
  var lastRow = mainSheet.getLastRow();
  if (lastRow < DATA_START) { Logger.log("Немає даних у головній"); return; }

  var ids = mainSheet.getRange(DATA_START, COL.ID, lastRow - DATA_START + 1, 1).getValues();
  var rowById = {};
  for (var i = 0; i < ids.length; i++) {
    var id = ids[i][0] ? ids[i][0].toString().trim() : "";
    if (id) rowById[id] = DATA_START + i;
  }

  var managers = getManagers(), updated = 0;
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) continue;
    try {
      var ms = SpreadsheetApp.openById(fileId).getSheets()[0];
      var ml = ms.getLastRow();
      if (ml < MGR_DATA_START) continue;
      var md = ms.getRange(MGR_DATA_START, 1, ml - MGR_DATA_START + 1, MGR_LAST_COL).getValues();
      for (var j = 0; j < md.length; j++) {
        var id = md[j][0] ? md[j][0].toString().trim() : "";
        if (!id || !rowById[id]) continue;
        var tRow = rowById[id];
        var contact = md[j][8], activity = md[j][9], status = md[j][10]; // col 9,10,11
        var newStatus  = md[j][MGR_COL_NEW_STATUS-1];   // col 17
        var newComment = md[j][MGR_COL_NEW_COMMENT-1];  // col 18
        if (status   !== "" && status   != null) mainSheet.getRange(tRow, COL.STATUS).setValue(status);
        if (activity !== "" && activity != null) mainSheet.getRange(tRow, COL.ACTIVITY).setValue(activity);
        if (contact  !== "" && contact  != null) mainSheet.getRange(tRow, COL.CONTACT).setValue(contact);
        if (newStatus  !== "" && newStatus  != null) mainSheet.getRange(tRow, COL.NEW_STATUS).setValue(newStatus);
        if (newComment !== "" && newComment != null) mainSheet.getRange(tRow, COL.NEW_COMMENT).setValue(newComment);
        updated++;
      }
      Logger.log("✅ " + name + ": статуси перенесено");
    } catch (err) { Logger.log("❌ " + name + ": " + err); }
  }
  Logger.log("=== Backfill готово. Оновлено рядків: " + updated + " ===");
}


// ╔══════════════════════════════════════════════════════════╗
// ║   v6.5 | Колонки актуалізації бази (повторний обдзвін)   ║
// ╚══════════════════════════════════════════════════════════╝
//
// Що додається:
//   «Оновлений статус» — випадаючий список:
//        Карточка клієнта / без змін / НПТ / вилучити
//   «Коментар (результат розмови), НПТ (не піднімає трубку)» — вільний текст
//
// Розташування (колонки додаються в КІНЕЦЬ, наявні дані не зсуваються):
//   головна таблиця   → R (18) і S (19)
//   файл менеджера    → Q (17) і R (18)
//
// ▶ ЗАПУСК (один раз, з редактора Apps Script):
//      addUpdatedStatusColumns()
//   Функцію безпечно запускати повторно — вона нічого не дублює.
//
// ▶ Після цього (якщо тригери ще не стоять):
//      installManagerSyncTriggers()  — зміни менеджера летять у головну

function addUpdatedStatusColumns() {
  var report = [];

  // 1) Довідники → колонка F зі значеннями нового статусу
  try {
    ensureNewStatusDictionary_();
    report.push("✅ Довідники: колонка F «" + HDR_NEW_STATUS + "» готова");
  } catch (err) { report.push("❌ Довідники: " + err); }

  // 2) Головна таблиця
  try {
    var main = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName(MAIN_SHEET);
    if (!main) throw new Error("аркуш «" + MAIN_SHEET + "» не знайдено");
    addUpdatedStatusColumnsToSheet_(main, COL.NEW_STATUS, COL.NEW_COMMENT);
    report.push("✅ Головна «" + MAIN_SHEET + "»: колонки R і S додано");
  } catch (err) { report.push("❌ Головна: " + err); }

  // 3) Файли менеджерів
  var managers = getManagers();
  for (var name in managers) {
    var fileId = managers[name].fileId;
    if (!fileId) { report.push("ℹ️ " + name + ": немає файлу — пропущено"); continue; }
    try {
      var sh = SpreadsheetApp.openById(fileId).getSheets()[0];
      addUpdatedStatusColumnsToSheet_(sh, MGR_COL_NEW_STATUS, MGR_COL_NEW_COMMENT);
      report.push("✅ " + name + ": колонки Q і R додано");
    } catch (err) { report.push("❌ " + name + ": " + err); }
  }

  Logger.log(report.join("\n"));
  Logger.log("=== Готово. Далі: installManagerSyncTriggers() якщо тригери ще не встановлені ===");
}

// Додає дві колонки в кінець конкретного аркуша (ідемпотентно)
function addUpdatedStatusColumnsToSheet_(sheet, statusCol, commentCol) {
  var hdrRow = findHeaderRow_(sheet);

  // 1) Розширюємо сітку, якщо колонок бракує
  if (sheet.getMaxColumns() < commentCol) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), commentCol - sheet.getMaxColumns());
  }

  // 2) Заголовки — у стилі сусідньої колонки
  var sample = sheet.getRange(hdrRow, Math.max(1, statusCol - 1));
  var bg = sample.getBackground();
  var fc = sample.getFontColor();

  var hs = sheet.getRange(hdrRow, statusCol);
  if (hs.getValue().toString().trim() !== HDR_NEW_STATUS)  hs.setValue(HDR_NEW_STATUS);
  var hc = sheet.getRange(hdrRow, commentCol);
  if (hc.getValue().toString().trim() !== HDR_NEW_COMMENT) hc.setValue(HDR_NEW_COMMENT);
  sheet.getRange(hdrRow, statusCol, 1, 2)
       .setFontWeight("bold").setBackground(bg).setFontColor(fc).setWrap(true)
       .setVerticalAlignment("middle");

  // 3) Випадаючий список + перенос тексту для коментаря
  var nRows = sheet.getMaxRows() - hdrRow;
  if (nRows > 0) {
    sheet.getRange(hdrRow + 1, statusCol,  nRows, 1).setDataValidation(newStatusRule_());
    sheet.getRange(hdrRow + 1, commentCol, nRows, 1).setWrap(true);
  }
  sheet.setColumnWidth(statusCol, 150);
  sheet.setColumnWidth(commentCol, 300);

  // 4) Якщо зверху є об'єднана «шапка» — розтягуємо її на нові колонки
  extendTitleMerges_(sheet, commentCol, hdrRow);
}

// Заголовок таблиці = рядок, у першій колонці якого стоїть "ID"
function findHeaderRow_(sheet) {
  var scan = Math.min(6, sheet.getMaxRows());
  var vals = sheet.getRange(1, 1, scan, 1).getValues();
  for (var i = 0; i < scan; i++) {
    if (vals[i][0] && vals[i][0].toString().trim().toUpperCase() === "ID") return i + 1;
  }
  return DATA_START - 1;   // за замовчуванням — рядок 4
}

// Розтягує об'єднані клітинки шапки (рядки над заголовком) на нову ширину
function extendTitleMerges_(sheet, lastCol, hdrRow) {
  try {
    if (hdrRow < 2) return;
    var merges = sheet.getRange(1, 1, hdrRow - 1, lastCol).getMergedRanges();
    for (var i = 0; i < merges.length; i++) {
      var m = merges[i];
      if (m.getColumn() === 1 && m.getNumRows() === 1 && m.getLastColumn() < lastCol) {
        var r = m.getRow();
        var v = m.getValue();
        m.breakApart();
        sheet.getRange(r, 1, 1, lastCol).merge().setValue(v);
      }
    }
  } catch (err) { Logger.log("extendTitleMerges_: " + err); }
}

// Список значень «Оновленого статусу»: колонка F аркуша «Довідники»,
// а якщо вона порожня — значення за замовчуванням NEW_STATUS_LIST
function getNewStatusList_() {
  try {
    var ref = SpreadsheetApp.openById(MAIN_FILE_ID).getSheetByName("Довідники");
    if (ref && ref.getLastRow() >= 2 && ref.getMaxColumns() >= 6) {
      var list = ref.getRange("F2:F" + ref.getLastRow()).getValues().flat().filter(String);
      if (list.length) return list;
    }
  } catch (err) { Logger.log("getNewStatusList_: " + err); }
  return NEW_STATUS_LIST;
}

function newStatusRule_() {
  return SpreadsheetApp.newDataValidation()
    .requireValueInList(getNewStatusList_(), true)
    .setAllowInvalid(true)
    .build();
}

// Створює колонку F в аркуші «Довідники» і доливає значення з NEW_STATUS_LIST.
// Те, що вже є в колонці, не чіпаємо — додаються лише відсутні значення,
// тому функцію можна запускати повторно після розширення списку статусів.
function ensureNewStatusDictionary_() {
  var ss = SpreadsheetApp.openById(MAIN_FILE_ID);
  var ref = ss.getSheetByName("Довідники");
  if (!ref) { Logger.log("Аркуш «Довідники» не знайдено — пропускаю"); return; }
  if (ref.getMaxColumns() < 6) ref.insertColumnsAfter(ref.getMaxColumns(), 6 - ref.getMaxColumns());
  if (!ref.getRange("F1").getValue()) ref.getRange("F1").setValue(HDR_NEW_STATUS).setFontWeight("bold");

  var colVals = ref.getRange(2, 6, Math.max(ref.getMaxRows() - 1, 1), 1).getValues();
  var lastUsed = 1;   // рядок 1 = заголовок
  for (var i = 0; i < colVals.length; i++) {
    if (colVals[i][0] !== "" && colVals[i][0] !== null) lastUsed = i + 2;
  }
  var existingLow = colVals.flat().filter(String).map(function(v){ return v.toString().trim().toLowerCase(); });
  var missing = NEW_STATUS_LIST.filter(function(v){
    return existingLow.indexOf(v.toLowerCase()) === -1;
  });
  if (!missing.length) return;

  var firstFree = lastUsed + 1;
  if (ref.getMaxRows() < firstFree + missing.length - 1) {
    ref.insertRowsAfter(ref.getMaxRows(), firstFree + missing.length - 1 - ref.getMaxRows());
  }
  ref.getRange(firstFree, 6, missing.length, 1)
     .setValues(missing.map(function(v){ return [v]; }));
  Logger.log("Довідники F: додано " + missing.join(", "));
}
