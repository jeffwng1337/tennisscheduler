import { useState, useMemo, useEffect, useCallback } from "react";

// ─── CONFIG ────────────────────────────────────────────────────
const API_URL = "https://script.google.com/macros/s/AKfycbx_ekjaz-rvoXMYVCoQZ2kW8RR3ynstOwvYm7YIDHaLPu4fzimhBVjI2rkcKgEalGBVcg/exec";

// ─── FALLBACK SCHEDULE ─────────────────────────────────────────
// Used until getSchedule loads from the backend.
// The Apps Script getSchedule action should return:
// { ok: true, data: [{ id, label, date, opponent, defaultVenue }, …] }
// where `date` is a display string (e.g. "2 Jul") and
// `defaultVenue` is "Home" or "Away".
const DEFAULT_WEEKS = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1,
  label: `Week ${i + 1}`,
  date: (() => {
    const d = new Date(2026, 6, 2);
    d.setDate(d.getDate() + i * 7);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  })(),
  opponent: [
    "Tennis Valley","Strathfield","Chatswood","SydUni",
    "Neutral Bay","Coogee","Sylvania Waters","Strathfield",
    "SydUni","Neutural Bay","Coogee","Sylvania Waters","Tennis Valley","Chatswood"
  ][i],
  defaultVenue: i % 2 === 0 ? "Home" : "Away",
}));

// ─── API HELPERS ───────────────────────────────────────────────
async function api(action, body = null) {
  try {
    if (body) {
      const r = await fetch(API_URL, { method: "POST", body: JSON.stringify({ action, ...body }) });
      return await r.json();
    } else {
      const r = await fetch(`${API_URL}?action=${action}`);
      return await r.json();
    }
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

// ─── HELPERS ───────────────────────────────────────────────────
const availColor = { available: "#22c55e", unavailable: "#ef4444", maybe: "#f59e0b", "": "#334155" };
const availLabel = { available: "✓", unavailable: "✗", maybe: "?", "": "—" };
const cycle = { "": "available", available: "maybe", maybe: "unavailable", unavailable: "" };

// A rubber is won if we win the majority of its 2 sets.
function rubberResult(r) {
  if (!r || r.us === "" || r.us === undefined) return null;
  const setWins = (r.us > r.them ? 1 : 0) + (r.us2 > r.them2 ? 1 : 0);
  return setWins >= 2 ? "W" : "L";
}

// Total sets won/lost across all 4 rubbers.
function setTotals(score) {
  let us = 0, them = 0;
  [score.rubber1, score.rubber2, score.rubber3, score.rubber4].forEach(r => {
    if (!r || r.us === "" || r.us === undefined) return;
    if (Number(r.us) > Number(r.them)) us++; else if (Number(r.them) > Number(r.us)) them++;
    if (Number(r.us2) > Number(r.them2)) us++; else if (Number(r.them2) > Number(r.us2)) them++;
  });
  return { us, them };
}

// Total games won/lost across all 4 rubbers.
function gameTotals(score) {
  let us = 0, them = 0;
  [score.rubber1, score.rubber2, score.rubber3, score.rubber4].forEach(r => {
    if (!r || r.us === "" || r.us === undefined) return;
    us += (Number(r.us) || 0) + (Number(r.us2) || 0);
    them += (Number(r.them) || 0) + (Number(r.them2) || 0);
  });
  return { us, them };
}

// Match result: 3-tier tiebreaker — rubbers → sets → games.
function matchResult(score) {
  if (!score) return null;
  const rubbers = [score.rubber1, score.rubber2, score.rubber3, score.rubber4]
    .map(rubberResult).filter(r => r !== null);
  if (rubbers.length === 0) return null;
  const rubberWins = rubbers.filter(r => r === "W").length;
  const rubberLosses = rubbers.length - rubberWins;
  if (rubberWins > rubberLosses) return "W";
  if (rubberLosses > rubberWins) return "L";
  // Tiebreaker 1: total sets
  const sets = setTotals(score);
  if (sets.us > sets.them) return "W";
  if (sets.them > sets.us) return "L";
  // Tiebreaker 2: total games
  const games = gameTotals(score);
  if (games.us > games.them) return "W";
  if (games.them > games.us) return "L";
  return "D";
}

// Compact score line for one rubber in the score table.
// Each set is coloured independently: green if won, red if lost, grey if tied.
function RubberLine({ rub, label }) {
  if (!rub || rub.us === "") return null;
  function setColor(us, them) {
    const u = Number(us), t = Number(them);
    return u > t ? "#22c55e" : u < t ? "#ef4444" : "#94a3b8";
  }
  return (
    <div style={{ fontSize: 11, lineHeight: 1.5 }}>
      <span style={{ color: "#64748b" }}>{label}: </span>
      <span style={{ color: setColor(rub.us, rub.them) }}>{rub.us}–{rub.them}</span>
      {" "}
      <span style={{ color: setColor(rub.us2, rub.them2) }}>{rub.us2}–{rub.them2}</span>
    </div>
  );
}

// ─── APP ───────────────────────────────────────────────────────
export default function TennisApp() {
  const [view, setView] = useState("schedule");
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);   // populated from getSchedule
  const [players, setPlayers] = useState([]);
  const [availability, setAvailability] = useState({});
  const [scores, setScores] = useState({});
  const [pairings, setPairings] = useState([]);
  const [matchMeta, setMatchMeta] = useState({});       // { isHome, snacksPlayerId, notes }
  const [currentUser, setCurrentUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [apiConfigured] = useState(API_URL !== "YOUR_APPS_SCRIPT_URL_HERE");

  const [scoreFilter, setScoreFilter] = useState("all");
  const [venueFilter, setVenueFilter] = useState("all");
  const [sortScores, setSortScores] = useState("week");
  const [editingScore, setEditingScore] = useState(null);
  const [newPairing, setNewPairing] = useState({ player1Id: "", player2Id: "", priority: 1, notes: "" });
  const [addingPlayer, setAddingPlayer] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState("");
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [availFilter, setAvailFilter] = useState("all");

  const isCapt = players.find(p => p.id?.toString() === currentUser?.toString())?.role === "captain";

  function isHome(weekId) {
    const meta = matchMeta[weekId];
    if (meta && meta.isHome !== undefined && meta.isHome !== "") return meta.isHome === true || meta.isHome === "true";
    return weeks.find(w => w.id === weekId)?.defaultVenue === "Home";
  }

  // ── LOAD DATA ─────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!apiConfigured) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [p, a, s, pr, mm, sch] = await Promise.all([
        api("getPlayers"), api("getAvailability"), api("getScores"),
        api("getPairings"), api("getMatchMeta"), api("getSchedule"),
      ]);
      if (p.ok) setPlayers(p.data);
      if (a.ok) setAvailability(a.data || {});
      if (s.ok) setScores(s.data || {});
      if (pr.ok) setPairings(pr.data.map(x => ({ ...x, player1Id: +x.player1Id, player2Id: +x.player2Id, priority: +x.priority })));
      if (mm.ok) setMatchMeta(mm.data || {});
      // Only override the fallback if the backend returns valid schedule data
      if (sch.ok && Array.isArray(sch.data) && sch.data.length > 0) setWeeks(sch.data);
    } catch (e) { setError("Could not connect to Google Sheets. Check your API URL."); }
    setLoading(false);
  }, [apiConfigured]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── MATCH META ────────────────────────────────────────────────
  async function updateMatchMeta(weekId, patch) {
    const current = matchMeta[weekId] || {
      isHome: weeks.find(w => w.id === weekId)?.defaultVenue === "Home",
      snacksPlayerId: "", notes: ""
    };
    const updated = { ...current, ...patch };
    setMatchMeta(m => ({ ...m, [weekId]: updated }));
    setSaving(true);
    await api("setMatchMeta", { weekId, ...updated });
    setSaving(false);
  }

  function assignSnacks(weekId, playerId) {
    const current = matchMeta[weekId]?.snacksPlayerId;
    const next = current?.toString() === playerId?.toString() ? "" : playerId;
    updateMatchMeta(weekId, { snacksPlayerId: next });
  }

  // ── AVAILABILITY ──────────────────────────────────────────────
  async function toggleAvail(playerId, weekId) {
    const key = `${playerId}-${weekId}`;
    const cur = availability[key] || "";
    const next = cycle[cur];
    setAvailability(a => ({ ...a, [key]: next }));
    setSaving(true);
    await api("setAvailability", { playerId, weekId, status: next });
    setSaving(false);
  }

  function countAvail(weekId) {
    return players.filter(p => availability[`${p.id}-${weekId}`] === "available").length;
  }

  function getAvailForWeek(weekId) {
    return players.map(p => ({ player: p, status: availability[`${p.id}-${weekId}`] || "" }));
  }

  // ── SCORES ────────────────────────────────────────────────────
  async function saveScore(weekId, data) {
    // Optimistic update — apply immediately so the UI never reverts
    setScores(s => ({ ...s, [`1-${weekId}`]: data }));
    setEditingScore(null);
    setSaving(true);
    const res = await api("setScore", { weekId, ...data });
    if (!res.ok) {
      setError(`Score saved locally but failed to sync: ${res.error || "unknown error"}. Refresh will reload sheet data.`);
    }
    setSaving(false);
  }

  const filteredWeeks = useMemo(() => {
    let ws = weeks;
    if (venueFilter !== "all") ws = ws.filter(w => (isHome(w.id) ? "Home" : "Away") === venueFilter);
    if (scoreFilter === "scored") ws = ws.filter(w => matchResult(scores[`1-${w.id}`]) !== null);
    if (scoreFilter === "unscored") ws = ws.filter(w => matchResult(scores[`1-${w.id}`]) === null);
    if (scoreFilter === "W") ws = ws.filter(w => matchResult(scores[`1-${w.id}`]) === "W");
    if (scoreFilter === "L") ws = ws.filter(w => matchResult(scores[`1-${w.id}`]) === "L");
    if (sortScores === "result") ws = [...ws].sort((a, b) => {
      const order = { W: 0, D: 1, L: 2, null: 3 };
      return (order[matchResult(scores[`1-${a.id}`])] ?? 3) - (order[matchResult(scores[`1-${b.id}`])] ?? 3);
    });
    return ws;
  }, [scoreFilter, venueFilter, sortScores, scores, matchMeta, weeks]);

  // ── PAIRINGS ──────────────────────────────────────────────────
  async function addPairing() {
    if (!newPairing.player1Id || !newPairing.player2Id || newPairing.player1Id === newPairing.player2Id) return;
    setSaving(true);
    const res = await api("setPairing", { ...newPairing, player1Id: +newPairing.player1Id, player2Id: +newPairing.player2Id });
    if (res.ok) {
      setPairings(p => [...p, { ...newPairing, id: res.id, player1Id: +newPairing.player1Id, player2Id: +newPairing.player2Id }]);
      setNewPairing({ player1Id: "", player2Id: "", priority: 1, notes: "" });
    }
    setSaving(false);
  }

  async function updatePairingPriority(id, priority) {
    const pair = pairings.find(p => p.id?.toString() === id?.toString());
    if (!pair) return;
    setPairings(ps => ps.map(p => p.id?.toString() === id?.toString() ? { ...p, priority } : p));
    await api("setPairing", { ...pair, priority });
  }

  async function updatePairingNotes(id, notes) {
    const pair = pairings.find(p => p.id?.toString() === id?.toString());
    if (!pair) return;
    setPairings(ps => ps.map(p => p.id?.toString() === id?.toString() ? { ...p, notes } : p));
    await api("setPairing", { ...pair, notes });
  }

  async function deletePairing(id) {
    setSaving(true);
    await api("deletePairing", { id });
    setPairings(ps => ps.filter(p => p.id?.toString() !== id?.toString()));
    setSaving(false);
  }

  function suggestPairings(weekId) {
    const avail = players.filter(p => availability[`${p.id}-${weekId}`] === "available");
    const sorted = [...pairings].sort((a, b) => a.priority - b.priority);
    const used = new Set(); const picks = [];
    for (const pair of sorted) {
      if (picks.length >= 2) break;
      const p1 = avail.find(p => p.id?.toString() === pair.player1Id?.toString());
      const p2 = avail.find(p => p.id?.toString() === pair.player2Id?.toString());
      if (p1 && p2 && !used.has(p1.id) && !used.has(p2.id)) {
        picks.push({ pair, p1, p2 }); used.add(p1.id); used.add(p2.id);
      }
    }
    return picks;
  }

  // ── PLAYERS ───────────────────────────────────────────────────
  async function addPlayer() {
    if (!newPlayerName.trim()) return;
    setSaving(true);
    const res = await api("addPlayer", { name: newPlayerName.trim(), role: "player" });
    if (res.ok) { setPlayers(ps => [...ps, { id: res.id, name: newPlayerName.trim(), role: "player" }]); setNewPlayerName(""); setAddingPlayer(false); }
    setSaving(false);
  }

  // ── STATS ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let wins = 0, losses = 0, draws = 0;
    let rubberWins = 0, rubberTotal = 0;
    let setsWon = 0, setsLost = 0;
    let gamesWon = 0, gamesLost = 0;
    weeks.forEach(w => {
      const s = scores[`1-${w.id}`]; if (!s) return;
      const r = matchResult(s);
      if (r === "W") wins++; if (r === "L") losses++; if (r === "D") draws++;
      [s.rubber1, s.rubber2, s.rubber3, s.rubber4].forEach(rub => {
        if (!rub || rub.us === "" || rub.us === undefined) return;
        if (rubberResult(rub) === "W") rubberWins++;
        rubberTotal++;
        // Sets per rubber
        const s1us = Number(rub.us), s1them = Number(rub.them);
        const s2us = Number(rub.us2), s2them = Number(rub.them2);
        if (s1us > s1them) setsWon++; else if (s1them > s1us) setsLost++;
        if (s2us > s2them) setsWon++; else if (s2them > s2us) setsLost++;
        // Games per rubber
        gamesWon += s1us + s2us;
        gamesLost += s1them + s2them;
      });
    });
    return { wins, losses, draws, rubberWins, rubberTotal, setsWon, setsLost, gamesWon, gamesLost, played: wins + losses + draws };
  }, [scores, weeks]);

  const playerName = (id) => players.find(p => p.id?.toString() === id?.toString())?.name || "?";

  // ── SETUP / LOADING SCREENS ───────────────────────────────────
  if (!apiConfigured) return (
    <div style={css.app}>
      <div style={css.setupBox}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>🎾</div>
        <div style={css.setupTitle}>Kooroora 5 — Setup Required</div>
        <div style={css.setupText}>Paste your Google Apps Script deployment URL into <code style={css.code}>API_URL</code> at the top of this file, then reload.</div>
        <div style={css.setupSteps}>
          {["Open your Google Sheet → Extensions → Apps Script","Paste the contents of Code.gs and save","Click Deploy → New Deployment → Web App","Set 'Who has access' to Anyone","Copy the deployment URL into this file","Run initSheet() once to create tabs"].map((s, i) => (
            <div key={i} style={css.step}><span style={css.stepNum}>{i+1}</span>{s}</div>
          ))}
        </div>
      </div>
    </div>
  );

  if (loading) return (
    <div style={css.app}>
      <div style={css.loadingBox}>
        <div style={css.spinner} />
        <div style={{ color: "#7dd3fc", marginTop: 16 }}>Loading from Google Sheets…</div>
      </div>
    </div>
  );

  if (players.length === 0) return (
    <div style={css.app}>
      <div style={css.setupBox}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>🎾</div>
        <div style={css.setupTitle}>Add your first player</div>
        <div style={css.setupText}>Your sheet is connected! Add players to get started.</div>
        <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "center" }}>
          <input style={css.setupInput} placeholder="Player name" value={newPlayerName}
            onChange={e => setNewPlayerName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} autoFocus />
          <button style={css.addBtn} onClick={addPlayer}>Add</button>
        </div>
        {error && <div style={css.errorMsg}>{error}</div>}
      </div>
    </div>
  );

  // ── MAIN APP ──────────────────────────────────────────────────
  return (
    <div style={css.app}>
      <header style={css.header}>
        <div style={css.headerInner}>
          <div style={css.brand}>
            <div style={{ fontSize: 28 }}>🎾</div>
            <div>
              <div style={css.clubName}>Kooroora 5</div>
              <div style={css.season}>Season 2026 · Doubles League</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {saving && <div style={css.savingPill}>saving…</div>}
            {error && <div style={css.errorPill}>⚠ {error}</div>}
            <select style={css.userSelect} value={currentUser || ""} onChange={e => setCurrentUser(e.target.value || null)}>
              <option value="">Select your name…</option>
              {players.map(p => <option key={p.id} value={p.id}>{p.name}{p.role === "captain" ? " (C)" : ""}</option>)}
            </select>
          </div>
        </div>
        <nav style={css.nav}>
          {["schedule","scores","availability","pairings"].map(v => (
            <button key={v} style={{ ...css.navBtn, ...(view === v ? css.navActive : {}) }} onClick={() => setView(v)}>
              {v.charAt(0).toUpperCase() + v.slice(1)}
            </button>
          ))}
        </nav>
      </header>

      <main style={css.main}>

        {/* ── SCHEDULE ── */}
        {view === "schedule" && (
          <div>
            <div style={css.statsStrip}>
              {[
                { label: "Played", val: stats.played },
                { label: "Won", val: stats.wins, color: "#22c55e" },
                { label: "Lost", val: stats.losses, color: "#ef4444" },
                { label: "Drew", val: stats.draws, color: "#f59e0b" },
                { label: "Rubbers", val: `${stats.rubberWins}/${stats.rubberTotal}` },
                { label: "Sets", val: `${stats.setsWon}/${stats.setsWon + stats.setsLost}` },
                { label: "Games", val: `${stats.gamesWon}/${stats.gamesWon + stats.gamesLost}` },
              ].map(s => (
                <div key={s.label} style={css.statBox}>
                  <div style={{ ...css.statVal, color: s.color || "#7dd3fc" }}>{s.val}</div>
                  <div style={css.statLabel}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={css.grid}>
              {weeks.map(week => {
                const score = scores[`1-${week.id}`];
                const result = matchResult(score);
                const avail = countAvail(week.id);
                const suggestions = suggestPairings(week.id);
                const meta = matchMeta[week.id] || {};
                const home = isHome(week.id);
                const snacksPerson = meta.snacksPlayerId ? playerName(meta.snacksPlayerId) : null;

                const rubberResults = score
                  ? [score.rubber1, score.rubber2, score.rubber3, score.rubber4]
                      .map(rubberResult).filter(r => r !== null)
                  : [];
                const rubberWins = rubberResults.filter(r => r === "W").length;

                return (
                  <div key={week.id}
                    style={{ ...css.card, ...(result ? css.cardScored : {}), ...(home ? css.cardHome : {}) }}
                    onClick={() => setSelectedWeek(selectedWeek === week.id ? null : week.id)}>

                    <div style={css.cardTop}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={css.weekBadge}>W{week.id}</div>
                        {home && <div style={css.homePill}>🏠 Home</div>}
                      </div>
                      <div style={{ ...css.resultBadge, background: result === "W" ? "#166534" : result === "L" ? "#7f1d1d" : result === "D" ? "#78350f" : "#1e293b" }}>
                        {result || "—"}
                      </div>
                    </div>

                    <div style={css.opponent}>{week.opponent}</div>
                    <div style={css.cardMeta}>
                      <span style={{ color: home ? "#7dd3fc" : "#c4b5fd" }}>{home ? "Home" : "Away"}</span>
                      <span>·</span><span>{week.date}</span>
                    </div>

                    {home && (
                      <div style={css.snacksRow}>
                        <span>🍊</span>
                        <span style={{ fontSize: 11, color: snacksPerson ? "#fbbf24" : "#64748b" }}>
                          {snacksPerson ? `${snacksPerson} on snacks` : "Snacks unassigned"}
                        </span>
                      </div>
                    )}

                    {meta.notes && (
                      <div style={css.notesPreview}>📝 {meta.notes}</div>
                    )}

                    <div style={css.cardFooter}>
                      <span style={{ color: avail >= 4 ? "#22c55e" : "#ef4444" }}>{avail} available</span>
                      {rubberResults.length > 0 && (
                        <span style={{ color: "#7dd3fc", fontFamily: "monospace", fontSize: 11 }}>
                          {rubberWins}/{rubberResults.length} rubbers
                        </span>
                      )}
                    </div>

                    {/* ── EXPANDED PANEL ── */}
                    {selectedWeek === week.id && (
                      <div style={css.expandedCard} onClick={e => e.stopPropagation()}>

                        {/* Home / Away toggle */}
                        <div style={css.expandSection}>
                          <div style={css.expandTitle}>Venue</div>
                          <div style={{ display: "flex", gap: 8 }}>
                            {["Home", "Away"].map(v => (
                              <button key={v}
                                style={{ ...css.venueToggle, ...((isHome(week.id) ? "Home" : "Away") === v ? css.venueActive : {}) }}
                                onClick={() => updateMatchMeta(week.id, { isHome: v === "Home" })}>
                                {v === "Home" ? "🏠" : "✈️"} {v}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Snacks — home games only */}
                        {isHome(week.id) && (
                          <div style={css.expandSection}>
                            <div style={css.expandTitle}>🍊 Snacks Duty <span style={{ color: "#64748b", textTransform: "none", fontSize: 10 }}>(one person per home game)</span></div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {players.map(p => {
                                const assigned = meta.snacksPlayerId?.toString() === p.id?.toString();
                                return (
                                  <button key={p.id}
                                    style={{ ...css.snacksBtn, ...(assigned ? css.snacksBtnActive : {}) }}
                                    onClick={() => assignSnacks(week.id, p.id)}>
                                    {assigned ? "✓ " : ""}{p.name.split(" ")[0]}
                                  </button>
                                );
                              })}
                            </div>
                            {snacksPerson && (
                              <div style={{ fontSize: 11, color: "#fbbf24", marginTop: 6 }}>✓ {snacksPerson} is bringing snacks</div>
                            )}
                          </div>
                        )}

                        {/* Suggested pairings */}
                        <div style={css.expandSection}>
                          <div style={css.expandTitle}>Suggested Pairings</div>
                          {suggestions.length === 0
                            ? <div style={{ color: "#64748b", fontSize: 12 }}>Not enough available players match pairings</div>
                            : suggestions.map((s, i) => (
                              <div key={i} style={css.pairingChip}>
                                <span style={css.rubberLabel}>Pair {i + 1}</span>
                                {s.p1.name} & {s.p2.name}
                                {s.pair.notes && <span style={{ color: "#64748b", fontSize: 11 }}> — {s.pair.notes}</span>}
                              </div>
                            ))}
                        </div>

                        {/* Availability */}
                        <div style={css.expandSection}>
                          <div style={css.expandTitle}>Availability This Week</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {getAvailForWeek(week.id).map(({ player, status }) => (
                              <div key={player.id} style={{ fontSize: 11, display: "flex", gap: 4, alignItems: "center", color: "#94a3b8" }}>
                                <span style={{ color: availColor[status], fontWeight: 700 }}>{availLabel[status]}</span>
                                <span>{player.name}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* Match notes */}
                        <div style={css.expandSection}>
                          <div style={css.expandTitle}>📝 Match Notes</div>
                          <textarea
                            style={css.notesTextarea}
                            placeholder="e.g. Venue change — playing at North Court this week, bring extra balls…"
                            value={meta.notes || ""}
                            onChange={e => setMatchMeta(m => ({ ...m, [week.id]: { ...(m[week.id] || {}), notes: e.target.value } }))}
                            onBlur={e => updateMatchMeta(week.id, { notes: e.target.value })}
                            rows={3}
                          />
                        </div>

                        <button style={css.enterScoreBtn} onClick={() => { setEditingScore(week.id); setView("scores"); }}>
                          {score ? "Edit Score" : "Enter Score"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── SCORES ── */}
        {view === "scores" && (
          <div>
            <div style={css.toolbar}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={css.toolLabel}>Filter</label>
                <select style={css.sel} value={scoreFilter} onChange={e => setScoreFilter(e.target.value)}>
                  <option value="all">All Weeks</option>
                  <option value="scored">Scored</option>
                  <option value="unscored">Unscored</option>
                  <option value="W">Wins</option>
                  <option value="L">Losses</option>
                </select>
                <select style={css.sel} value={venueFilter} onChange={e => setVenueFilter(e.target.value)}>
                  <option value="all">All Venues</option>
                  <option value="Home">Home</option>
                  <option value="Away">Away</option>
                </select>
                <label style={css.toolLabel}>Sort</label>
                <select style={css.sel} value={sortScores} onChange={e => setSortScores(e.target.value)}>
                  <option value="week">By Week</option>
                  <option value="result">By Result</option>
                </select>
              </div>
            </div>
            <div style={css.scoreTable}>
              <div style={css.scoreHeader}>
                <span>Week</span>
                <span>Opponent</span>
                <span>Venue</span>
                <span>Pair A — R1 &amp; R2</span>
                <span>Pair B — R3 &amp; R4</span>
                <span>Result</span>
                <span>Notes / Snacks</span>
                <span>Action</span>
              </div>
              {filteredWeeks.map(week => {
                const s = scores[`1-${week.id}`];
                const res = matchResult(s);
                const isEditing = editingScore === week.id;
                const meta = matchMeta[week.id] || {};
                const home = isHome(week.id);
                const snacksPerson = meta.snacksPlayerId ? playerName(meta.snacksPlayerId) : null;
                return (
                  <div key={week.id}>
                    <div style={css.scoreRow}>
                      <span style={{ color: "#7dd3fc", fontWeight: 700 }}>
                        W{week.id}
                        {home && <span style={{ ...css.homePill, marginLeft: 4, fontSize: 9, padding: "0 4px" }}>H</span>}
                        <div style={{ color: "#64748b", fontWeight: 400, fontSize: 11 }}>{week.date}</div>
                      </span>
                      <span>{week.opponent}</span>
                      <span style={{ color: home ? "#7dd3fc" : "#c4b5fd" }}>{home ? "Home" : "Away"}</span>

                      {/* Pair A: Rubber 1 + Rubber 2 */}
                      <span>
                        {s ? (
                          <div>
                            <RubberLine rub={s.rubber1} label="R1" />
                            <RubberLine rub={s.rubber2} label="R2" />
                            {s?.players?.r1?.length > 0 && (
                              <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>
                                {s.players.r1.map(playerName).join(" & ")}
                              </div>
                            )}
                          </div>
                        ) : "—"}
                      </span>

                      {/* Pair B: Rubber 3 + Rubber 4 */}
                      <span>
                        {s ? (
                          <div>
                            <RubberLine rub={s.rubber3} label="R3" />
                            <RubberLine rub={s.rubber4} label="R4" />
                            {s?.players?.r2?.length > 0 && (
                              <div style={{ fontSize: 10, color: "#64748b", marginTop: 3 }}>
                                {s.players.r2.map(playerName).join(" & ")}
                              </div>
                            )}
                          </div>
                        ) : "—"}
                      </span>

                      <span style={{ ...css.resBadge, background: res === "W" ? "#166534" : res === "L" ? "#7f1d1d" : res === "D" ? "#78350f" : "transparent", border: !res ? "1px solid #334155" : "none" }}>
                        {res || "—"}
                      </span>
                      <span style={{ fontSize: 11, lineHeight: 1.6 }}>
                        {meta.notes && <div style={{ color: "#94a3b8" }} title={meta.notes}>📝 {meta.notes.length > 30 ? meta.notes.slice(0, 30) + "…" : meta.notes}</div>}
                        {home && snacksPerson && <div style={{ color: "#fbbf24" }}>🍊 {snacksPerson}</div>}
                        {home && !snacksPerson && <div style={{ color: "#64748b" }}>🍊 unassigned</div>}
                      </span>
                      <button style={css.editBtn} onClick={() => setEditingScore(isEditing ? null : week.id)}>
                        {isEditing ? "Cancel" : s ? "Edit" : "Enter"}
                      </button>
                    </div>
                    {isEditing && (
                      <ScoreEntry week={week} players={players} existing={s}
                        onSave={data => saveScore(week.id, data)} onCancel={() => setEditingScore(null)} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── AVAILABILITY ── */}
        {view === "availability" && (
          <div>
            <div style={css.toolbar}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <label style={css.toolLabel}>Filter weeks</label>
                <select style={css.sel} value={availFilter} onChange={e => setAvailFilter(e.target.value)}>
                  <option value="all">All</option>
                  <option value="available">4+ Available</option>
                  <option value="short">Short (&lt;4)</option>
                  <option value="home">Home Games Only</option>
                </select>
              </div>
              <div style={{ fontSize: 12, color: "#64748b" }}>Click any cell to update · saves instantly</div>
            </div>
            <div style={{ overflowX: "auto" }}>
              <div style={css.availHeaderRow}>
                <div style={css.playerCell}>Player</div>
                {weeks.filter(w => {
                  if (availFilter === "available") return countAvail(w.id) >= 4;
                  if (availFilter === "short") return countAvail(w.id) < 4;
                  if (availFilter === "home") return isHome(w.id);
                  return true;
                }).map(w => (
                  <div key={w.id} style={{ ...css.weekCell, ...(isHome(w.id) ? { background: "#0b1e33" } : {}) }}>
                    <div style={{ fontWeight: 700 }}>W{w.id}</div>
                    <div style={{ fontSize: 10 }}>{isHome(w.id) ? "🏠" : "✈️"}</div>
                    <div style={{ fontSize: 9, color: "#64748b" }}>{w.date}</div>
                    <div style={{ fontSize: 10, color: countAvail(w.id) >= 4 ? "#22c55e" : "#ef4444" }}>{countAvail(w.id)}/{players.length}</div>
                  </div>
                ))}
              </div>
              {players.map(player => (
                <div key={player.id} style={{ ...css.availRow, ...(player.id?.toString() === currentUser?.toString() ? css.myRow : {}) }}>
                  <div style={css.playerCell}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#7dd3fc", display: "inline-block", flexShrink: 0 }} />
                    {player.name}
                    {player.role === "captain" && <span style={css.captBadge}>C</span>}
                  </div>
                  {weeks.filter(w => {
                    if (availFilter === "available") return countAvail(w.id) >= 4;
                    if (availFilter === "short") return countAvail(w.id) < 4;
                    if (availFilter === "home") return isHome(w.id);
                    return true;
                  }).map(w => {
                    const key = `${player.id}-${w.id}`;
                    const status = availability[key] || "";
                    return (
                      <div key={w.id}
                        style={{ ...css.availCell, background: availColor[status] + "33", cursor: "pointer" }}
                        onClick={() => toggleAvail(player.id, w.id)}
                        title="Click to cycle: Available → Maybe → Unavailable → Clear">
                        <span style={{ color: availColor[status], fontWeight: 700, fontSize: 14 }}>{availLabel[status]}</span>
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 16, marginTop: 14, flexWrap: "wrap" }}>
              {[["available","Available"],["maybe","Maybe"],["unavailable","Unavailable"]].map(([k, label]) => (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, background: availColor[k] }} />
                  <span style={{ color: "#94a3b8", fontSize: 12 }}>{label}</span>
                </div>
              ))}
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span>🏠</span><span style={{ color: "#7dd3fc", fontSize: 12 }}>Home game</span>
              </div>
            </div>
          </div>
        )}

        {/* ── PAIRINGS ── */}
        {view === "pairings" && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#7dd3fc", marginBottom: 8 }}>Preferred Doubles Pairings</div>
            <div style={{ marginBottom: 20, color: "#94a3b8", fontSize: 13 }}>Pairings auto-suggest team selections based on availability. Priority 1 = first choice.</div>
            <div style={css.pairingsTable}>
              <div style={css.pairingsHeader}>
                <span>Priority</span><span>Pairing</span><span>Notes</span><span>Remove</span>
              </div>
              {[...pairings].sort((a, b) => a.priority - b.priority).map(pair => (
                <div key={pair.id} style={css.pairingsRow}>
                  <span>
                    <select style={css.priSel} value={pair.priority} onChange={e => updatePairingPriority(pair.id, +e.target.value)}>
                      {[1,2,3,4,5].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </span>
                  <span style={{ fontWeight: 600 }}>{playerName(pair.player1Id)} <span style={{ color: "#7dd3fc" }}>&</span> {playerName(pair.player2Id)}</span>
                  <span><input style={css.notesInput} value={pair.notes || ""} onChange={e => updatePairingNotes(pair.id, e.target.value)} placeholder="Notes…" /></span>
                  <span><button style={css.removeBtn} onClick={() => deletePairing(pair.id)}>✕</button></span>
                </div>
              ))}
            </div>

            <div style={css.addPairingBox}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7dd3fc", marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Add New Pairing</div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <select style={css.sel} value={newPairing.player1Id} onChange={e => setNewPairing(p => ({ ...p, player1Id: e.target.value }))}>
                  <option value="">Player 1</option>
                  {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <span style={{ color: "#7dd3fc", fontWeight: 700 }}>&</span>
                <select style={css.sel} value={newPairing.player2Id} onChange={e => setNewPairing(p => ({ ...p, player2Id: e.target.value }))}>
                  <option value="">Player 2</option>
                  {players.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
                <select style={css.sel} value={newPairing.priority} onChange={e => setNewPairing(p => ({ ...p, priority: +e.target.value }))}>
                  {[1,2,3,4,5].map(n => <option key={n} value={n}>Priority {n}</option>)}
                </select>
                <input style={{ ...css.sel, flex: 2, minWidth: 140 }} placeholder="Notes (optional)" value={newPairing.notes} onChange={e => setNewPairing(p => ({ ...p, notes: e.target.value }))} />
                <button style={css.addBtn} onClick={addPairing}>Add Pairing</button>
              </div>
            </div>

            {/* Snacks summary */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#fbbf24", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>🍊 Snacks Roster — Home Games</div>
              <div style={css.snacksSummary}>
                {weeks.filter(w => isHome(w.id)).map(w => {
                  const meta = matchMeta[w.id] || {};
                  const snacksPerson = meta.snacksPlayerId ? playerName(meta.snacksPlayerId) : null;
                  return (
                    <div key={w.id} style={{ ...css.snacksCard, ...(snacksPerson ? css.snacksCardAssigned : {}) }}>
                      <div style={{ fontWeight: 700, color: "#7dd3fc", fontSize: 12 }}>W{w.id}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>{w.date}</div>
                      <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{w.opponent}</div>
                      <div style={{ fontSize: 12, color: snacksPerson ? "#fbbf24" : "#64748b" }}>
                        {snacksPerson ? `🍊 ${snacksPerson}` : "Unassigned"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Roster */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7dd3fc", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>Squad Roster</div>
              <div style={css.rosterGrid}>
                {players.map(p => (
                  <div key={p.id} style={css.rosterCard}>
                    <div style={css.rosterAvatar}>{p.name.split(" ").map(n => n[0]).join("")}</div>
                    <div style={css.rosterName}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{p.role === "captain" ? "⚡ Captain" : "Player"}</div>
                    <div style={{ color: "#22c55e", fontSize: 11, marginTop: 4 }}>
                      {weeks.filter(w => availability[`${p.id}-${w.id}`] === "available").length} weeks available
                    </div>
                    <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 2 }}>
                      🍊 {weeks.filter(w => isHome(w.id) && matchMeta[w.id]?.snacksPlayerId?.toString() === p.id?.toString()).length} snack duties
                    </div>
                  </div>
                ))}
                {addingPlayer ? (
                  <div style={{ ...css.rosterCard, gap: 8 }}>
                    <input style={css.notesInput} placeholder="Player name" value={newPlayerName}
                      onChange={e => setNewPlayerName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPlayer()} autoFocus />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button style={css.addBtn} onClick={addPlayer}>Add</button>
                      <button style={css.editBtn} onClick={() => { setAddingPlayer(false); setNewPlayerName(""); }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div style={{ ...css.rosterCard, cursor: "pointer", border: "1px dashed #334155", justifyContent: "center", alignItems: "center", color: "#7dd3fc" }}
                    onClick={() => setAddingPlayer(true)}>
                    <div style={{ fontSize: 24 }}>+</div>
                    <div style={{ fontSize: 12 }}>Add Player</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// ─── SCORE ENTRY ───────────────────────────────────────────────
// Format: 4 rubbers total.
//   Pair A plays Rubber 1 (vs Opp Pair 1) + Rubber 2 (vs Opp Pair 2)
//   Pair B plays Rubber 3 (vs Opp Pair 1) + Rubber 4 (vs Opp Pair 2)
// Each rubber is best-of-2 sets (Set 1 + Set 2).
function ScoreEntry({ week, players, existing, onSave, onCancel }) {
  const empty = { us: "", them: "", us2: "", them2: "" };
  const [rubber1, setRubber1] = useState(existing?.rubber1 || empty);
  const [rubber2, setRubber2] = useState(existing?.rubber2 || empty);
  const [rubber3, setRubber3] = useState(existing?.rubber3 || empty);
  const [rubber4, setRubber4] = useState(existing?.rubber4 || empty);
  // Normalize all player IDs to strings to avoid number/string type mismatches
  const [r1players, setR1players] = useState((existing?.players?.r1 || []).map(x => x.toString()));
  const [r2players, setR2players] = useState((existing?.players?.r2 || []).map(x => x.toString()));

  function setNum(setter, field, val) {
    setter(prev => ({ ...prev, [field]: val === "" ? "" : Math.max(0, Math.min(7, parseInt(val) || 0)) }));
  }

  function togglePlayer(isPairA, playerId) {
    const id = playerId.toString();
    const setPair  = isPairA ? setR1players : setR2players;
    const setOther = isPairA ? setR2players : setR1players;

    // Always use functional updates so we read the latest state, not the closure snapshot.
    setPair(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);   // deselect
      if (prev.length < 2) {
        setOther(other => other.filter(x => x !== id));            // move from other pair if needed
        return [...prev, id];                                      // add
      }
      return prev;                                                 // pair full, no-op
    });
  }

  function RubberInputs({ label, data, setter }) {
    return (
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 5, fontWeight: 600 }}>{label}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ color: "#64748b", fontSize: 11 }}>Set 1:</span>
          <input style={css.scoreInput} type="number" min={0} max={7} value={data.us} onChange={e => setter("us", e.target.value)} placeholder="Us" />
          <span style={{ color: "#64748b" }}>–</span>
          <input style={css.scoreInput} type="number" min={0} max={7} value={data.them} onChange={e => setter("them", e.target.value)} placeholder="Them" />
          <span style={{ color: "#64748b", fontSize: 11, marginLeft: 4 }}>Set 2:</span>
          <input style={css.scoreInput} type="number" min={0} max={7} value={data.us2} onChange={e => setter("us2", e.target.value)} placeholder="Us" />
          <span style={{ color: "#64748b" }}>–</span>
          <input style={css.scoreInput} type="number" min={0} max={7} value={data.them2} onChange={e => setter("them2", e.target.value)} placeholder="Them" />
        </div>
      </div>
    );
  }

  return (
    <div style={css.scoreEntryBox}>
      <div style={{ fontWeight: 700, color: "#7dd3fc", marginBottom: 4, fontSize: 14 }}>
        Enter Score — {week.opponent} ({week.date})
      </div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 16 }}>
        Each pair plays 2 rubbers (4 sets). Pair A: R1 &amp; R2 · Pair B: R3 &amp; R4.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>

        {/* ── PAIR A ── */}
        <div style={css.pairBox}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#7dd3fc", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Pair A
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Players (select 2):</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {players.map(p => (
              <button key={p.id}
                style={{ ...css.playerPickBtn, ...(r1players.includes(p.id.toString()) ? css.playerPickActive : {}) }}
                onClick={() => togglePlayer(true, p.id)}>
                {p.name.split(" ")[0]}
              </button>
            ))}
          </div>
          <RubberInputs label="Rubber 1 — vs Opp Pair 1" data={rubber1} setter={(f,v) => setNum(setRubber1,f,v)} />
          <RubberInputs label="Rubber 2 — vs Opp Pair 2" data={rubber2} setter={(f,v) => setNum(setRubber2,f,v)} />
        </div>

        {/* ── PAIR B ── */}
        <div style={css.pairBox}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#c4b5fd", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Pair B
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>Players (select 2):</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
            {players.map(p => (
              <button key={p.id}
                style={{ ...css.playerPickBtn, ...(r2players.includes(p.id.toString()) ? css.playerPickActive : {}) }}
                onClick={() => togglePlayer(false, p.id)}>
                {p.name.split(" ")[0]}
              </button>
            ))}
          </div>
          <RubberInputs label="Rubber 3 — vs Opp Pair 1" data={rubber3} setter={(f,v) => setNum(setRubber3,f,v)} />
          <RubberInputs label="Rubber 4 — vs Opp Pair 2" data={rubber4} setter={(f,v) => setNum(setRubber4,f,v)} />
        </div>

      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button style={css.addBtn} onClick={() => onSave({ rubber1, rubber2, rubber3, rubber4, players: { r1: r1players, r2: r2players } })}>
          Save Score
        </button>
        <button style={css.editBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ─── STYLES ───────────────────────────────────────────────────
const css = {
  app: { minHeight: "100vh", background: "#0a1628", fontFamily: "'Georgia', serif", color: "#e2e8f0" },
  setupBox: { maxWidth: 520, margin: "80px auto", background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 16, padding: 40, textAlign: "center" },
  setupTitle: { fontSize: 22, fontWeight: 700, color: "#7dd3fc", marginBottom: 12 },
  setupText: { color: "#94a3b8", fontSize: 14, marginBottom: 20, lineHeight: 1.6 },
  setupSteps: { textAlign: "left", display: "flex", flexDirection: "column", gap: 10 },
  step: { display: "flex", alignItems: "flex-start", gap: 12, fontSize: 13, color: "#cbd5e1", lineHeight: 1.5 },
  stepNum: { background: "#1e4a6f", color: "#7dd3fc", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 },
  code: { background: "#071525", border: "1px solid #334155", borderRadius: 4, padding: "1px 6px", fontSize: 12, color: "#7dd3fc", fontFamily: "monospace" },
  setupInput: { background: "#071525", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "8px 14px", fontSize: 14, fontFamily: "'Georgia', serif", flex: 1 },
  loadingBox: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh" },
  spinner: { width: 36, height: 36, border: "3px solid #1e3a5f", borderTop: "3px solid #7dd3fc", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  header: { background: "linear-gradient(135deg, #0d2137 0%, #0a1628 100%)", borderBottom: "1px solid #1e3a5f", position: "sticky", top: 0, zIndex: 100 },
  headerInner: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px 8px", flexWrap: "wrap", gap: 10 },
  brand: { display: "flex", alignItems: "center", gap: 14 },
  clubName: { fontSize: 22, fontWeight: 700, letterSpacing: "0.12em", color: "#7dd3fc", textTransform: "uppercase" },
  season: { fontSize: 11, color: "#64748b", letterSpacing: "0.08em", marginTop: 2 },
  userSelect: { background: "#1e3a5f", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "6px 12px", fontSize: 13, cursor: "pointer" },
  savingPill: { background: "#1e3a5f", color: "#7dd3fc", borderRadius: 20, padding: "3px 10px", fontSize: 11 },
  errorPill: { background: "#3b1212", color: "#ef4444", borderRadius: 20, padding: "3px 10px", fontSize: 11 },
  errorMsg: { color: "#ef4444", fontSize: 12, marginTop: 12 },
  nav: { display: "flex", padding: "0 24px" },
  navBtn: { background: "none", border: "none", borderBottom: "3px solid transparent", color: "#64748b", padding: "10px 20px", fontSize: 13, letterSpacing: "0.06em", cursor: "pointer", textTransform: "uppercase", fontFamily: "'Georgia', serif" },
  navActive: { color: "#7dd3fc", borderBottomColor: "#7dd3fc" },
  main: { padding: "28px 24px", maxWidth: 1100, margin: "0 auto" },
  statsStrip: { display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" },
  statBox: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 12, padding: "14px 20px", textAlign: "center", minWidth: 90 },
  statVal: { fontSize: 28, fontWeight: 700, lineHeight: 1 },
  statLabel: { fontSize: 11, color: "#64748b", marginTop: 4, textTransform: "uppercase", letterSpacing: "0.06em" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 14 },
  card: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 14, padding: 16, cursor: "pointer", transition: "border-color 0.2s" },
  cardScored: { borderColor: "#1e4a6f" },
  cardHome: { borderLeft: "3px solid #1e4a8f" },
  cardTop: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 },
  weekBadge: { fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: "0.08em" },
  homePill: { background: "#0d2b50", border: "1px solid #1e4a8f", borderRadius: 4, padding: "1px 6px", fontSize: 10, color: "#7dd3fc", fontWeight: 700 },
  resultBadge: { borderRadius: 6, padding: "2px 9px", fontSize: 12, fontWeight: 700 },
  opponent: { fontSize: 14, fontWeight: 600, color: "#cbd5e1", marginBottom: 6, lineHeight: 1.3 },
  cardMeta: { fontSize: 11, color: "#64748b", display: "flex", gap: 6, marginBottom: 6 },
  snacksRow: { display: "flex", alignItems: "center", gap: 5, marginBottom: 5, fontSize: 12 },
  notesPreview: { fontSize: 11, color: "#94a3b8", fontStyle: "italic", marginBottom: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  cardFooter: { display: "flex", justifyContent: "space-between", fontSize: 11, marginTop: 8 },
  expandedCard: { marginTop: 14, paddingTop: 14, borderTop: "1px solid #1e3a5f" },
  expandSection: { marginBottom: 14 },
  expandTitle: { fontSize: 10, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.08em", marginBottom: 6 },
  venueToggle: { background: "#0d2137", border: "1px solid #334155", borderRadius: 8, color: "#64748b", padding: "5px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'Georgia', serif" },
  venueActive: { background: "#1e3a5f", borderColor: "#7dd3fc", color: "#7dd3fc", fontWeight: 700 },
  snacksBtn: { background: "#121825", border: "1px solid #334155", borderRadius: 8, color: "#94a3b8", padding: "5px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Georgia', serif" },
  snacksBtnActive: { background: "#2d1f00", borderColor: "#fbbf24", color: "#fbbf24", fontWeight: 700 },
  pairingChip: { fontSize: 12, color: "#cbd5e1", padding: "4px 0", display: "flex", alignItems: "center", gap: 6 },
  rubberLabel: { background: "#1e3a5f", borderRadius: 4, padding: "1px 5px", fontSize: 10, color: "#7dd3fc", fontWeight: 700 },
  notesTextarea: { width: "100%", background: "#071525", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "8px 10px", fontSize: 12, fontFamily: "'Georgia', serif", resize: "vertical", boxSizing: "border-box" },
  enterScoreBtn: { width: "100%", marginTop: 4, background: "#1e4a6f", border: "none", borderRadius: 8, color: "#7dd3fc", padding: "8px", cursor: "pointer", fontSize: 12, fontFamily: "'Georgia', serif" },
  toolbar: { display: "flex", gap: 16, alignItems: "center", marginBottom: 20, flexWrap: "wrap", justifyContent: "space-between" },
  toolLabel: { fontSize: 12, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em" },
  sel: { background: "#0d2137", border: "1px solid #334155", borderRadius: 8, color: "#e2e8f0", padding: "8px 12px", fontSize: 13, cursor: "pointer", fontFamily: "'Georgia', serif" },
  scoreTable: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 14, overflow: "hidden" },
  // Pair A (R1+R2) and Pair B (R3+R4) each get a wider column
  scoreHeader: { display: "grid", gridTemplateColumns: "80px 1fr 65px 160px 160px 55px 150px 70px", padding: "12px 16px", background: "#071525", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 },
  scoreRow: { display: "grid", gridTemplateColumns: "80px 1fr 65px 160px 160px 55px 150px 70px", padding: "12px 16px", borderTop: "1px solid #1e3a5f", alignItems: "start", gap: 8, fontSize: 13 },
  resBadge: { borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 700, textAlign: "center", display: "inline-block" },
  editBtn: { background: "#1e3a5f", border: "none", borderRadius: 7, color: "#7dd3fc", padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "'Georgia', serif" },
  scoreEntryBox: { margin: "0 0 2px", background: "#071525", borderTop: "1px solid #1e4a6f", padding: 20, borderBottom: "2px solid #1e4a6f" },
  pairBox: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 10, padding: 14 },
  scoreInput: { width: 44, background: "#0d2137", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "6px 8px", fontSize: 14, textAlign: "center", fontFamily: "'Georgia', serif" },
  playerPickBtn: { background: "#1e3a5f", border: "1px solid #334155", borderRadius: 6, color: "#94a3b8", padding: "4px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Georgia', serif" },
  playerPickActive: { background: "#1e4a6f", borderColor: "#7dd3fc", color: "#7dd3fc", fontWeight: 700 },
  availHeaderRow: { display: "flex", background: "#071525", borderRadius: "10px 10px 0 0", borderBottom: "1px solid #1e3a5f" },
  availRow: { display: "flex", borderBottom: "1px solid #1e3a5f", background: "#0d2137" },
  myRow: { background: "#0d2b42" },
  playerCell: { minWidth: 160, padding: "10px 14px", fontSize: 13, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, borderRight: "1px solid #1e3a5f", position: "sticky", left: 0, background: "inherit", zIndex: 1 },
  captBadge: { background: "#1e4a6f", borderRadius: 4, padding: "1px 5px", fontSize: 10, color: "#7dd3fc", fontWeight: 700 },
  weekCell: { minWidth: 52, padding: "6px 4px", textAlign: "center", fontSize: 11, color: "#94a3b8", borderRight: "1px solid #1e3a5f" },
  availCell: { minWidth: 52, display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #1e3a5f", transition: "background 0.15s", padding: "4px 0" },
  pairingsTable: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 12, overflow: "hidden", marginBottom: 24 },
  pairingsHeader: { display: "grid", gridTemplateColumns: "80px 1fr 1fr 60px", padding: "10px 16px", background: "#071525", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 },
  pairingsRow: { display: "grid", gridTemplateColumns: "80px 1fr 1fr 60px", padding: "12px 16px", borderTop: "1px solid #1e3a5f", alignItems: "center", gap: 8, fontSize: 13 },
  priSel: { background: "#1e3a5f", border: "none", borderRadius: 6, color: "#7dd3fc", padding: "4px 8px", fontSize: 13, cursor: "pointer", fontFamily: "'Georgia', serif", fontWeight: 700 },
  notesInput: { background: "#0d2137", border: "1px solid #334155", borderRadius: 6, color: "#e2e8f0", padding: "5px 10px", fontSize: 12, width: "100%", fontFamily: "'Georgia', serif", boxSizing: "border-box" },
  removeBtn: { background: "#3b1212", border: "none", borderRadius: 6, color: "#ef4444", padding: "4px 10px", cursor: "pointer", fontSize: 13, fontFamily: "'Georgia', serif" },
  addPairingBox: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 12, padding: 20, marginBottom: 32 },
  addBtn: { background: "#1e4a6f", border: "none", borderRadius: 8, color: "#7dd3fc", padding: "8px 18px", cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Georgia', serif" },
  snacksSummary: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 10, marginBottom: 8 },
  snacksCard: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 10, padding: "12px 14px" },
  snacksCardAssigned: { borderColor: "#78450a", background: "#150f00" },
  rosterGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 },
  rosterCard: { background: "#0d2137", border: "1px solid #1e3a5f", borderRadius: 12, padding: 16, textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center" },
  rosterAvatar: { width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg, #1e4a6f, #0d2137)", border: "2px solid #1e4a6f", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#7dd3fc", marginBottom: 8 },
  rosterName: { fontSize: 13, fontWeight: 600, marginBottom: 2 },
};
