// ── Мінімальна емуляція Google Apps Script для перевірки логіки ──
var LOG = [];
var Logger = { log: function(m){ LOG.push(String(m)); } };
var VIBER_SENT = [];
var OWNER_MSGS = [];
var CRM_PUSH   = [];

var MAIN_SHEET = "🔒 2026";
var MGR_SHEET  = "⚙️ Менеджери";
var DATA_START = 5;
var MAIN_FILE_ID = "MAIN";
var COL = {ID:1,DATE:2,NAME:3,CAT:4,REGION:5,CITY:6,PHONE:7,INTEREST:8,CONTACT:9,ACTIVITY:10,
           MANAGER:11,STATUS:12,CHANNEL:13,SITE:14,TG:15,DUPS:16,YEAR:17,NEW_STATUS:18,NEW_COMMENT:19};
var MGR_COL = {NAME:1,ROLE:2,VIBER_ID:3,FILE_ID:4,ADDED:5,ACTIVE:6};
var MAIN_LAST_COL = 19, MGR_LAST_COL = 18;
var MGR_COL_NEW_STATUS = 17, MGR_COL_NEW_COMMENT = 18;
var MGR_DATA_START = 5;
var ADMIN_VIBER_ID = "VID_ADMIN";
var NOTIFY_IDS = ["VID_ADMIN"];

function pad(row, n){ while(row.length<n) row.push(""); return row; }

function MockSheet(name, rows){ this.name=name; this.data=rows||[]; this.hidden=false; }
MockSheet.prototype.getName=function(){return this.name;};
MockSheet.prototype.setName=function(n){this.name=n;return this;};
MockSheet.prototype.getIndex=function(){return 1;};
MockSheet.prototype.hideSheet=function(){this.hidden=true;return this;};
MockSheet.prototype.getLastRow=function(){
  var last=0;
  for (var i=0;i<this.data.length;i++){
    var r=this.data[i]||[];
    for (var j=0;j<r.length;j++) if (r[j]!=="" && r[j]!==null && r[j]!==undefined){ last=i+1; break; }
  }
  return last;
};
MockSheet.prototype.getLastColumn=function(){
  var last=0;
  for (var i=0;i<this.data.length;i++){ var r=this.data[i]||[];
    for (var j=0;j<r.length;j++) if (r[j]!=="" && r[j]!==null && r[j]!==undefined) last=Math.max(last,j+1); }
  return last;
};
MockSheet.prototype.getMaxRows=function(){return Math.max(this.data.length,1000);};
MockSheet.prototype.getMaxColumns=function(){return Math.max(this.getLastColumn(),26);};
MockSheet.prototype._cell=function(r,c){
  while(this.data.length<r) this.data.push([]);
  pad(this.data[r-1], c);
  return this.data[r-1];
};
MockSheet.prototype.getRange=function(a,b,c,d){
  if (typeof a === "string") throw new Error("A1 notation не підтримується в тесті: "+a);
  return new MockRange(this, a, b, c||1, d||1);
};
MockSheet.prototype.deleteRow=function(r){ this.data.splice(r-1,1); };
MockSheet.prototype.appendRow=function(arr){ this.data[this.getLastRow()] = arr.slice(); };
MockSheet.prototype.setFrozenRows=function(){return this;};
MockSheet.prototype.setColumnWidth=function(){return this;};

function MockRange(sheet,row,col,nRows,nCols){ this.s=sheet; this.r=row; this.c=col; this.nr=nRows; this.nc=nCols; }
MockRange.prototype.getRow=function(){return this.r;};
MockRange.prototype.getColumn=function(){return this.c;};
MockRange.prototype.getLastRow=function(){return this.r+this.nr-1;};
MockRange.prototype.getLastColumn=function(){return this.c+this.nc-1;};
MockRange.prototype.getNumRows=function(){return this.nr;};
MockRange.prototype.getNumColumns=function(){return this.nc;};
MockRange.prototype.getSheet=function(){return this.s;};
MockRange.prototype.getValues=function(){
  var out=[];
  for (var i=0;i<this.nr;i++){
    var row=this.s._cell(this.r+i, this.c+this.nc-1), slice=[];
    for (var j=0;j<this.nc;j++){ var v=row[this.c-1+j]; slice.push(v===undefined?"":v); }
    out.push(slice);
  }
  return out;
};
MockRange.prototype.getValue=function(){ return this.getValues()[0][0]; };
MockRange.prototype.setValue=function(v){
  for (var i=0;i<this.nr;i++){ var row=this.s._cell(this.r+i,this.c+this.nc-1);
    for (var j=0;j<this.nc;j++) row[this.c-1+j]=v; }
  return this;
};
MockRange.prototype.setValues=function(vals){
  for (var i=0;i<vals.length;i++){ var row=this.s._cell(this.r+i,this.c+vals[i].length-1);
    for (var j=0;j<vals[i].length;j++) row[this.c-1+j]=vals[i][j]; }
  return this;
};
["setNumberFormat","setFontWeight","setBackground","setFontColor","setWrap","setDataValidation",
 "setHorizontalAlignment","setVerticalAlignment","merge","breakApart"].forEach(function(m){
  MockRange.prototype[m]=function(){return this;};
});

var FILES = {};   // fileId -> {sheets:[MockSheet], byName:{}}
function MockSpreadsheet(id){ this.id=id; this.sheets=[]; }
MockSpreadsheet.prototype.getSheets=function(){return this.sheets;};
MockSpreadsheet.prototype.getSheetByName=function(n){
  for (var i=0;i<this.sheets.length;i++) if (this.sheets[i].getName()===n) return this.sheets[i];
  return null;
};
MockSpreadsheet.prototype.insertSheet=function(n){ var s=new MockSheet(n,[]); this.sheets.push(s); return s; };

var SpreadsheetApp = {
  openById: function(id){ if (!FILES[id]) throw new Error("Файл "+id+" не знайдено"); return FILES[id]; },
  flush: function(){}
};

var LockService = { getScriptLock: function(){ return { tryLock:function(){return true;}, releaseLock:function(){} }; } };
var Session = { getScriptTimeZone: function(){ return "Europe/Kyiv"; } };
var Utilities = { formatDate: function(d){ return d.toISOString().substring(0,10); } };

function generateId(){ return "LTEX-TEST-"+Math.floor(Math.random()*9000+1000); }
function sendViber(id,text){ VIBER_SENT.push({id:id,text:text}); }
function notifyOwners(text){ OWNER_MSGS.push(text); }
function pushLeadToLtexCrm(row,id,by){ CRM_PUSH.push({id:id,manager:row[COL.MANAGER-1],by:by}); }

// ── справжня syncToManager з Code.gs (без змін) ──
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
      if (cell instanceof Date) return Utilities.formatDate(cell);
      return cell;
    });
    var mgrFormatted = [];
    for (var c=0;c<10;c++) mgrFormatted.push(formatted[c]||"");
    for (var c2=11;c2<15;c2++) mgrFormatted.push(formatted[c2]||"");
    mgrFormatted.push(formatted[16]||"");
    mgrFormatted.push(formatted[15]||"");
    mgrFormatted.push(formatted[17]||"");
    mgrFormatted.push(formatted[18]||"");
    if (targetRow===-1) {
      if (mgrFormatted.length > 8) mgrFormatted[8]="";
      if (mgrFormatted.length > 9) mgrFormatted[9]="";
      sheet.appendRow(mgrFormatted);
      targetRow=sheet.getLastRow();
    } else {
      var existingRow=sheet.getRange(targetRow,1,1,Math.max(mgrFormatted.length,10)).getValues()[0];
      if (mgrFormatted.length > 8) mgrFormatted[8]=existingRow[8];
      if (mgrFormatted.length > 9) mgrFormatted[9]=existingRow[9];
      if (mgrFormatted.length > 16 && mgrFormatted[16]==="") mgrFormatted[16]=existingRow[16]||"";
      if (mgrFormatted.length > 17 && mgrFormatted[17]==="") mgrFormatted[17]=existingRow[17]||"";
      sheet.getRange(targetRow,1,1,mgrFormatted.length).setValues([mgrFormatted]);
    }
    sheet.getRange(targetRow,7).setNumberFormat("@");
    return true;
  } catch(err) { Logger.log("syncToManager ("+managerName+"): "+err); return false; }
}

function getManagers(){
  var out={};
  var sheet = FILES[MAIN_FILE_ID].getSheetByName(MGR_SHEET);
  var data = sheet.getRange(2,1,sheet.getLastRow()-1,6).getValues();
  data.forEach(function(r){
    if (!r[0]) return;
    if (r[5]===false) return;
    out[r[0]] = {role:r[1], viberId:r[2], fileId:r[3]};
  });
  return out;
}
