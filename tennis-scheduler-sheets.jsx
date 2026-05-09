import { useState, useMemo, useEffect, useCallback } from "react";

// ─── CONFIG — paste your Apps Script deployment URL here ──────
const API_URL = https://script.google.com/macros/s/AKfycbx2ddxHwMBRdhyyA3rsLCObqJV3BJSH6tRYYT_HEbmU4sB7zYzP5v5yaLK38rdif-X8IA/exec;

// ─── WEEKS ────────────────────────────────────────────────────
const WEEKS = Array.from({ length: 14 }, (_, i) => ({
  id: i + 1,
  label: `Week ${i + 1}`,
  date: (() => {
    const d = new Date(2025, 8, 6);
    d.setDate(d.getDate() + i * 7);
    return d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  })(),
  opponent: [
    "Riverside TC","North Shore TC","Eastern Suburbs TC","Bayside TC",
    "Hills District TC","Western Wanderers TC","Harbour View TC","Lakeside TC",
    "Central Park TC","Northside TC","Coastal TC","Valley TC","Metro TC","Parklands TC"
  ][i],
  defaultVenue: i % 2 === 0 ? "Home" : "Away",
}));

// ─── API HELPERS ──────────────────────────────────────────────
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

// ─── HELPERS ──────────────────────────────────────────────────
const availColor = { available: "#22c55e", unavailable: "#ef4444", maybe: "#f59e0b", "": "#334155" };
const availLabel = { available: "✓", unavailable: "✗", maybe: "?", "": "—" };
const cycle = { "": "available", available: "maybe", maybe: "unavailable", unavailable: "" };

function rubberResult(r) {
  if (!r || r.us === "" || r.us === undefined) return null;
  return (r.us > r.them ? 1 : 0) + (r.us2 > r.them2 ? 1 : 0) >= 2 ? "W" : "L";
}
function matchResult(score) {
  if (!score) return null;
  const r1 = rubberResult(score.rubber1), r2 = rubberResult(score.rubber2);
  if (!r1 && !r2) return null;
  const wins = [r1, r2].filter(x => x === "W").length;
  return wins === 2 ? "W" : wins === 0 ? "L" : "D";
}

// ─── APP ──────────────────────────────────────────────────────
export default function TennisApp() {
  const [view, setView] = useState("schedule");
  const [players, setPlayers] = useState([]);
  const [availability, setAvailability] = useState({});
  const [scores, setScores] = useState({});
  const [pairings, setPairings] = useState([]);
  // matchMeta keyed by weekId: { isHome, snacksPlayerId, notes }
  const [matchMeta, setMatchMeta] = useState({});
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
    return WEEKS.find(w => w.id === weekId)?.defaultVenue === "Home";
  }

  // ── LOAD DATA ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    if (!apiConfigured) { setLoading(false); return; }
    setLoading(true); setError(null);
    try {
      const [p, a, s, pr, mm] = await Promise.all([
        api("getPlayers"), api("getAvailability"), api("getScores"),
        api("getPairings"), api("getMatchMeta"),
      ]);
      if (p.ok) setPlayers(p.data);
      if (a.ok) setAvailability(a.data || {});
      if (s.ok) setScores(s.data || {});
      if (pr.ok) setPairings(pr.data.map(x => ({ ...x, player1Id: +x.player1Id, player2Id: +x.player2Id, priority: +x.priority })));
      if (mm.ok) setMatchMeta(mm.data || {});
    } catch (e) { setError("Could not connect to Google Sheets. Check your API URL."); }
    setLoading(false);
  }, [apiConfigured]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // ── MATCH META ───────────────────────────────────────────────
  async function updateMatchMeta(weekId, patch) {
    const current = matchMeta[weekId] || {
      isHome: WEEKS.find(w => w.id === weekId)?.defaultVenue === "Home",
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

  // ── AVAILABILITY ─────────────────────────────────────────────
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

  // ── SCORES ───────────────────────────────────────────────────
  async function saveScore(weekId, data) {
    setSaving(true);
    const res = await api("setScore", { weekId, ...data });
    if (res.ok) { setScores(s => ({ ...s, [`1-${weekId}`]: data })); setEditingScore(null); }
    setSaving(false);
  }

  const filteredWeeks = useMemo(() => {
    let ws = WEEKS;
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
  }, [scoreFilter, venueFilter, sortScores, scores, matchMeta]);

  // ── PAIRINGS ─────────────────────────────────────────────────
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

  // ── PLAYERS ──────────────────────────────────────────────────
  async function addPlayer() {
    if (!newPlayerName.trim()) return;
    setSaving(true);
    const res = await api("addPlayer", { name: newPlayerName.trim(), role: "player" });
    if (res.ok) { setPlayers(ps => [...ps, { id: res.id, name: newPlayerName.trim(), role: "player" }]); setNewPlayerName(""); setAddingPlayer(false); }
    setSaving(false);
  }

  // ── STATS ────────────────────────────────────────────────────
  const stats = useMemo(() => {
    let wins = 0, losses = 0, draws = 0, rubberWins = 0, rubberTotal = 0;
    WEEKS.forEach(w => {
      const s = scores[`1-${w.id}`]; if (!s) return;
      const r = matchResult(s);
      if (r === "W") wins++; if (r === "L") losses++; if (r === "D") draws++;
      [s.rubber1, s.rubber2].forEach(rub => { if (!rub) return; if (rubberResult(rub) === "W") rubberWins++; rubberTotal++; });
    });
    return { wins, losses, draws, rubberWins, rubberTotal, played: wins + losses + draws };
  }, [scores]);

  const playerName = (id) => players.find(p => p.id?.toString() === id?.toString())?.name || "?";

  // ── SETUP / LOADING SCREENS ───────────────────────────────────
  if (!apiConfigured) return (
    <div style={css.app}>
      <div style={css.setupBox}>
        <div style={{ fontSize: 36, marginBottom: 16 }}>🎾</div>
        <div style={css.setupTitle}>Court One — Setup Required</div>
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

  // ── MAIN APP ─────────────────────────────────────────────────
  return (
    <div style={css.app}>
      <header style={css.header}>
        <div style={css.headerInner}>
          <div style={css.brand}>
            <div style={{ fontSize: 28 }}>🎾</div>
            <div>
              <div style={css.clubName}>COURT ONE</div>
              <div style={css.season}>Season 2025 · Doubles League</div>
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
                { label: "Rubbers Won", val: `${stats.rubberWins}/${stats.rubberTotal}` },
              ].map(s => (
                <div key={s.label} style={css.statBox}>
                  <div style={{ ...css.statVal, color: s.color || "#7dd3fc" }}>{s.val}</div>
                  <div style={css.statLabel}>{s.label}</div>
                </div>
              ))}
            </div>

            <div style={css.grid}>
              {WEEKS.map(week => {
                const score = scores[`1-${week.id}`];
                const result = matchResult(score);
                const avail = countAvail(week.id);
                const suggestions = suggestPairings(week.id);
                const meta = matchMeta[week.id] || {};
                const home = isHome(week.id);
                const snacksPerson = meta.snacksPlayerId ? playerName(meta.snacksPlayerId) : null;

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

                    {/* Snacks — home games only */}
                    {home && (
                      <div style={css.snacksRow}>
                        <span>🍊</span>
                        <span style={{ fontSize: 11, color: snacksPerson ? "#fbbf24" : "#64748b" }}>
                          {snacksPerson ? `${snacksPerson} on snacks` : "Snacks unassigned"}
                        </span>
                      </div>
                    )}

                    {/* Notes preview */}
                    {meta.notes && (
                      <div style={css.notesPreview}>📝 {meta.notes}</div>
                    )}

                    <div style={css.cardFooter}>
                      <span style={{ color: avail >= 4 ? "#22c55e" : "#ef4444" }}>{avail} available</span>
                      {score && <span style={{ color: "#7dd3fc", fontFamily: "monospace", fontSize: 11 }}>{score.rubber1?.us}-{score.rubber1?.them} · {score.rubber2?.us}-{score.rubber2?.them}</span>}
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

                        {/* Snacks — only for home games */}
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
                                <span style={css.rubberLabel}>R{i+1}</span>
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
                <span>Week</span><span>Opponent</span><span>Venue</span><span>Rubber 1</span><span>Rubber 2</span><span>Result</span><span>Notes / Snacks</span><span>Action</span>
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
                      <span>
                        {s?.rubber1 ? `${s.rubber1.us}-${s.rubber1.them}, ${s.rubber1.us2}-${s.rubber1.them2}` : "—"}
                        {s?.players?.r1?.length > 0 && <div style={{ fontSize: 10, color: "#64748b" }}>{s.players.r1.map(playerName).join(" & ")}</div>}
                      </span>
                      <span>
                        {s?.rubber2 ? `${s.rubber2.us}-${s.rubber2.them}, ${s.rubber2.us2}-${s.rubber2.them2}` : "—"}
                        {s?.players?.r2?.length > 0 && <div style={{ fontSize: 10, color: "#64748b" }}>{s.players.r2.map(playerName).join(" & ")}</div>}
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
                {WEEKS.filter(w => {
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
                  {WEEKS.filter(w => {
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
                {WEEKS.filter(w => isHome(w.id)).map(w => {
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

            {/* Roster with snacks count */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#7dd3fc", marginBottom: 14, textTransform: "uppercase", letterSpacing: "0.06em" }}>Squad Roster</div>
              <div style={css.rosterGrid}>
                {players.map(p => (
                  <div key={p.id} style={css.rosterCard}>
                    <div style={css.rosterAvatar}>{p.name.split(" ").map(n => n[0]).join("")}</div>
                    <div style={css.rosterName}>{p.name}</div>
                    <div style={{ fontSize: 11, color: "#64748b" }}>{p.role === "captain" ? "⚡ Captain" : "Player"}</div>
                    <div style={{ color: "#22c55e", fontSize: 11, marginTop: 4 }}>
                      {WEEKS.filter(w => availability[`${p.id}-${w.id}`] === "available").length} weeks available
                    </div>
                    <div style={{ color: "#fbbf24", fontSize: 11, marginTop: 2 }}>
                      🍊 {WEEKS.filter(w => isHome(w.id) && matchMeta[w.id]?.snacksPlayerId?.toString() === p.id?.toString()).length} snack duties
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

// ─── SCORE ENTRY ──────────────────────────────────────────────
function ScoreEntry({ week, players, existing, onSave, onCancel }) {
  const empty = { us: "", them: "", us2: "", them2: "" };
  const [rubber1, setRubber1] = useState(existing?.rubber1 || empty);
  const [rubber2, setRubber2] = useState(existing?.rubber2 || empty);
  const [r1players, setR1players] = useState(existing?.players?.r1 || []);
  const [r2players, setR2players] = useState(existing?.players?.r2 || []);

  function setNum(setter, field, val) {
    setter(prev => ({ ...prev, [field]: val === "" ? "" : Math.max(0, Math.min(7, parseInt(val) || 0)) }));
  }
  function togglePlayer(rubber, playerId) {
    const id = playerId.toString();
    const setter = rubber === 1 ? setR1players : setR2players;
    setter(prev => {
      const sp = prev.map(x => x.toString());
      return sp.includes(id) ? prev.filter(x => x.toString() !== id) : sp.length < 2 ? [...prev, playerId] : prev;
    });
  }

  return (
    <div style={css.scoreEntryBox}>
      <div style={{ fontWeight: 700, color: "#7dd3fc", marginBottom: 16, fontSize: 14 }}>Enter Score — {week.opponent} ({week.date})</div>
      {[
        { label: "Rubber 1", data: rubber1, setter: (f,v) => setNum(setRubber1,f,v), rPlayers: r1players, rNum: 1 },
        { label: "Rubber 2", data: rubber2, setter: (f,v) => setNum(setRubber2,f,v), rPlayers: r2players, rNum: 2 },
      ].map(({ label, data, setter, rPlayers, rNum }) => (
        <div key={label} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: "#7dd3fc", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 8 }}>{label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
            <span style={{ color: "#64748b", fontSize: 12 }}>Set 1:</span>
            <input style={css.scoreInput} type="number" min={0} max={7} value={data.us} onChange={e => setter("us", e.target.value)} placeholder="Us" />
            <span style={{ color: "#64748b" }}>—</span>
            <input style={css.scoreInput} type="number" min={0} max={7} value={data.them} onChange={e => setter("them", e.target.value)} placeholder="Them" />
            <span style={{ color: "#64748b", fontSize: 12 }}>Set 2:</span>
            <input style={css.scoreInput} type="number" min={0} max={7} value={data.us2} onChange={e => setter("us2", e.target.value)} placeholder="Us" />
            <span style={{ color: "#64748b" }}>—</span>
            <input style={css.scoreInput} type="number" min={0} max={7} value={data.them2} onChange={e => setter("them2", e.target.value)} placeholder="Them" />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <span style={{ color: "#64748b", fontSize: 12 }}>Players:</span>
            {players.map(p => (
              <button key={p.id}
                style={{ ...css.playerPickBtn, ...(rPlayers.map(x=>x.toString()).includes(p.id.toString()) ? css.playerPickActive : {}) }}
                onClick={() => togglePlayer(rNum, p.id)}>
                {p.name.split(" ")[0]}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
        <button style={css.addBtn} onClick={() => onSave({ rubber1, rubber2, players: { r1: r1players, r2: r2players } })}>Save Score</button>
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
  scoreHeader: { display: "grid", gridTemplateColumns: "80px 1fr 65px 130px 130px 55px 150px 70px", padding: "12px 16px", background: "#071525", fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.06em", gap: 8 },
  scoreRow: { display: "grid", gridTemplateColumns: "80px 1fr 65px 130px 130px 55px 150px 70px", padding: "12px 16px", borderTop: "1px solid #1e3a5f", alignItems: "start", gap: 8, fontSize: 13 },
  resBadge: { borderRadius: 6, padding: "3px 8px", fontSize: 12, fontWeight: 700, textAlign: "center", display: "inline-block" },
  editBtn: { background: "#1e3a5f", border: "none", borderRadius: 7, color: "#7dd3fc", padding: "5px 12px", cursor: "pointer", fontSize: 12, fontFamily: "'Georgia', serif" },
  scoreEntryBox: { margin: "0 0 2px", background: "#071525", borderTop: "1px solid #1e4a6f", padding: 20, borderBottom: "2px solid #1e4a6f" },
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
