// ============================================================
// TENNIS TEAM SCHEDULER — Google Apps Script Backend
// Paste this entire file into Extensions → Apps Script
// then deploy as a Web App (see README instructions)
// ============================================================

function getSheet(tab) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
}

function doGet(e) {
  const result = route(e.parameter.action, e.parameter, null);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  const result = route(body.action, e.parameter, body);
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function route(action, params, body) {
  try {
    switch (action) {
      case "getPlayers":      return getPlayers();
      case "addPlayer":       return addPlayer(body);
      case "getAvailability": return getAvailability();
      case "setAvailability": return setAvailability(body);
      case "getScores":       return getScores();
      case "setScore":        return setScore(body);
      case "getPairings":     return getPairings();
      case "setPairing":      return setPairing(body);
      case "deletePairing":   return deletePairing(body);
      case "getMatchMeta":    return getMatchMeta();
      case "setMatchMeta":    return setMatchMeta(body);
      case "initSheet":       return initSheet();
      default: return { ok: false, error: "Unknown action: " + action };
    }
  } catch (err) {
    return { ok: false, error: err.toString() };
  }
}

// ── INIT ─────────────────────────────────────────────────────
function initSheet() {
  const tabs = {
    Players:      ["id", "name", "role"],
    Availability: ["playerId", "weekId", "status"],
    Scores:       ["weekId", "rubber1_us", "rubber1_them", "rubber1_us2", "rubber1_them2",
                   "rubber2_us", "rubber2_them", "rubber2_us2", "rubber2_them2",
                   "r1players", "r2players"],
    Pairings:     ["id", "player1Id", "player2Id", "priority", "notes"],
    MatchMeta:    ["weekId", "isHome", "snacksPlayerId", "notes"],
  };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (const [name, headers] of Object.entries(tabs)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);
  }
  return { ok: true, message: "Sheets initialised" };
}

// ── PLAYERS ──────────────────────────────────────────────────
function getPlayers() {
  const sheet = getSheet("Players");
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, data: [] };
  const [headers, ...data] = rows;
  return { ok: true, data: data.map(r => rowToObj(headers, r)) };
}

function addPlayer(body) {
  const sheet = getSheet("Players");
  const id = Date.now().toString();
  sheet.appendRow([id, body.name, body.role || "player"]);
  return { ok: true, id };
}

// ── AVAILABILITY ─────────────────────────────────────────────
function getAvailability() {
  const sheet = getSheet("Availability");
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, data: {} };
  const [, ...data] = rows;
  const result = {};
  data.forEach(r => { result[`${r[0]}-${r[1]}`] = r[2]; });
  return { ok: true, data: result };
}

function setAvailability(body) {
  const sheet = getSheet("Availability");
  const rows = sheet.getDataRange().getValues();
  const key = `${body.playerId}-${body.weekId}`;
  for (let i = 1; i < rows.length; i++) {
    if (`${rows[i][0]}-${rows[i][1]}` === key) {
      sheet.getRange(i + 1, 3).setValue(body.status);
      return { ok: true };
    }
  }
  sheet.appendRow([body.playerId, body.weekId, body.status]);
  return { ok: true };
}

// ── SCORES ───────────────────────────────────────────────────
function getScores() {
  const sheet = getSheet("Scores");
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, data: {} };
  const [, ...data] = rows;
  const result = {};
  data.forEach(r => {
    result[`1-${r[0]}`] = {
      rubber1: { us: r[1], them: r[2], us2: r[3], them2: r[4] },
      rubber2: { us: r[5], them: r[6], us2: r[7], them2: r[8] },
      players: {
        r1: r[9] ? r[9].toString().split(",").map(Number) : [],
        r2: r[10] ? r[10].toString().split(",").map(Number) : [],
      }
    };
  });
  return { ok: true, data: result };
}

function setScore(body) {
  const sheet = getSheet("Scores");
  const rows = sheet.getDataRange().getValues();
  const { weekId, rubber1, rubber2, players } = body;
  const row = [
    weekId,
    rubber1.us, rubber1.them, rubber1.us2, rubber1.them2,
    rubber2.us, rubber2.them, rubber2.us2, rubber2.them2,
    (players.r1 || []).join(","),
    (players.r2 || []).join(","),
  ];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === weekId.toString()) {
      sheet.getRange(i + 1, 1, 1, row.length).setValues([row]);
      return { ok: true };
    }
  }
  sheet.appendRow(row);
  return { ok: true };
}

// ── PAIRINGS ─────────────────────────────────────────────────
function getPairings() {
  const sheet = getSheet("Pairings");
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, data: [] };
  const [headers, ...data] = rows;
  return { ok: true, data: data.map(r => rowToObj(headers, r)) };
}

function setPairing(body) {
  const sheet = getSheet("Pairings");
  const rows = sheet.getDataRange().getValues();
  if (body.id) {
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0].toString() === body.id.toString()) {
        sheet.getRange(i + 1, 1, 1, 5).setValues([[body.id, body.player1Id, body.player2Id, body.priority, body.notes || ""]]);
        return { ok: true };
      }
    }
  }
  const id = Date.now().toString();
  sheet.appendRow([id, body.player1Id, body.player2Id, body.priority, body.notes || ""]);
  return { ok: true, id };
}

function deletePairing(body) {
  const sheet = getSheet("Pairings");
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === body.id.toString()) {
      sheet.deleteRow(i + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "Pairing not found" };
}

// ── MATCH META (home flag, snacks, notes) ─────────────────────
function getMatchMeta() {
  const sheet = getSheet("MatchMeta");
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return { ok: true, data: {} };
  const [, ...data] = rows;
  const result = {};
  data.forEach(r => {
    result[r[0]] = {
      isHome: r[1] === true || r[1] === "true" || r[1] === "TRUE",
      snacksPlayerId: r[2] ? r[2].toString() : "",
      notes: r[3] ? r[3].toString() : "",
    };
  });
  return { ok: true, data: result };
}

function setMatchMeta(body) {
  // body: { weekId, isHome, snacksPlayerId, notes }
  const sheet = getSheet("MatchMeta");
  const rows = sheet.getDataRange().getValues();
  const row = [body.weekId, body.isHome, body.snacksPlayerId || "", body.notes || ""];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0].toString() === body.weekId.toString()) {
      sheet.getRange(i + 1, 1, 1, 4).setValues([row]);
      return { ok: true };
    }
  }
  sheet.appendRow(row);
  return { ok: true };
}

// ── UTIL ─────────────────────────────────────────────────────
function rowToObj(headers, row) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = row[i]; });
  return obj;
}
