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
  ]);
  const mainSS = new SS("MAIN"); mainSS.sheets=[main,mgrs];
  const gum = new SS("F_GUM"); gum.sheets=[new S("Клієнти", hdr().concat([
    ["LTEX-1","01.08.2026","Іванова С.","Магазин","Львівська","Львів","0671234567","Bric-a-Brac",
     "Дзвонив 12.08","переписка Viber","Очікує","Google","","",2026,"","Карточка клієнта","Просив передзвонити у вересні"]
  ]))];
  const dun = new SS("F_DUN"); dun.sheets=[new S("Клієнти", hdr())];
  const old = new SS("F_OLD"); old.sheets=[new S("Клієнти", hdr())];
  ctx.FILES = {MAIN:mainSS, F_GUM:gum, F_DUN:dun, F_OLD:old};
  ctx.VIBER_SENT=[]; ctx.OWNER_MSGS=[]; ctx.CRM_PUSH=[]; ctx.LOG=[];
  return {main, gum, dun, old};
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

console.log("\n" + (fails ? "❌ Провалено перевірок: "+fails : "✅ Усі перевірки пройдено"));
process.exit(fails?1:0);
