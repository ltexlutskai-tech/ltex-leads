const fs = require("fs"), vm = require("vm");
const src = fs.readFileSync(__dirname + "/mocks.js","utf8") + "\n" +
            fs.readFileSync(__dirname + "/../ManagerTransfer.gs","utf8");
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(src, ctx);

function hdr(n){ return [[ "" ],[ "" ],[ "" ], ["ID","Дата","ПІБ","Кат","Обл","Місто","Тел","Цікавить","Перший контакт","Активність","Статус дії","Канал","Інет","TG","Рік","Дублі","Оновлений статус","Коментар"]]; }

function setup(){
  const S = ctx.MockSheet, SS = ctx.MockSpreadsheet;
  const main = new S("🔒 2026", [[],[],[],
    ["ID","Дата","ПІБ","Кат","Обл","Місто","Тел","Цікавить","Перший контакт","Активність","Менеджер","Статус","Канал","Інет","TG","Дублі","Рік","Оновлений статус","Коментар"],
    ["LTEX-1","01.08.2026","Іванова С.","Магазин","Львівська","Львів","0671234567","Bric-a-Brac","", "", "Дунас Богдан","Очікує","Google","","","",2026,"",""]
  ]);
  const mgrs = new S("⚙️ Менеджери", [
    ["Ім'я","Роль","Viber ID","ID файлу","Дата","Активний"],
    ["Гуменюк Євген","менеджер","VID_GUM","F_GUM",new Date(),true],
    ["Дунас Богдан","менеджер","VID_DUN","F_DUN",new Date(),true],
    ["Стара Оксана","менеджер","VID_OLD","F_OLD",new Date(),false],
    ["Бойко Богдана","менеджер","VID_BOY","F_BOY",new Date(),true],
  ]);
  const mainSS = new SS("MAIN"); mainSS.sheets=[main,mgrs];
  const gum = new SS("F_GUM"); gum.sheets=[new S("Клієнти", hdr().concat([
    ["LTEX-1","01.08.2026","Іванова С.","Магазин","Львівська","Львів","0671234567","Bric-a-Brac",
     "Дзвонив 12.08","переписка Viber","Очікує","Google","","",2026,"","Карточка клієнта","Просив передзвонити у вересні"]
  ]))];
  const dun = new SS("F_DUN"); dun.sheets=[new S("Клієнти", hdr())];
  const old = new SS("F_OLD"); old.sheets=[new S("Клієнти", hdr())];
  const boy = new SS("F_BOY"); boy.sheets=[new S("Клієнти", hdr())];
  ctx.FILES = {MAIN:mainSS, F_GUM:gum, F_DUN:dun, F_OLD:old, F_BOY:boy};
  ctx.VIBER_SENT=[]; ctx.OWNER_MSGS=[]; ctx.CRM_PUSH=[]; ctx.LOG=[];
  return {main, gum, dun, old, boy};
}

let fails = 0;
function ok(cond, label){ console.log((cond?"✅":"❌")+" "+label); if(!cond) fails++; }

// ── Тест 1: звичайний перенос Гуменюк → Дунас ──
console.log("\n=== Тест 1: перенос між менеджерами ===");
let f = setup();
ctx.onMainEditTransfer({ range: f.main.getRange(5, ctx.COL.MANAGER, 1, 1), oldValue: "Гуменюк Євген" });

const gumRows = f.gum.getSheets()[0].getRange(5,1,Math.max(f.gum.getSheets()[0].getLastRow()-4,1),18).getValues().filter(r=>r[0]);
const dunRows = f.dun.getSheets()[0].getRange(5,1,Math.max(f.dun.getSheets()[0].getLastRow()-4,1),18).getValues().filter(r=>r[0]);
ok(gumRows.length===0, "рядок зник з файлу попереднього менеджера");
ok(dunRows.length===1, "рядок зʼявився у файлі нового менеджера (рівно 1)");
ok(dunRows[0] && dunRows[0][8]==="Дзвонив 12.08", "перенесено «Перший контакт»");
ok(dunRows[0] && dunRows[0][9]==="переписка Viber", "перенесено «Активність»");
ok(dunRows[0] && dunRows[0][16]==="Карточка клієнта", "перенесено «Оновлений статус»");
ok(dunRows[0] && dunRows[0][17]==="Просив передзвонити у вересні", "перенесено «Коментар»");
const mainRow = f.main.getRange(5,1,1,19).getValues()[0];
ok(mainRow[ctx.COL.CONTACT-1]==="Дзвонив 12.08", "дані обдзвону підтягнулись у головну");
ok(mainRow[ctx.COL.NEW_STATUS-1]==="Карточка клієнта", "«Оновлений статус» підтягнувся у головну");
const toNew = ctx.VIBER_SENT.find(v=>v.id==="VID_DUN");
const toOld = ctx.VIBER_SENT.find(v=>v.id==="VID_GUM");
ok(!!toNew && /передано контрагента/.test(toNew.text) && /актуалізувати інформацію та продовжити роботу/.test(toNew.text),
   "новий менеджер отримав повідомлення про передачу");
ok(!!toOld && /передано іншому менеджеру/.test(toOld.text), "попередній менеджер отримав повідомлення");
ok(ctx.OWNER_MSGS.length===1, "керівники отримали звіт про перепризначення");
ok(ctx.CRM_PUSH.length===1 && ctx.CRM_PUSH[0].manager==="Дунас Богдан", "зміна поїхала в L-TEX CRM");
const log = ctx.FILES.MAIN.getSheetByName("_transfers");
ok(!!log && log.getLastRow()===2, "запис у журналі «_transfers»");

// ── Тест 2: перше призначення (нікому не належав) ──
console.log("\n=== Тест 2: перше призначення — без зайвих сповіщень ===");
f = setup();
f.gum.getSheets()[0].deleteRow(5);   // ні в кого немає цього ліда
ctx.onMainEditTransfer({ range: f.main.getRange(5, ctx.COL.MANAGER, 1, 1), oldValue: "" });
ok(ctx.VIBER_SENT.length===0, "жодного повідомлення про «передачу» не надіслано");
ok(ctx.OWNER_MSGS.length===0, "керівникам нічого не надіслано");

// ── Тест 3: редагування іншої колонки ігнорується ──
console.log("\n=== Тест 3: редагування не тієї колонки ===");
f = setup();
ctx.onMainEditTransfer({ range: f.main.getRange(5, ctx.COL.STATUS, 1, 1), oldValue: "Очікує" });
ok(f.gum.getSheets()[0].getLastRow()===5, "файл попереднього менеджера не зачеплено");
ok(ctx.VIBER_SENT.length===0, "сповіщень немає");

// ── Тест 4: дублі в новому файлі прибираються ──
console.log("\n=== Тест 4: дублі рядка з тим самим ID ===");
f = setup();
f.dun.getSheets()[0].appendRow(["LTEX-1","01.08.2026","Іванова С.","","","","0671234567","","","","","","","",2026,"","",""]);
ctx.onMainEditTransfer({ range: f.main.getRange(5, ctx.COL.MANAGER, 1, 1), oldValue: "Гуменюк Євген" });
const dunRows2 = f.dun.getSheets()[0].getRange(5,1,Math.max(f.dun.getSheets()[0].getLastRow()-4,1),18).getValues().filter(r=>r[0]==="LTEX-1");
ok(dunRows2.length===1, "у новому файлі лишився рівно 1 рядок");

// ── Тест 5: неактивний менеджер теж віддає рядок ──
console.log("\n=== Тест 5: рядок у неактивного менеджера ===");
f = setup();
f.gum.getSheets()[0].deleteRow(5);
f.old.getSheets()[0].appendRow(["LTEX-1","01.08.2026","Іванова С.","","","","0671234567","","Контакт","","Очікує","","","",2026,"","",""]);
ctx.onMainEditTransfer({ range: f.main.getRange(5, ctx.COL.MANAGER, 1, 1), oldValue: "Стара Оксана" });
ok(f.old.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="", "рядок прибрано і з файлу неактивного менеджера");
ok(!!ctx.VIBER_SENT.find(v=>v.id==="VID_OLD"), "неактивний менеджер теж отримав повідомлення");

// ── Тест 6: reassignLead вручну ──
console.log("\n=== Тест 6: ручний виклик reassignLead ===");
f = setup();
f.main.getRange(5, ctx.COL.MANAGER).setValue("Гуменюк Євген");
ctx.reassignLead("LTEX-1", "Дунас Богдан");
ok(f.main.getRange(5, ctx.COL.MANAGER).getValue()==="Дунас Богдан", "менеджера змінено в головній");
ok(f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="LTEX-1", "рядок у новому файлі");
ok(f.gum.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="", "рядок зник зі старого файлу");

// ── Тест 7: cleanupManagerFilesFromMain ──
console.log("\n=== Тест 7: разове прибирання чужих рядків ===");
f = setup();
ctx.LOG=[];
ctx.cleanupManagerFilesFromMain(true);
ok(f.gum.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="LTEX-1", "dry-run нічого не видалив");
ctx.cleanupManagerFilesFromMain(false);
ok(f.gum.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="", "реальний запуск прибрав чужий рядок");


// ── Тести команди бота /передати ──
const ADMIN = {id:"VID_ADMIN", name:"Адмін"};
const GUM   = {id:"VID_GUM",   name:"Гуменюк"};
const DUN   = {id:"VID_DUN",   name:"Дунас"};
const CHUJY = {id:"VID_XXX",   name:"Хтось"};
function owned(f){ f.main.getRange(5, ctx.COL.MANAGER).setValue("Гуменюк Євген"); }
function last(id){ const m = ctx.VIBER_SENT.filter(v=>v.id===id); return m.length?m[m.length-1].text:""; }

console.log("\n=== Тест 8: /передати від адміністратора ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати 0671234567 Дунас Богдан", ADMIN);
ok(f.main.getRange(5, ctx.COL.MANAGER).getValue()==="Дунас Богдан", "менеджера змінено в головній");
ok(f.gum.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="", "рядок зник у старого менеджера");
ok(f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="LTEX-1", "рядок зʼявився у нового");
ok(/Контрагента передано/.test(last("VID_ADMIN")), "ініціатор отримав підтвердження");
ok(/передано контрагента/.test(last("VID_DUN")), "новий менеджер отримав сповіщення");
ok(/передано іншому менеджеру/.test(last("VID_GUM")), "попередній менеджер отримав сповіщення");

console.log("\n=== Тест 9: менеджер передає СВОГО клієнта ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати 0671234567 Дунас", GUM);
ok(f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="LTEX-1", "перенос виконано");
ok(/Контрагента передано/.test(last("VID_GUM")), "ініціатор отримав підтвердження");
ok(ctx.VIBER_SENT.filter(v=>v.id==="VID_GUM" && /передано іншому менеджеру/.test(v.text)).length===0,
   "ініціатору не продубльовано сповіщення «передано іншому»");

console.log("\n=== Тест 10: чужого клієнта передати не можна ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати 0671234567 Бойко", DUN);
ok(/закріплений за менеджером/.test(last("VID_DUN")), "відмова з поясненням");
ok(f.main.getRange(5, ctx.COL.MANAGER).getValue()==="Гуменюк Євген", "менеджер не змінився");

console.log("\n=== Тест 11: незареєстрований відправник ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати 0671234567 Дунас", CHUJY);
ok(/лише зареєстрованим менеджерам/.test(last("VID_XXX")), "стороннього відсічено");

console.log("\n=== Тест 12: неоднозначне імʼя менеджера ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати 0671234567 Богдан", ADMIN);
ok(/підходить кілька/.test(last("VID_ADMIN")), "просить уточнити (Дунас Богдан / Бойко Богдана)");
ok(f.main.getRange(5, ctx.COL.MANAGER).getValue()==="Гуменюк Євген", "нічого не змінено");

console.log("\n=== Тест 13: помилки і формати ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати", ADMIN);
ok(/Передати контрагента іншому менеджеру/.test(last("VID_ADMIN")), "порожня команда → підказка");
ctx.handleTransferCommand("/передати 0999999999 Дунас", ADMIN);
ok(/не знайдено в таблиці/.test(last("VID_ADMIN")), "невідомий номер → зрозуміла помилка");
ctx.handleTransferCommand("/передати LTEX-1 Дунас", ADMIN);
ok(f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="LTEX-1", "пошук за ID працює");

console.log("\n=== Тест 14: багаторядковий формат ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати\nТелефон: 0671234567\nМенеджер: Дунас Богдан", ADMIN);
ok(f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="LTEX-1", "перенос за полями Телефон/Менеджер");

console.log("\n=== Тест 15: клієнт уже в цього менеджера ===");
f = setup();
ctx.handleTransferCommand("/передати 0671234567 Дунас Богдан", ADMIN);
ok(/уже закріплений/.test(last("VID_ADMIN")), "повідомляє, що змінювати нічого");


// ── Тест 16: константи з Code.gs НЕ видно (баг «MAIN_FILE_ID is not defined») ──
// ── Тести розбору з описом через пробіл ──
console.log("\n=== Тест 15б: неоднозначне імʼя + опис ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати 0671234567 Богдан Питає ціну", ADMIN);
ok(/підходить кілька/.test(last("VID_ADMIN")), "просить уточнити, а не приймає опис за імʼя");
ok(f.main.getRange(5, ctx.COL.MANAGER).getValue()==="Гуменюк Євген", "нічого не змінено");

console.log("\n=== Тест 15в: невідомий менеджер + опис ===");
f = setup(); owned(f);
ctx.handleTransferCommand("/передати 0671234567 Петренко Олег Питає ціну", ADMIN);
ok(/не знайдено/.test(last("VID_ADMIN")), "зрозуміла помилка про менеджера");
ok(/Петренко Олег/.test(last("VID_ADMIN")), "у помилці саме імʼя, а не весь текст");

console.log("\n=== Тест 16: робота без констант із Code.gs ===");
f = setup(); owned(f);
const saved = {};
["MAIN_FILE_ID","MAIN_SHEET","MGR_SHEET","DATA_START","MAIN_LAST_COL","MGR_LAST_COL",
 "MGR_DATA_START","MGR_COL_NEW_STATUS","MGR_COL_NEW_COMMENT","COL","MGR_COL",
 "ADMIN_VIBER_ID","NOTIFY_IDS"].forEach(k => { saved[k]=ctx[k]; ctx[k]=undefined; });
// запасні значення модуля перенаправляємо на тестові файли
ctx.TR_MAIN_FILE_ID = "MAIN";
ctx.TR_MAIN_SHEET   = "🔒 2026";
ctx.TR_MGR_SHEET    = "⚙️ Менеджери";
ctx.TR_ADMIN_VIBER_ID = "VID_ADMIN";
ctx.TR_NOTIFY_IDS   = ["VID_ADMIN"];
let boom = null;
try {
  ctx.handleTransferCommand("/передати 0671234567 Дунас Богдан", ADMIN);
  ctx.onMainEditTransfer({ range: f.main.getRange(5, 11, 1, 1), oldValue: "Гуменюк Євген" });
} catch (e) { boom = e; }
ok(!boom, "модуль не падає з ReferenceError" + (boom ? ": "+boom.message : ""));
ok(f.dun.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="LTEX-1", "перенос спрацював на запасних константах");
ok(f.gum.getSheets()[0].getRange(5,1,1,18).getValues()[0][0]==="", "рядок прибрано у попереднього менеджера");
Object.keys(saved).forEach(k => { ctx[k]=saved[k]; });


// ── Тест 17: діагностика checkTransferSetup ──
console.log("\n=== Тест 17: checkTransferSetup ===");
f = setup(); ctx.LOG = [];
let diagErr = null;
try { ctx.checkTransferSetup(); } catch (e) { diagErr = e; }
const diag = ctx.LOG.join("\n");
ok(!diagErr, "діагностика відпрацювала без помилки" + (diagErr ? ": "+diagErr.message : ""));
ok(/✅ getManagers\(\)/.test(diag), "наявну функцію CRM визначено як доступну");
ok(/✅ syncToManager\(\)/.test(diag) && /✅ sendViber\(\)/.test(diag), "решту функцій теж видно");
ok(/getManagers\(\) повернув 3 менеджер/.test(diag), "реальний виклик getManagers() відпрацював");
ok(/Головна таблиця відкривається/.test(diag), "головна таблиця перевірена");

console.log("\n" + (fails ? "❌ Провалено перевірок: "+fails : "✅ Усі перевірки пройдено"));
process.exit(fails?1:0);
