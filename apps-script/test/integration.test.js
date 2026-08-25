// Інтеграційний тест: СПРАВЖНІЙ Code.gs + ManagerTransfer.gs разом,
// на емуляції сервісів Google Apps Script.
// Перевіряє, що команда /передати доходить через doPost і виконує перенос.
const fs = require("fs"), vm = require("vm"), path = require("path");
const dir = __dirname;

// Беремо з mocks.js лише емуляцію сервісів (без копій констант і функцій CRM —
// вони приїдуть зі справжнього Code.gs).
let services = fs.readFileSync(path.join(dir, "mocks.js"), "utf8");
services = services.replace(/\/\/<<APP_CONST>>[\s\S]*?\/\/<<END_APP_CONST>>/, "")
                   .replace(/\/\/<<APP_FN>>[\s\S]*?\/\/<<END_APP_FN>>/, "");

const src = services + "\n" +
  fs.readFileSync(path.join(dir, "../Code.gs"), "utf8") + "\n" +
  fs.readFileSync(path.join(dir, "../ManagerTransfer.gs"), "utf8");

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx);

const S = ctx.MockSheet, SS = ctx.MockSpreadsheet;
const HDR = [[],[],[], ["ID","Дата","ПІБ","Кат","Обл","Місто","Тел","Цікавить","Перший контакт",
                        "Активність","Статус дії","Канал","Інет","TG","Рік","Дублі","Онов.статус","Коментар"]];

function setup() {
  const main = new S("🔒 2026", [[],[],[],
    ["ID","Дата","ПІБ","Кат","Обл","Місто","Тел","Цікавить","Перший контакт","Активність",
     "Менеджер","Статус","Канал","Інет","TG","Дублі","Рік","Онов.статус","Коментар"],
    ["LTEX-1","01.08.2026","Іванова С.","Магазин","Львівська","Львів","0671234567","Bric-a-Brac",
     "","","Гуменюк Євген","Очікує","Google","","","",2026,"",""]
  ]);
  const mgrs = new S("⚙️ Менеджери", [
    ["Ім'я","Роль","Viber ID","ID файлу","Дата","Активний"],
    ["Гуменюк Євген","менеджер","VID_GUM","F_GUM",new Date(),true],
    ["Дунас Богдан","менеджер","VID_DUN","F_DUN",new Date(),true],
  ]);
  const mainSS = new SS("1C-d_w2qr3CWn7RZZlWr6W8GE7VIiGBwSAx1ZmDAOfCA");
  mainSS.sheets = [main, mgrs];
  const gum = new SS("F_GUM"); gum.sheets = [new S("Клієнти", HDR.concat([
    ["LTEX-1","01.08.2026","Іванова С.","Магазин","Львівська","Львів","0671234567","Bric-a-Brac",
     "Дзвонив 12.08","переписка Viber","Очікує","Google","","",2026,"","Карточка клієнта","Передзвонити"]
  ]))];
  const dun = new SS("F_DUN"); dun.sheets = [new S("Клієнти", HDR.map(r => r.slice()))];
  ctx.FILES = {"1C-d_w2qr3CWn7RZZlWr6W8GE7VIiGBwSAx1ZmDAOfCA": mainSS, F_GUM: gum, F_DUN: dun};
  ctx.VIBER_SENT = []; ctx.LOG = [];
  return {main, gum, dun};
}

function viber(id){ const m = ctx.VIBER_SENT.filter(v => v.id === id); return m.length ? m[m.length-1].text : ""; }
let fails = 0;
function ok(c, label){ console.log((c?"✅":"❌")+" "+label); if(!c) fails++; }

function post(text, senderId, senderName) {
  return ctx.doPost({ postData: { contents: JSON.stringify({
    event: "message", timestamp: Date.now(),
    sender: {id: senderId, name: senderName || "Тест"},
    message: {type: "text", text: text}
  })}});
}

console.log("=== Інтеграція: /передати через doPost ===");
let f = setup();
post("/передати 0671234567 Дунас Богдан", "yz7qkyTVUGuGHAGoSvdEmQ==", "Адмін"); // ADMIN_VIBER_ID з Code.gs
ok(f.main.getRange(5, 11).getValue() === "Дунас Богдан", "менеджера змінено в головній таблиці");
ok(f.gum.getSheets()[0].getRange(5,1,1,18).getValues()[0][0] === "", "рядок прибрано у попереднього менеджера");
const dunRow = f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0];
ok(dunRow[0] === "LTEX-1", "рядок зʼявився у нового менеджера");
ok(dunRow[8] === "Дзвонив 12.08" && dunRow[16] === "Карточка клієнта", "дані обдзвону перенесено");
ok(/Контрагента передано/.test(viber("yz7qkyTVUGuGHAGoSvdEmQ==")), "адміну прийшло підтвердження");
ok(/передано контрагента/.test(viber("VID_DUN")), "новому менеджеру прийшло сповіщення");
ok(/передано іншому менеджеру/.test(viber("VID_GUM")), "попередньому менеджеру прийшло сповіщення");

console.log("\n=== Інтеграція: /допомога містить нову команду ===");
f = setup();
post("/допомога", "yz7qkyTVUGuGHAGoSvdEmQ==", "Адмін");
ok(/\/передати/.test(viber("yz7qkyTVUGuGHAGoSvdEmQ==")), "команда є в довідці");

console.log("\n=== Інтеграція: /передати без параметрів → підказка ===");
f = setup();
post("/передати", "VID_GUM", "Гуменюк");
ok(/Передати контрагента іншому менеджеру/.test(viber("VID_GUM")), "бот показав формат команди");

console.log("\n=== Інтеграція: інші команди не зламані ===");
f = setup();
post("/менеджери", "VID_GUM", "Гуменюк");
ok(/Активні менеджери/.test(viber("VID_GUM")), "/менеджери працює");
f = setup();
post("0671234567", "VID_GUM", "Гуменюк");
ok(/Знайдено в CRM/.test(viber("VID_GUM")), "автоперевірка номера працює");


// ── Повторний запит ──
const ADMIN = "yz7qkyTVUGuGHAGoSvdEmQ==";
function mainRow(f){ return f.main.getRange(5,1,1,19).getValues()[0]; }

console.log("\n=== Повторний запит: /передати … | опис ===");
f = setup();
f.main.getRange(5, 12).setValue("Готово");              // клієнт був закритий
post("/передати 0671234567 Дунас Богдан | Питає ціну на палету взуття, писав у TikTok", ADMIN, "Адмін");
let row = mainRow(f);
ok(/🔁 ПОВТОРНИЙ ЗАПИТ/.test(viber("VID_DUN")), "новий менеджер бачить позначку «повторний запит»");
ok(/Питає ціну на палету взуття, писав у TikTok/.test(viber("VID_DUN")), "опис звернення у повідомленні");
ok(/Bric-a-Brac/.test(String(row[7])) && /🔁 Повторний запит/.test(String(row[7])),
   "опис дописано в «Цікавить», стара інформація збережена");
ok(row[11] === "Очікує", "статус повернувся в «Очікує»");
const dRow = f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0];
ok(/🔁 Повторний запит/.test(String(dRow[7])), "історія звернень поїхала у файл нового менеджера");
ok(/повторний запит/.test(viber("VID_GUM")), "попередній менеджер бачить причину передачі");
ok(/ПОВТОРНИЙ ЗАПИТ/.test(viber(ADMIN)), "підтвердження ініціатору позначене як повторний запит");

console.log("\n=== Повторний запит: багаторядковий формат ===");
f = setup();
post("/передати\nТелефон: 0671234567\nМенеджер: Дунас Богдан\nЗапит: Хоче каталог і ціни", ADMIN, "Адмін");
ok(/Хоче каталог і ціни/.test(viber("VID_DUN")), "опис із поля «Запит:» дійшов до менеджера");
ok(/🔁 Повторний запит/.test(String(mainRow(f)[7])), "опис дописано в «Цікавить»");

console.log("\n=== Повторний запит: опис з нового рядка ===");
f = setup();
post("/передати 0671234567 Дунас Богдан\nПитав про доставку", ADMIN, "Адмін");
ok(/Питав про доставку/.test(viber("VID_DUN")), "опис після переносу рядка теж працює");

console.log("\n=== Звичайна передача без опису — без зайвих позначок ===");
f = setup();
post("/передати 0671234567 Дунас Богдан", ADMIN, "Адмін");
ok(!/ПОВТОРНИЙ/.test(viber("VID_DUN")) && /Вам передано контрагента/.test(viber("VID_DUN")),
   "звичайне повідомлення без позначки повторного запиту");
ok(String(mainRow(f)[7]) === "Bric-a-Brac", "«Цікавить» не змінено");

console.log("\n" + (fails ? "❌ Провалено перевірок: "+fails : "✅ Усі перевірки пройдено"));
process.exit(fails?1:0);
