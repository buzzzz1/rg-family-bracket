import { DRAWS } from './draws.js';
import { firebaseConfig, COMMISSIONER_PASSWORD } from './firebase-config.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const ROUND_SIZES = [64, 32, 16, 8, 4, 2, 1];
const ROUND_NAMES = ['Round of 128', 'Round of 64', 'Round of 32', 'Round of 16',
  'Quarterfinals', 'Semifinals', 'Final'];
const ROUND_SHORT = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'Final'];
// Points per correct pick, by round. Each round can yield 640 points total
// (count halves, points double), so early-round accuracy and a correct
// champion are weighted equally.
const ROUND_POINTS = [10, 20, 40, 80, 160, 320, 640];
const EVENTS = [['men', "Men's Singles"], ['women', "Women's Singles"]];
const TOTAL_PICKS = ROUND_SIZES.reduce((a, b) => a + b, 0); // 127 per draw

// The family members. Each picks their name from the dropdown; their bracket
// is stored under that name and follows them across devices.
const PLAYERS = ['Chloe', 'Claire', 'Adrian', 'Chris', 'Mom', 'Michael', 'Andrew'];

const NEEDS_SETUP = !firebaseConfig || !firebaseConfig.apiKey ||
  /PASTE_|YOUR_/.test(firebaseConfig.apiKey);

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  view: 'bracket',          // bracket | leaderboard | commissioner
  event: 'men',
  round: 0,
  userId: localStorage.getItem('rg26_uid') || null,
  userName: localStorage.getItem('rg26_name') || null,
  myPicks: null,            // { men: picks, women: picks }
  myPicksLoaded: false,
  userPin: null,
  pendingName: null,        // name chosen on welcome screen, awaiting PIN
  pinError: null,
  entries: {},              // id -> { id, name, men, women }
  results: { men: emptyPicks(), women: emptyPicks() },
  recapSnapshot: null,        // last sent recap's results snapshot
  config: { locked: false },
  commish: false,
  viewingEntryId: null,
  ready: false,
};

// ---------------------------------------------------------------------------
// Pick helpers
// ---------------------------------------------------------------------------
function emptyPicks() {
  const p = {};
  ROUND_SIZES.forEach((n, r) => { p['r' + r] = Array(n).fill(null); });
  return p;
}

function normalizePicks(obj) {
  const p = emptyPicks();
  if (obj) {
    for (let r = 0; r < 7; r++) {
      const a = obj['r' + r];
      if (Array.isArray(a)) {
        for (let i = 0; i < ROUND_SIZES[r]; i++) {
          if (typeof a[i] === 'number') p['r' + r][i] = a[i];
        }
      }
    }
  }
  return p;
}

// The two contender slot indices for a given round/match, derived from the
// winners chosen in the previous round (or the raw draw for round 0).
function contenders(picks, r, m) {
  if (r === 0) return [2 * m, 2 * m + 1];
  const prev = picks['r' + (r - 1)];
  return [prev[2 * m], prev[2 * m + 1]];
}

// Clear any later-round pick that references a player no longer advancing.
function validate(picks) {
  for (let r = 1; r < 7; r++) {
    const arr = picks['r' + r];
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      if (arr[m] !== null) {
        const c = contenders(picks, r, m);
        if (!c.includes(arr[m])) arr[m] = null;
      }
    }
  }
}

function countDone(picks) {
  let done = 0;
  for (let r = 0; r < 7; r++) picks['r' + r].forEach(v => { if (v !== null) done++; });
  return done;
}

function score(picks, results) {
  const per = [0, 0, 0, 0, 0, 0, 0];
  let total = 0, correct = 0;
  for (let r = 0; r < 7; r++) {
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const res = results['r' + r][m];
      if (res !== null && res !== undefined && picks['r' + r][m] === res) {
        per[r] += ROUND_POINTS[r];
        total += ROUND_POINTS[r];
        correct++;
      }
    }
  }
  return { per, total, correct };
}

function hasResults() {
  return EVENTS.some(([ev]) =>
    ROUND_SIZES.some((n, r) => state.results[ev]['r' + r].some(v => v !== null && v !== undefined)));
}

// ---------------------------------------------------------------------------
// Analytics + daily-recap helpers
// ---------------------------------------------------------------------------
function matchOfSlot(s, r) { return Math.floor(s / Math.pow(2, r + 1)); }

// A slot is still alive if no recorded result on its path contradicts it.
function isAlive(slot, results) {
  if (slot === null || slot === undefined) return false;
  for (let r = 0; r < 7; r++) {
    const res = results['r' + r][matchOfSlot(slot, r)];
    if (res !== null && res !== undefined && res !== slot) return false;
  }
  return true;
}

function entryMaxPossible(picks, results) {
  let total = 0;
  for (let r = 0; r < 7; r++) {
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const pick = picks['r' + r][m];
      if (pick === null) continue;
      const res = results['r' + r][m];
      if (res !== null && res !== undefined) {
        if (pick === res) total += ROUND_POINTS[r];
      } else if (isAlive(pick, results)) {
        total += ROUND_POINTS[r];
      }
    }
  }
  return total;
}

function roundAccuracy(picks, results) {
  const out = [];
  for (let r = 0; r < 7; r++) {
    let correct = 0, played = 0;
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const res = results['r' + r][m];
      if (res !== null && res !== undefined) {
        played++;
        if (picks['r' + r][m] === res) correct++;
      }
    }
    out.push({ correct, played });
  }
  return out;
}

// All upsets in the current results for one event.
function getUpsets(event) {
  const draw = DRAWS[event], results = state.results[event];
  const out = [];
  for (let r = 0; r < 7; r++) {
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const w = results['r' + r][m];
      if (w === null || w === undefined) continue;
      let a, b;
      if (r === 0) { a = 2 * m; b = 2 * m + 1; }
      else { a = results['r' + (r - 1)][2 * m]; b = results['r' + (r - 1)][2 * m + 1]; }
      if (a === null || b === null) continue;
      const loser = w === a ? b : a;
      const ws = draw[w].seed || 99, ls = draw[loser].seed || 99;
      const gap = ls === 99 ? 0 : (ws === 99 ? (33 - ls) : (ws - ls));
      if (gap > 0) out.push({ event, r, m, winner: w, loser, gap });
    }
  }
  return out.sort((a, b) => b.gap - a.gap);
}

// Matches whose result changed (or was newly set) vs the snapshot.
function diffTodayMatches(current, snapshot, event) {
  const out = [];
  for (let r = 0; r < 7; r++) {
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const cur = current['r' + r][m];
      const snap = snapshot ? snapshot['r' + r][m] : null;
      if (cur !== snap && cur !== null && cur !== undefined) {
        let a, b;
        if (r === 0) { a = 2 * m; b = 2 * m + 1; }
        else { a = current['r' + (r - 1)][2 * m]; b = current['r' + (r - 1)][2 * m + 1]; }
        const loser = cur === a ? b : a;
        out.push({ event, r, m, winner: cur, loser });
      }
    }
  }
  return out;
}

// All played matches (for "overall" family stats).
function playedMatchesIn(results, event) {
  const out = [];
  for (let r = 0; r < 7; r++) {
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const w = results['r' + r][m];
      if (w !== null && w !== undefined) out.push({ event, r, m, winner: w });
    }
  }
  return out;
}

function allPlayedMatches() {
  return [
    ...playedMatchesIn(state.results.men, 'men'),
    ...playedMatchesIn(state.results.women, 'women'),
  ];
}

// Aggregate family-wide stats across a set of {event,r,m,winner} matches.
// Returns total picks, correct picks, per-round breakdown, unanimous lists,
// and the hardest/easiest match for the family.
function familyStats(entries, matches) {
  let total = 0, correct = 0;
  const byRound = ROUND_SIZES.map(() => ({ correct: 0, played: 0 }));
  const unanimousCorrect = [], unanimousWrong = [];
  let hardest = null, easiest = null;
  for (const t of matches) {
    // The two actual contenders of this match. A pick for anyone else is a
    // "dead" bracket pick (that player was eliminated earlier), not a real
    // prediction for this match — so it shouldn't count toward today's stats.
    let cA, cB;
    if (t.r === 0) { cA = 2 * t.m; cB = 2 * t.m + 1; }
    else {
      cA = state.results[t.event]['r' + (t.r - 1)][2 * t.m];
      cB = state.results[t.event]['r' + (t.r - 1)][2 * t.m + 1];
    }
    let pickCount = 0, correctCount = 0;
    let firstPick = null, allSame = true;
    for (const e of entries) {
      const p = e[t.event]['r' + t.r][t.m];
      if (p === null || p === undefined) continue;
      if (p !== cA && p !== cB) continue; // dead pick — player isn't in this match
      pickCount++; total++;
      byRound[t.r].played++;
      if (firstPick === null) firstPick = p;
      else if (p !== firstPick) allSame = false;
      if (p === t.winner) { correct++; correctCount++; byRound[t.r].correct++; }
    }
    if (pickCount > 0 && allSame) {
      if (firstPick === t.winner) unanimousCorrect.push({ ...t, familyPick: firstPick });
      else unanimousWrong.push({ ...t, familyPick: firstPick });
    }
    if (pickCount > 0) {
      const rec = { ...t, correctCount, pickCount };
      if (!hardest || correctCount < hardest.correctCount) hardest = rec;
      if (!easiest || correctCount > easiest.correctCount) easiest = rec;
    }
  }
  return { total, correct, byRound, unanimousCorrect, unanimousWrong, hardest, easiest };
}

// Decorated player label for the recap (includes seed in parens if seeded).
function recapName(draw, slot) {
  const p = draw[slot];
  return p.seed ? `${p.name} (${p.seed})` : p.name;
}

function generateRecapText() {
  const snap = state.recapSnapshot || { men: emptyPicks(), women: emptyPicks() };
  const todayMen = diffTodayMatches(state.results.men, snap.men, 'men');
  const todayWomen = diffTodayMatches(state.results.women, snap.women, 'women');
  const todayAll = [...todayMen, ...todayWomen];

  const entries = Object.values(state.entries).filter(e => e.name).map(e => {
    const mp = normalizePicks(e.men), wp = normalizePicks(e.women);
    return {
      id: e.id, name: e.name, men: mp, women: wp,
      total: score(mp, state.results.men).total + score(wp, state.results.women).total,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  const todayPoints = {}, todayCorrect = {};
  entries.forEach(e => { todayPoints[e.id] = 0; todayCorrect[e.id] = 0; });
  for (const t of todayAll) {
    for (const e of entries) {
      if (e[t.event]['r' + t.r][t.m] === t.winner) {
        todayPoints[e.id] += ROUND_POINTS[t.r];
        todayCorrect[e.id]++;
      }
    }
  }

  const lines = [];
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  lines.push(`🎾 Kiwi House Bracket — ${dateStr} recap`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('🏆 Standings');
  entries.slice(0, 6).forEach((e, i) => lines.push(`   ${i + 1}. ${e.name} — ${e.total}`));
  lines.push('');

  if (todayAll.length === 0) {
    lines.push('(No new results since the last recap.)');
  } else {
    const ranked = entries.slice().sort((a, b) => todayPoints[b.id] - todayPoints[a.id]);
    const mover = ranked[0];
    if (mover && todayPoints[mover.id] > 0) {
      lines.push(`📈 Mover today: ${mover.name} (+${todayPoints[mover.id]}, ${todayCorrect[mover.id]}/${todayAll.length})`);
    }
    const maxCorrect = Math.max(...Object.values(todayCorrect));
    if (maxCorrect > 0) {
      const tops = entries.filter(e => todayCorrect[e.id] === maxCorrect).map(e => e.name);
      const sameAsMover = mover && tops.length === 1 && tops[0] === mover.name && todayPoints[mover.id] > 0;
      if (!sameAsMover) {
        lines.push(`🎯 Best record today: ${tops.join(', ')} (${maxCorrect}/${todayAll.length})`);
      }
    }
    const todayUpsets = todayAll.map(t => {
      const draw = DRAWS[t.event];
      const ws = draw[t.winner].seed || 99, ls = draw[t.loser].seed || 99;
      const gap = ls === 99 ? 0 : (ws === 99 ? (33 - ls) : (ws - ls));
      return { ...t, gap };
    }).filter(t => t.gap > 0).sort((a, b) => b.gap - a.gap);
    if (todayUpsets.length) {
      const top = todayUpsets[0], draw = DRAWS[top.event];
      const whoHad = entries.filter(e => e[top.event]['r' + top.r][top.m] === top.winner).map(e => e.name);
      const sawIt = whoHad.length === 0 ? 'nobody saw it coming'
        : whoHad.length === 1 ? `only ${whoHad[0]} had it`
        : `${whoHad.length} of you had it`;
      lines.push(`😱 Upset of the day: ${recapName(draw, top.winner)} d. ${recapName(draw, top.loser)} — ${sawIt}`);
    }
    let bold = null;
    for (const t of todayAll) {
      const wPickers = entries.filter(e => e[t.event]['r' + t.r][t.m] === t.winner);
      const lPickers = entries.filter(e => e[t.event]['r' + t.r][t.m] === t.loser);
      if (wPickers.length >= 1 && wPickers.length <= 2 && lPickers.length >= 3) {
        if (!bold || wPickers.length < bold.w) {
          bold = { t, w: wPickers.length, who: wPickers.map(e => e.name) };
        }
      }
    }
    if (bold) {
      const draw = DRAWS[bold.t.event];
      lines.push(`⭐ Bold call: ${bold.who.join(' & ')} — ${draw[bold.t.winner].name} over ${draw[bold.t.loser].name}`);
    }
    const champLosses = [];
    for (const e of entries) {
      const mch = e.men.r6[0], wch = e.women.r6[0];
      if (mch !== null && isAlive(mch, snap.men) && !isAlive(mch, state.results.men)) {
        champLosses.push(`${e.name} lost ${DRAWS.men[mch].name} (men's)`);
      }
      if (wch !== null && isAlive(wch, snap.women) && !isAlive(wch, state.results.women)) {
        champLosses.push(`${e.name} lost ${DRAWS.women[wch].name} (women's)`);
      }
    }
    if (champLosses.length) {
      lines.push(`💀 Champion pick down: ${champLosses.join('; ')}`);
    }

    // Family-wide scorecard for today's matches.
    const todayFam = familyStats(entries, todayAll);
    if (todayFam.total > 0) {
      const pct = Math.round(todayFam.correct / todayFam.total * 100);
      const parts = [`${pct}% (${todayFam.correct}/${todayFam.total})`];
      if (todayFam.unanimousCorrect.length) parts.push(`${todayFam.unanimousCorrect.length} unanimous right`);
      if (todayFam.unanimousWrong.length) parts.push(`${todayFam.unanimousWrong.length} unanimous wrong`);
      lines.push(`📊 Family today: ${parts.join(' · ')}`);
      if (todayFam.unanimousWrong.length) {
        const u = todayFam.unanimousWrong[0];
        lines.push(`   (oops — we all picked ${DRAWS[u.event][u.familyPick].name})`);
      }
    }
  }

  lines.push('');
  lines.push('🏆 Champions still alive');
  for (const ev of ['men', 'women']) {
    const draw = DRAWS[ev], tally = {};
    for (const e of entries) {
      const c = e[ev].r6[0];
      if (c === null || !isAlive(c, state.results[ev])) continue;
      const n = draw[c].name;
      tally[n] = (tally[n] || 0) + 1;
    }
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    const labelText = ev === 'men' ? 'Men' : 'Women';
    if (sorted.length === 0) {
      lines.push(`   ${labelText}: nobody's champion still in 😱`);
    } else {
      lines.push(`   ${labelText}: ${sorted.map(([n, c]) => `${n} (${c})`).join(', ')}`);
    }
  }
  return lines.join('\n');
}

// Comprehensive tournament-level recap — richer than the daily one. Builds a
// shareable summary across all results so far (standings, specialists, style
// profiles, champion status, upsets everyone missed, next-round toss-ups).
function generateTournamentRecapText() {
  const entries = Object.values(state.entries).filter(e => e.name).map(e => ({
    id: e.id, name: e.name,
    men: normalizePicks(e.men), women: normalizePicks(e.women),
  }));
  if (entries.length === 0) return 'No brackets yet.';
  const N = entries.length;

  const stats = entries.map(e => {
    const ra_m = roundAccuracy(e.men, state.results.men);
    const ra_w = roundAccuracy(e.women, state.results.women);
    return {
      name: e.name, e, ra_m, ra_w,
      menCorrect: ra_m.reduce((a, r) => a + r.correct, 0),
      menPlayed: ra_m.reduce((a, r) => a + r.played, 0),
      womenCorrect: ra_w.reduce((a, r) => a + r.correct, 0),
      womenPlayed: ra_w.reduce((a, r) => a + r.played, 0),
      score: score(e.men, state.results.men).total + score(e.women, state.results.women).total,
      max: entryMaxPossible(e.men, state.results.men) + entryMaxPossible(e.women, state.results.women),
      upsets: 0, contrarian: 0, lonely: 0,
    };
  }).sort((a, b) => b.score - a.score);

  for (const s of stats) {
    for (const ev of ['men', 'women']) {
      const draw = DRAWS[ev];
      for (let r = 0; r < 7; r++) {
        for (let m = 0; m < ROUND_SIZES[r]; m++) {
          const w = state.results[ev]['r' + r][m];
          if (w === null || w === undefined) continue;
          if (s.e[ev]['r' + r][m] !== w) continue;
          let a, b;
          if (r === 0) { a = 2 * m; b = 2 * m + 1; }
          else { a = state.results[ev]['r' + (r - 1)][2 * m]; b = state.results[ev]['r' + (r - 1)][2 * m + 1]; }
          if (a == null || b == null) continue;
          const loser = w === a ? b : a;
          const ws = draw[w].seed || 99, ls = draw[loser].seed || 99;
          if (ls !== 99 && ws > ls) s.upsets++;
          const winnerPickers = entries.filter(en => en[ev]['r' + r][m] === w).length;
          if (winnerPickers < N / 2) s.contrarian++;
          if (winnerPickers === 1) s.lonely++;
        }
      }
    }
  }

  const playedAll = allPlayedMatches();
  const fam = familyStats(entries, playedAll);
  const famPct = fam.total > 0 ? (fam.correct / fam.total * 100).toFixed(1) : '0.0';
  const menExpert = stats.slice().sort((a, b) => b.menCorrect - a.menCorrect)[0];
  const womenExpert = stats.slice().sort((a, b) => b.womenCorrect - a.womenCorrect)[0];
  const eliminated = stats.filter(s => s.max < stats[0].score);

  // Champion tally per event
  const champTally = { men: {}, women: {} };
  for (const ev of ['men', 'women']) {
    for (const e of entries) {
      const c = e[ev].r6[0];
      if (c === null || c === undefined) continue;
      const alive = isAlive(c, state.results[ev]);
      const name = DRAWS[ev][c].name;
      if (!champTally[ev][name]) champTally[ev][name] = { alive, count: 0 };
      champTally[ev][name].count++;
    }
  }

  // All-missed matches and unanimous count
  let unanimousCount = 0;
  const allMissed = [];
  for (const t of playedAll) {
    const correctCount = entries.filter(e => e[t.event]['r' + t.r][t.m] === t.winner).length;
    if (correctCount === entries.length) unanimousCount++;
    if (correctCount === 0) allMissed.push(t);
  }

  // Next active round per event + division
  function nextActiveRound(results) {
    for (let r = 0; r < 7; r++) {
      for (let m = 0; m < ROUND_SIZES[r]; m++) {
        if (results['r' + r][m] !== null && results['r' + r][m] !== undefined) continue;
        let a, b;
        if (r === 0) { a = 2 * m; b = 2 * m + 1; }
        else { a = results['r' + (r - 1)][2 * m]; b = results['r' + (r - 1)][2 * m + 1]; }
        if (a != null && b != null) return r;
      }
    }
    return -1;
  }
  function divisionAt(ev, r) {
    if (r < 0) return { divided: [], unanimous: 0 };
    const list = [];
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      let a, b;
      if (r === 0) { a = 2 * m; b = 2 * m + 1; }
      else { a = state.results[ev]['r' + (r - 1)][2 * m]; b = state.results[ev]['r' + (r - 1)][2 * m + 1]; }
      if (a == null || b == null) continue;
      const aP = entries.filter(e => e[ev]['r' + r][m] === a).map(e => e.name);
      const bP = entries.filter(e => e[ev]['r' + r][m] === b).map(e => e.name);
      const inPlay = aP.length + bP.length;
      list.push({ ev, r, m, a, b, aP, bP, inPlay, out: N - inPlay, split: Math.abs(aP.length - bP.length) });
    }
    const divided = list.filter(c => c.inPlay >= Math.max(2, N - 2) && c.split <= 1)
      .sort((a, b) => a.split - b.split || b.inPlay - a.inPlay);
    const unanimous = list.filter(c => c.inPlay >= N - 1 && (c.aP.length === c.inPlay || c.bP.length === c.inPlay)).length;
    return { divided, unanimous };
  }
  const nextMen = nextActiveRound(state.results.men);
  const nextWomen = nextActiveRound(state.results.women);
  const divMen = divisionAt('men', nextMen);
  const divWomen = divisionAt('women', nextWomen);
  const allDivided = [...divMen.divided, ...divWomen.divided]
    .sort((a, b) => a.split - b.split || b.inPlay - a.inPlay).slice(0, 8);
  const totalUnanimousNext = divMen.unanimous + divWomen.unanimous;
  const nextLabel = nextMen >= 0 ? ROUND_SHORT[nextMen] : (nextWomen >= 0 ? ROUND_SHORT[nextWomen] : '');

  const lines = [];
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  lines.push(`🎾 Kiwi House Bracket — ${dateStr} tournament recap`);
  lines.push('━━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');

  const spread = stats[0].score - stats[stats.length - 1].score;
  lines.push(`📊 STANDINGS  (${spread} pts cover the field)`);
  stats.forEach((s, i) => {
    lines.push(`   ${i + 1}. ${s.name.padEnd(8)} ${String(s.score).padStart(4)}  · M ${s.menCorrect}/${s.menPlayed} · W ${s.womenCorrect}/${s.womenPlayed}`);
  });
  lines.push('');
  lines.push(`Family hit rate: ${fam.correct}/${fam.total} = ${famPct}%`);
  lines.push(`Mathematically eliminated: ${eliminated.length ? eliminated.map(s => s.name).join(', ') : 'nobody'}`);
  lines.push('');

  lines.push('🥇 SPECIALISTS');
  lines.push(`   Men's expert:    ${menExpert.name}   (${menExpert.menCorrect}/${menExpert.menPlayed})`);
  lines.push(`   Women's expert:  ${womenExpert.name}   (${womenExpert.womenCorrect}/${womenExpert.womenPlayed})`);
  lines.push('');

  const topContrarian = Math.max(...stats.map(s => s.contrarian));
  const topUpsets = Math.max(...stats.map(s => s.upsets));
  const tcNames = stats.filter(s => s.contrarian === topContrarian && topContrarian > 0).map(s => s.name);
  const tuNames = stats.filter(s => s.upsets === topUpsets && topUpsets > 0).map(s => s.name);
  const safest = stats.slice().sort((a, b) => (a.contrarian + a.upsets) - (b.contrarian + b.upsets))[0];
  lines.push('🎯 STYLE PROFILES');
  if (tcNames.length) lines.push(`   Most contrarian: ${tcNames.join(', ')} (${topContrarian} contrarian wins)`);
  if (tuNames.length) lines.push(`   Upset hunters:   ${tuNames.join(', ')} (${topUpsets} seed losses called)`);
  lines.push(`   Safest player:   ${safest.name} (${safest.contrarian} contrarian wins, ${safest.upsets} upsets called)`);
  lines.push('');

  lines.push('🏆 CHAMPION PICKS');
  for (const ev of ['men', 'women']) {
    const items = Object.entries(champTally[ev]).map(([name, v]) => ({ name, ...v }));
    const alive = items.filter(t => t.alive).sort((a, b) => b.count - a.count);
    const dead = items.filter(t => !t.alive).sort((a, b) => b.count - a.count);
    const evLabel = ev === 'men' ? 'Men' : 'Women';
    lines.push(`   ${evLabel}: ${alive.length ? alive.map(t => `${t.name} (${t.count})`).join(' · ') : "nobody's pick alive 😱"}`);
    if (dead.length) lines.push(`     Out: ${dead.map(t => `${t.name} (was ${t.count})`).join(', ')}`);
  }
  lines.push('');

  if (allMissed.length) {
    lines.push(`😱 WE ALL MISSED (${allMissed.length} matches)`);
    allMissed.slice(0, 15).forEach(t => {
      const draw = DRAWS[t.event];
      let a, b;
      if (t.r === 0) { a = 2 * t.m; b = 2 * t.m + 1; }
      else { a = state.results[t.event]['r' + (t.r - 1)][2 * t.m]; b = state.results[t.event]['r' + (t.r - 1)][2 * t.m + 1]; }
      const loser = t.winner === a ? b : a;
      lines.push(`   ${t.event === 'men' ? 'M' : 'W'} ${ROUND_SHORT[t.r]}: ${recapName(draw, t.winner)} d. ${recapName(draw, loser)}`);
    });
    if (allMissed.length > 15) lines.push(`   …and ${allMissed.length - 15} more`);
    lines.push('');
  }

  lines.push(`🤝 We were all right on ${unanimousCount} matches.`);

  if (allDivided.length > 0 || totalUnanimousNext > 0) {
    lines.push('');
    lines.push(`📈 ${nextLabel} OUTLOOK`);
    if (totalUnanimousNext > 0) lines.push(`   Family is locked in on ${totalUnanimousNext} matches.`);
    if (allDivided.length > 0) {
      lines.push(`   Toss-ups (where we're split):`);
      allDivided.forEach(d => {
        const draw = DRAWS[d.ev];
        const evL = d.ev === 'men' ? 'M' : 'W';
        const outStr = d.out ? `  [${d.out} bracket${d.out > 1 ? 's' : ''} out]` : '';
        lines.push(`     ${evL} ${ROUND_SHORT[d.r]} m${d.m + 1}: ${recapName(draw, d.a)} [${d.aP.join(', ')}] vs ${recapName(draw, d.b)} [${d.bP.join(', ')}]${outStr}`);
      });
    }
  }

  return lines.join('\n');
}

function advanceRecap() {
  if (!db) return;
  fb.setDoc(fb.doc(db, 'meta', 'recap_snapshot'), {
    men: state.results.men,
    women: state.results.women,
    takenAt: Date.now(),
  }).catch(err => alert('Could not save recap snapshot: ' + err.message));
}

async function copyRecap() {
  const text = generateRecapText();
  try {
    await navigator.clipboard.writeText(text);
    alert('Recap copied to clipboard!');
  } catch (e) {
    const ta = document.querySelector('.recap-text');
    if (ta) { ta.focus(); ta.select(); }
    alert("Couldn't auto-copy — the recap text is selected; press Cmd/Ctrl+C.");
  }
}

async function copyTournamentRecap() {
  const text = generateTournamentRecapText();
  try {
    await navigator.clipboard.writeText(text);
    alert('Tournament recap copied to clipboard!');
  } catch (e) {
    const ta = document.getElementById('tournament-recap-text');
    if (ta) { ta.focus(); ta.select(); }
    alert("Couldn't auto-copy — the recap text is selected; press Cmd/Ctrl+C.");
  }
}

// ---- commissioner panels: recap + analytics ----
function commissionerRecapPanel() {
  const recapText = generateRecapText();
  let html = `<div class="panel"><h2>Daily recap</h2>
    <p class="muted small">A shareable summary built from the results that have
      changed since the last recap. Copy it into your family chat, then mark it
      as sent so the next recap diffs from this point.</p>`;
  html += `<textarea class="recap-text" readonly rows="22">${esc(recapText)}</textarea>`;
  html += `<div class="recap-actions">
    <button class="btn" data-action="copy-recap">Copy recap</button>
    <button class="btn ghost" data-action="advance-recap">Mark recap as sent (advance day)</button>
  </div>`;
  if (state.recapSnapshot && state.recapSnapshot.takenAt) {
    const when = new Date(state.recapSnapshot.takenAt)
      .toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' });
    html += `<p class="small muted" style="margin-top:8px">Last advanced: ${esc(when)}</p>`;
  } else {
    html += `<p class="small muted" style="margin-top:8px">No prior recap yet — diff counts from the start of the tournament.</p>`;
  }
  html += `</div>`;
  return html;
}

function commissionerTournamentRecapPanel() {
  const text = generateTournamentRecapText();
  let html = `<div class="panel"><h2>Tournament recap</h2>
    <p class="muted small">A richer, end-of-round shareable summary built from
      everyone's brackets and all results so far — standings, men's/women's
      specialists, style profiles, champion status, the matches we all
      missed, and a look at next round's toss-ups. Independent of the daily
      pointer.</p>`;
  html += `<textarea class="recap-text" id="tournament-recap-text" readonly rows="28">${esc(text)}</textarea>`;
  html += `<div class="recap-actions">
    <button class="btn" data-action="copy-tournament-recap">Copy tournament recap</button>
  </div></div>`;
  return html;
}

function commissionerAnalyticsPanel() {
  const allEntries = Object.values(state.entries).filter(e => e.name).map(e => {
    const mp = normalizePicks(e.men), wp = normalizePicks(e.women);
    const sm = score(mp, state.results.men).total;
    const sw = score(wp, state.results.women).total;
    return {
      id: e.id, name: e.name, men: mp, women: wp,
      score: sm + sw,
      max: entryMaxPossible(mp, state.results.men) + entryMaxPossible(wp, state.results.women),
      ra: { men: roundAccuracy(mp, state.results.men), women: roundAccuracy(wp, state.results.women) },
    };
  }).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

  let html = `<div class="panel"><h2>Analytics</h2>`;

  // Family scorecard — collective stats across everyone's picks.
  const fam = familyStats(allEntries, allPlayedMatches());
  html += `<h3 class="analytics-h3">Family scorecard</h3>`;
  if (fam.total === 0) {
    html += `<p class="muted small">No played matches yet.</p>`;
  } else {
    const pct = Math.round(fam.correct / fam.total * 100);
    html += `<p>Overall: <strong>${fam.correct} / ${fam.total}</strong> picks right
      · <strong class="total">${pct}%</strong></p>`;
    html += `<table class="lb"><thead><tr><th>Round</th>
      <th class="num">Correct</th><th class="num">Played</th><th class="num">%</th></tr></thead><tbody>`;
    for (let r = 0; r < 7; r++) {
      if (fam.byRound[r].played === 0) continue;
      const p = Math.round(fam.byRound[r].correct / fam.byRound[r].played * 100);
      html += `<tr><td>${ROUND_SHORT[r]}</td>
        <td class="num">${fam.byRound[r].correct}</td>
        <td class="num">${fam.byRound[r].played}</td>
        <td class="num">${p}%</td></tr>`;
    }
    html += `</tbody></table>`;

    if (fam.unanimousCorrect.length) {
      html += `<h3 class="analytics-h3">Unanimous right — we all got it (${fam.unanimousCorrect.length})</h3>`;
      html += `<ul class="recap-list small">`;
      fam.unanimousCorrect.slice(0, 15).forEach(u => {
        const draw = DRAWS[u.event];
        const ev = u.event === 'men' ? 'M' : 'W';
        html += `<li>${ev} ${ROUND_SHORT[u.r]}: ${esc(draw[u.winner].name)}</li>`;
      });
      if (fam.unanimousCorrect.length > 15) {
        html += `<li class="muted">…and ${fam.unanimousCorrect.length - 15} more</li>`;
      }
      html += `</ul>`;
    }
    if (fam.unanimousWrong.length) {
      html += `<h3 class="analytics-h3">Unanimous wrong — we all whiffed (${fam.unanimousWrong.length})</h3>`;
      html += `<ul class="recap-list small">`;
      fam.unanimousWrong.forEach(u => {
        const draw = DRAWS[u.event];
        const ev = u.event === 'men' ? 'M' : 'W';
        html += `<li>${ev} ${ROUND_SHORT[u.r]}: we all picked ${esc(draw[u.familyPick].name)},
          but <strong>${esc(draw[u.winner].name)}</strong> won</li>`;
      });
      html += `</ul>`;
    }
  }

  // Bracket health
  html += `<h3 class="analytics-h3">Bracket health</h3>`;
  if (allEntries.length === 0) {
    html += `<p class="muted small">No brackets yet.</p>`;
  } else {
    html += `<table class="lb"><thead><tr><th>Name</th>
      <th class="num">Score</th><th class="num">Max possible</th></tr></thead><tbody>`;
    allEntries.forEach(e => {
      html += `<tr><td>${esc(e.name)}</td>
        <td class="num total">${e.score}</td>
        <td class="num muted">${e.max}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  // Round accuracy
  html += `<h3 class="analytics-h3">Round accuracy (correct / played, M+W combined)</h3>`;
  if (allEntries.length === 0 || !hasResults()) {
    html += `<p class="muted small">Records appear once results come in.</p>`;
  } else {
    html += `<table class="lb"><thead><tr><th>Name</th>` +
      ROUND_SHORT.map(s => `<th class="num">${s}</th>`).join('') + `</tr></thead><tbody>`;
    allEntries.forEach(e => {
      html += `<tr><td>${esc(e.name)}</td>`;
      for (let r = 0; r < 7; r++) {
        const c = e.ra.men[r].correct + e.ra.women[r].correct;
        const p = e.ra.men[r].played + e.ra.women[r].played;
        html += `<td class="num">${p ? c + '/' + p : '—'}</td>`;
      }
      html += `</tr>`;
    });
    html += `</tbody></table>`;
  }

  // Champion-pick survival
  html += `<h3 class="analytics-h3">Champion picks</h3>`;
  if (allEntries.length === 0) {
    html += `<p class="muted small">No champion picks yet.</p>`;
  } else {
    html += `<table class="lb"><thead><tr><th>Player</th><th>Men's pick</th><th>Women's pick</th></tr></thead><tbody>`;
    allEntries.forEach(e => {
      const mch = e.men.r6[0], wch = e.women.r6[0];
      const mAlive = mch !== null ? isAlive(mch, state.results.men) : null;
      const wAlive = wch !== null ? isAlive(wch, state.results.women) : null;
      const tag = (alive) => alive === null ? '' : (alive ? '<span class="tag-alive">alive</span>' : '<span class="tag-out">out</span>');
      html += `<tr><td>${esc(e.name)}</td>
        <td>${mch !== null ? esc(DRAWS.men[mch].name) : '—'} ${tag(mAlive)}</td>
        <td>${wch !== null ? esc(DRAWS.women[wch].name) : '—'} ${tag(wAlive)}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }

  // Upset scorecard (top 10 by gap)
  html += `<h3 class="analytics-h3">Upset scorecard</h3>`;
  const upsets = [
    ...getUpsets('men').map(u => ({ ...u, evLabel: 'M' })),
    ...getUpsets('women').map(u => ({ ...u, evLabel: 'W' })),
  ].sort((a, b) => b.gap - a.gap).slice(0, 10);
  if (upsets.length === 0) {
    html += `<p class="muted small">No upsets yet — favorites are holding.</p>`;
  } else {
    html += `<table class="lb"><thead><tr><th>Match</th><th>Got it</th></tr></thead><tbody>`;
    upsets.forEach(u => {
      const draw = DRAWS[u.event];
      const wn = recapName(draw, u.winner), ln = recapName(draw, u.loser);
      const had = allEntries.filter(e => e[u.event]['r' + u.r][u.m] === u.winner).map(e => e.name);
      html += `<tr><td class="small">${u.evLabel} ${ROUND_SHORT[u.r]}: ${esc(wn)} d. ${esc(ln)}</td>
        <td class="small">${had.length ? esc(had.join(', ')) : '<span class="muted">nobody</span>'}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  html += `</div>`;
  return html;
}

function label(draw, slot) {
  if (slot === null || slot === undefined) return 'TBD';
  const p = draw[slot];
  if (!p) return '—';
  return p.seed ? `${p.name} (${p.seed})` : p.name;
}

// ---------------------------------------------------------------------------
// Firebase
// ---------------------------------------------------------------------------
let db, fb;

async function initFirebase() {
  const appMod = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
  fb = await import('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
  const app = appMod.initializeApp(firebaseConfig);
  db = fb.getFirestore(app);

  fb.onSnapshot(fb.collection(db, 'entries'), snap => {
    state.error = null;
    state.entries = {};
    snap.forEach(d => { state.entries[d.id] = { id: d.id, ...d.data() }; });
    if (state.userId && !state.myPicksLoaded) {
      const mine = state.entries[state.userId];
      if (mine) {
        state.myPicks = { men: normalizePicks(mine.men), women: normalizePicks(mine.women) };
        if (!state.userName) state.userName = mine.name;
        if (mine.pin) state.userPin = mine.pin;
      } else {
        // Saved session points to an entry that no longer exists — sign out
        // cleanly and fall back to the welcome screen.
        state.userId = null;
        state.userName = null;
        localStorage.removeItem('rg26_uid');
        localStorage.removeItem('rg26_name');
      }
      state.myPicksLoaded = true;
    }
    state.ready = true;
    render();
  }, err => { state.error = err; render(); });

  fb.onSnapshot(fb.doc(db, 'meta', 'results'), d => {
    const data = d.exists() ? d.data() : {};
    state.results = {
      men: normalizePicks(data.men),
      women: normalizePicks(data.women),
    };
    render();
  });

  fb.onSnapshot(fb.doc(db, 'meta', 'config'), d => {
    state.config = d.exists() ? { locked: !!d.data().locked } : { locked: false };
    render();
  });

  fb.onSnapshot(fb.doc(db, 'meta', 'recap_snapshot'), d => {
    const data = d.exists() ? d.data() : null;
    state.recapSnapshot = data ? {
      men: normalizePicks(data.men),
      women: normalizePicks(data.women),
      takenAt: data.takenAt || null,
    } : null;
    render();
  });
}

let saveTimer;
function saveMyEntry() {
  if (!state.userId || !db) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fb.setDoc(fb.doc(db, 'entries', state.userId), {
      name: state.userName,
      pin: state.userPin || '',
      men: state.myPicks.men,
      women: state.myPicks.women,
      updatedAt: Date.now(),
    }).catch(err => alert('Could not save: ' + err.message));
  }, 600);
}

let resultsTimer;
function saveResults() {
  if (!db) return;
  clearTimeout(resultsTimer);
  resultsTimer = setTimeout(() => {
    fb.setDoc(fb.doc(db, 'meta', 'results'), {
      men: state.results.men,
      women: state.results.women,
      updatedAt: Date.now(),
    }).catch(err => alert('Could not save results: ' + err.message));
  }, 500);
}

function setLocked(locked) {
  if (!db) return;
  fb.setDoc(fb.doc(db, 'meta', 'config'), { locked }, { merge: true })
    .catch(err => alert('Could not update lock: ' + err.message));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Step 2 of sign-in: validate (returning) or set (new) the PIN for the name.
function submitPin(pin) {
  const name = state.pendingName;
  const existing = state.entries[slug(name)];
  const returning = !!(existing && existing.pin);
  if (returning) {
    if (pin === String(existing.pin)) {
      enterBracket(name, existing.pin);
    } else {
      state.pinError = 'Incorrect PIN. Try again, or ask the commissioner to look it up.';
      render();
    }
    return;
  }
  if (!/^\d{4}$/.test(pin)) {
    state.pinError = 'Please choose a 4-digit PIN (numbers only).';
    render();
    return;
  }
  enterBracket(name, pin);
}

// Load (or create) the bracket for this name and enter the app.
function enterBracket(name, pin) {
  const uid = slug(name);
  state.userId = uid;
  state.userName = name;
  state.userPin = String(pin);
  const existing = state.entries[uid];
  state.myPicks = existing
    ? { men: normalizePicks(existing.men), women: normalizePicks(existing.women) }
    : { men: emptyPicks(), women: emptyPicks() };
  state.myPicksLoaded = true;
  state.pendingName = null;
  state.pinError = null;
  localStorage.setItem('rg26_uid', uid);
  localStorage.setItem('rg26_name', name);
  state.view = 'bracket';
  saveMyEntry();
  render();
}

function newBracket() {
  if (!confirm('Start a fresh bracket as a different person? Your current device will switch to the new entry.')) return;
  localStorage.removeItem('rg26_uid');
  localStorage.removeItem('rg26_name');
  location.reload();
}

function doPick(r, m, slot) {
  if (state.config.locked) return;
  const picks = state.myPicks[state.event];
  picks['r' + r][m] = slot;
  validate(picks);
  saveMyEntry();
  render();
}

function doResult(r, m, slot) {
  if (!state.commish) return;
  const picks = state.results[state.event];
  picks['r' + r][m] = (picks['r' + r][m] === slot) ? null : slot;
  validate(picks);
  saveResults();
  render();
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
const appEl = document.getElementById('app');

function render() {
  if (NEEDS_SETUP) { appEl.innerHTML = setupScreen(); return; }
  if (state.error) { appEl.innerHTML = errorScreen(state.error); return; }
  if (!state.ready) { appEl.innerHTML = '<div class="center muted" style="padding:40px">Connecting…</div>'; return; }
  if (!state.userId) { appEl.innerHTML = welcomeScreen(); return; }
  if (!state.myPicks) { appEl.innerHTML = '<div class="center muted" style="padding:40px">Loading your bracket…</div>'; return; }

  let body;
  if (state.viewingEntryId) body = entryView();
  else if (state.view === 'leaderboard') body = leaderboardView();
  else if (state.view === 'commissioner') body = commissionerView();
  else body = bracketView();

  appEl.innerHTML = header() + body + footer();
}

function header() {
  const tab = (v, lbl) =>
    `<button class="${state.view === v && !state.viewingEntryId ? 'active' : ''}" data-action="nav" data-view="${v}">${lbl}</button>`;
  return `
    <header class="app-head">
      <div class="brand">
        <h1 class="title">Kiwi House Family Bracket Challenge</h1>
        <div class="subtitle">Roland Garros 2026</div>
      </div>
      <div class="whoami">Playing as <strong>${esc(state.userName)}</strong>
        · <a data-action="new-bracket">not you?</a></div>
      <nav class="tabs">
        ${tab('bracket', 'My Bracket')}
        ${tab('leaderboard', 'Leaderboard')}
        ${tab('commissioner', 'Commissioner')}
      </nav>
    </header>`;
}

function footer() {
  return `<div class="foot">Picks: 10 / 20 / 40 / 80 / 160 / 320 / 640 points per correct
    result, R128 → Final. Champion pick = 640.</div>`;
}

// ---- event + round selectors ----
function eventSeg() {
  return `<div class="seg">${EVENTS.map(([ev, lbl]) =>
    `<button class="${state.event === ev ? 'active' : ''}" data-action="event" data-event="${ev}">${lbl}</button>`).join('')}</div>`;
}

function roundSeg(picks) {
  return `<div class="rounds">${ROUND_SHORT.map((s, r) => {
    const done = picks['r' + r].every(v => v !== null);
    return `<button class="${state.round === r ? 'active' : ''}" data-action="round" data-round="${r}">${s}${done ? ' <span class="chk">✓</span>' : ''}</button>`;
  }).join('')}</div>`;
}

// ---- a single match's two option buttons ----
function optBtn(draw, slot, r, m, picked, action, results) {
  const isPicked = picked !== null && picked === slot;
  const disabled = slot === null || slot === undefined || !action;
  let cls = 'opt';
  if (isPicked) cls += ' picked';
  if (results && isPicked) {
    const res = results['r' + r][m];
    if (res !== null && res !== undefined) {
      cls = 'opt ' + (picked === res ? 'correct' : 'wrong');
    }
  }
  return `<button class="${cls}" ${disabled ? 'disabled' : ''}`
    + (action ? ` data-action="${action}" data-r="${r}" data-m="${m}" data-slot="${slot}"` : '')
    + `>${esc(label(draw, slot))}</button>`;
}

// ---- the match list for one round ----
function matchList(picks, event, r, action, results) {
  const draw = DRAWS[event];
  let html = '<div class="matches">';
  for (let m = 0; m < ROUND_SIZES[r]; m++) {
    const c = contenders(picks, r, m);
    const picked = picks['r' + r][m];
    html += `<div class="match"><span class="mno">${m + 1}</span>`
      + optBtn(draw, c[0], r, m, picked, action, results)
      + `<span class="vs">v</span>`
      + optBtn(draw, c[1], r, m, picked, action, results)
      + `</div>`;
  }
  return html + '</div>';
}

function progress(picks) {
  const done = countDone(picks);
  const pct = Math.round((done / TOTAL_PICKS) * 100);
  return `<div class="progress-wrap">
    <div class="progress-bar"><div style="width:${pct}%"></div></div>
    <div class="progress-label">${done} / ${TOTAL_PICKS} picks made${done === TOTAL_PICKS ? ' — bracket complete!' : ''}</div>
  </div>`;
}

// ---- main bracket view (filling in your own picks) ----
function bracketView() {
  const picks = state.myPicks[state.event];
  const locked = state.config.locked;
  const showResults = hasResults();
  let html = eventSeg();

  if (locked) {
    html += `<div class="banner lock">🔒 Brackets are locked — picks are final. ${showResults ? 'Results below show ✓ / ✗.' : ''}</div>`;
  } else {
    html += `<div class="banner warn">Pick a winner for every match. Earlier picks feed the next round.
      Your picks save automatically. The commissioner will lock all brackets before play starts.</div>`;
  }

  if (showResults) {
    const sM = score(state.myPicks.men, state.results.men).total;
    const sW = score(state.myPicks.women, state.results.women).total;
    html += `<div class="banner score">Your score — Men ${sM} · Women ${sW} · Total ${sM + sW}</div>`;
  }

  html += roundSeg(picks);
  html += `<div class="panel"><h2>${ROUND_NAMES[state.round]} — ${EVENTS.find(e => e[0] === state.event)[1]}</h2>`;
  html += progress(picks);

  if (state.round > 0 && !picks['r' + (state.round - 1)].every(v => v !== null)) {
    html += `<div class="banner warn">Finish ${ROUND_NAMES[state.round - 1]} first — matches here fill in from those winners.</div>`;
  }

  html += matchList(picks, state.event, state.round,
    locked ? null : 'pick', showResults ? state.results[state.event] : null);

  if (state.round === 6) {
    const champ = picks.r6[0];
    html += `<div class="champion-box"><div class="lbl">Your champion pick</div>
      <div class="name">${champ !== null ? esc(label(DRAWS[state.event], champ)) : '— not picked —'}</div></div>`;
  }
  html += '</div>';
  return html;
}

// ---- leaderboard ----
function leaderboardView() {
  const locked = state.config.locked;
  const rows = Object.values(state.entries).map(e => {
    const mp = normalizePicks(e.men), wp = normalizePicks(e.women);
    const sm = score(mp, state.results.men);
    const sw = score(wp, state.results.women);
    return {
      id: e.id, name: e.name || 'Unnamed',
      men: sm.total, women: sw.total, total: sm.total + sw.total,
      done: countDone(mp) + countDone(wp),
      champM: mp.r6[0], champW: wp.r6[0],
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  let html = `<div class="panel"><h2>Leaderboard</h2>`;
  if (!hasResults()) {
    html += `<div class="banner warn">No results entered yet — scores update live as the
      commissioner records match winners.</div>`;
  }
  if (rows.length === 0) {
    html += `<p class="muted">No brackets submitted yet.</p></div>`;
    return html;
  }

  html += `<table class="lb"><thead><tr>
    <th class="rank"></th><th>Name</th>
    <th class="num">Men</th><th class="num">Women</th><th class="num">Total</th>
    </tr></thead><tbody>`;
  rows.forEach((r, i) => {
    const me = r.id === state.userId;
    const canOpen = locked || me;
    html += `<tr class="${me ? 'me ' : ''}${canOpen ? 'clickable' : ''}"
      ${canOpen ? `data-action="view-entry" data-id="${r.id}"` : ''}>
      <td class="rank">${i === 0 && r.total > 0 ? '<span class="leader-crown">♛</span>' : (i + 1)}</td>
      <td>${esc(r.name)}${me ? ' (you)' : ''}<div class="small muted">${r.done}/${TOTAL_PICKS * 2} picks</div></td>
      <td class="num">${r.men}</td><td class="num">${r.women}</td>
      <td class="num total">${r.total}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  html += locked
    ? `<p class="small muted">Tap a row to view that bracket.</p>`
    : `<p class="small muted">Other players' picks stay hidden until brackets lock.</p>`;
  html += `</div>`;
  return html;
}

// ---- read-only view of one person's bracket ----
function entryView() {
  const e = state.entries[state.viewingEntryId];
  if (!e) { state.viewingEntryId = null; return leaderboardView(); }
  const picks = { men: normalizePicks(e.men), women: normalizePicks(e.women) };
  const ev = state.event;
  const showResults = hasResults();
  const sm = score(picks.men, state.results.men);
  const sw = score(picks.women, state.results.women);

  let html = `<div class="panel"><h2>${esc(e.name || 'Bracket')}</h2>`;
  html += `<button class="btn ghost" data-action="back">← Leaderboard</button>`;
  if (showResults) {
    html += `<div class="banner score" style="margin-top:10px">Men ${sm.total} · Women ${sw.total} · Total ${sm.total + sw.total}</div>`;
  }
  html += eventSeg();
  html += roundSeg(picks[ev]);
  html += `<h2 style="margin-top:12px">${ROUND_NAMES[state.round]} — ${EVENTS.find(x => x[0] === ev)[1]}</h2>`;
  html += matchList(picks[ev], ev, state.round, null, showResults ? state.results[ev] : null);
  const champ = picks[ev].r6[0];
  html += `<div class="champion-box"><div class="lbl">Champion pick</div>
    <div class="name">${champ !== null ? esc(label(DRAWS[ev], champ)) : '—'}</div></div>`;
  html += `</div>`;
  return html;
}

// ---- commissioner ----
function commissionerView() {
  if (!state.commish) {
    return `<div class="panel"><h2>Commissioner</h2>
      <p class="muted">Enter the commissioner password to record match results and
      lock the brackets.</p>
      <form data-form="commish">
        <input type="password" name="pw" placeholder="Commissioner password" autocomplete="off" />
        <button class="btn" type="submit">Unlock commissioner tools</button>
      </form></div>`;
  }

  const picks = state.results[state.event];
  let html = `<div class="panel"><h2>Commissioner tools</h2>`;
  html += `<div class="banner ${state.config.locked ? 'lock' : 'warn'}">
    Brackets are <strong>${state.config.locked ? 'LOCKED' : 'OPEN'}</strong>.
    ${state.config.locked ? 'Players can no longer change picks.' : 'Players can still edit their picks.'}
    </div>`;
  html += `<button class="btn ${state.config.locked ? 'court' : ''}" data-action="toggle-lock">
    ${state.config.locked ? 'Unlock brackets' : 'Lock brackets now'}</button>`;
  html += `<p class="small muted">Lock the brackets once the tournament starts so picks are final.</p>`;
  html += `</div>`;

  // Player PINs — so the commissioner can help anyone who forgets theirs.
  const players = Object.values(state.entries).filter(e => e.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  html += `<div class="panel"><h2>Player PINs</h2>
    <p class="muted small">If someone forgets their PIN, look it up here and tell them.</p>`;
  if (!players.length) {
    html += `<p class="muted">No brackets started yet.</p>`;
  } else {
    html += `<table class="lb"><thead><tr><th>Name</th><th class="num">PIN</th></tr></thead><tbody>`;
    players.forEach(e => {
      html += `<tr><td>${esc(e.name)}</td><td class="num">${esc(e.pin || '—')}</td></tr>`;
    });
    html += `</tbody></table>`;
  }
  html += `</div>`;

  html += `<div class="panel"><h2>Record results</h2>
    <p class="muted">Tap the actual winner of each match. Tap again to clear. Scores
    update live on the leaderboard.</p>`;
  html += eventSeg();
  html += roundSeg(picks);
  html += `<h2 style="margin-top:12px">${ROUND_NAMES[state.round]} — ${EVENTS.find(e => e[0] === state.event)[1]}</h2>`;
  html += matchList(picks, state.event, state.round, 'result', null);
  if (state.round === 6) {
    const champ = picks.r6[0];
    html += `<div class="champion-box"><div class="lbl">Champion</div>
      <div class="name">${champ !== null ? esc(label(DRAWS[state.event], champ)) : '— not decided —'}</div></div>`;
  }
  html += `</div>`;

  html += commissionerRecapPanel();
  html += commissionerTournamentRecapPanel();
  html += commissionerAnalyticsPanel();

  return html;
}

// ---- welcome / first run ----
function welcomeScreen() {
  const hero = `
    <div class="welcome-hero">
      <img class="hero-logo" src="logo.png" alt="Roland Garros 2026"
        onerror="rgLogoFallback(this)" />
      <h1 class="title">Kiwi House Family Bracket Challenge</h1>
      <div class="subtitle">Roland Garros 2026</div>
      <p class="hero-tagline">Men's &amp; Women's singles predictions</p>
    </div>`;
  return hero + (state.pendingName ? pinPanel() : namePanel());
}

function namePanel() {
  return `
    <div class="panel">
      <h2>Select your name to start</h2>
      <p class="muted small">Pick winners through all seven rounds of both draws.
        Your bracket is saved under your name and protected by a PIN, so you can
        fill it in from any phone or computer.</p>
      <form data-form="name">
        <label class="field-label" for="player-select">Pick your name from the dropdown</label>
        <select name="name" id="player-select" required>
          <option value="" selected disabled>— Select your name —</option>
          ${[...PLAYERS].sort((a, b) => a.localeCompare(b)).map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}
        </select>
        <button class="btn" type="submit">Continue</button>
      </form>
    </div>`;
}

function pinPanel() {
  const name = state.pendingName;
  const existing = state.entries[slug(name)];
  const returning = !!(existing && existing.pin);
  return `
    <div class="panel">
      <h2>${returning ? 'Welcome back, ' + esc(name) : 'Hi ' + esc(name) + '!'}</h2>
      <p class="muted small">${returning
        ? 'Enter your 4-digit PIN to open your bracket.'
        : 'Create a 4-digit PIN — you\'ll use it to open your bracket on any device, so pick something memorable.'}</p>
      ${state.pinError ? `<div class="banner warn">${esc(state.pinError)}</div>` : ''}
      <form data-form="pin">
        <label class="field-label" for="pin-input">${returning ? 'Your PIN' : 'Choose a 4-digit PIN'}</label>
        <input type="text" inputmode="numeric" name="pin" id="pin-input" maxlength="4"
          pattern="[0-9]*" placeholder="4 digits" autocomplete="off" />
        <button class="btn" type="submit">${returning ? 'Open my bracket' : 'Create my bracket'}</button>
      </form>
      <p class="small"><a data-action="pick-different-name">← Choose a different name</a></p>
    </div>`;
}

// ---- setup screen (Firebase not configured) ----
function setupScreen() {
  return `
    <header class="app-head"><div class="brand">
      <h1 class="title">Kiwi House Family Bracket Challenge</h1>
      <div class="subtitle">Roland Garros 2026</div></div></header>
    <div class="panel">
      <h2>One-time setup needed</h2>
      <p>This app needs a free Firebase project so everyone's picks and the
        leaderboard sync. Open <code>firebase-config.js</code> and follow these steps:</p>
      <ol class="steps">
        <li>Create a free project at <code>console.firebase.google.com</code>.</li>
        <li>Click the web icon <code>&lt;/&gt;</code> to register a web app.</li>
        <li>Copy the <code>firebaseConfig</code> values into <code>firebase-config.js</code>.</li>
        <li>In <code>Build → Firestore Database</code>, create a database.</li>
        <li>In the Firestore <code>Rules</code> tab, paste these rules and publish:</li>
      </ol>
      <pre class="rules">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}</pre>
      <p class="small muted">Full instructions are in <code>README.md</code>. Reload this
        page once <code>firebase-config.js</code> is filled in.</p>
    </div>`;
}

// ---- connection error (usually Firestore rules not set) ----
function errorScreen(err) {
  const msg = (err && (err.message || err.code)) || String(err);
  const perm = /permission|insufficient/i.test(msg);
  return `
    <header class="app-head"><div class="brand">
      <h1 class="title">Kiwi House Family Bracket Challenge</h1>
      <div class="subtitle">Roland Garros 2026</div></div></header>
    <div class="panel">
      <h2>Can't reach the database</h2>
      ${perm ? `<p>Firestore is rejecting requests — the security rules still need
        to be published.</p>
      <ol class="steps">
        <li>Open your project at <code>console.firebase.google.com</code>.</li>
        <li>Go to <code>Firestore Database → Rules</code> tab.</li>
        <li>Select all the text, replace it with the rules below, and click
          <strong>Publish</strong>.</li>
      </ol>
      <pre class="rules">rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if true;
    }
  }
}</pre>` : `<p class="muted">${esc(msg)}</p>`}
      <p class="small muted">Reload this page after publishing.</p>
    </div>`;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------
appEl.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const a = el.dataset.action;
  if (a === 'nav') { state.view = el.dataset.view; state.viewingEntryId = null; state.round = 0; render(); }
  else if (a === 'event') { state.event = el.dataset.event; render(); }
  else if (a === 'round') { state.round = +el.dataset.round; render(); }
  else if (a === 'pick') { doPick(+el.dataset.r, +el.dataset.m, +el.dataset.slot); }
  else if (a === 'result') { doResult(+el.dataset.r, +el.dataset.m, +el.dataset.slot); }
  else if (a === 'view-entry') { state.viewingEntryId = el.dataset.id; state.round = 0; render(); }
  else if (a === 'back') { state.viewingEntryId = null; render(); }
  else if (a === 'toggle-lock') { setLocked(!state.config.locked); }
  else if (a === 'new-bracket') { newBracket(); }
  else if (a === 'pick-different-name') { state.pendingName = null; state.pinError = null; render(); }
  else if (a === 'copy-recap') { copyRecap(); }
  else if (a === 'copy-tournament-recap') { copyTournamentRecap(); }
  else if (a === 'advance-recap') {
    if (confirm('Mark this recap as sent? The next recap will diff from this point.')) advanceRecap();
  }
});

appEl.addEventListener('submit', e => {
  e.preventDefault();
  const form = e.target.dataset.form;
  if (form === 'name') {
    const name = e.target.name.value;
    if (name) { state.pendingName = name; state.pinError = null; render(); }
    else alert('Please pick your name from the dropdown.');
  } else if (form === 'pin') {
    submitPin(e.target.pin.value.trim());
  } else if (form === 'commish') {
    if (e.target.pw.value === COMMISSIONER_PASSWORD) { state.commish = true; render(); }
    else alert('Incorrect password.');
  }
});

// ---------------------------------------------------------------------------
// Decorative cascading tennis balls
// ---------------------------------------------------------------------------
// Shown if logo.png hasn't been added to the folder yet.
window.rgLogoFallback = function (img) {
  const ball = document.createElement('div');
  ball.className = 'ball';
  ball.textContent = '🎾';
  img.replaceWith(ball);
};

function mountBallRain() {
  const layer = document.createElement('div');
  layer.className = 'ball-rain';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 16; i++) {
    const b = document.createElement('span');
    b.textContent = '🎾';
    b.style.left = (Math.random() * 96) + 'vw';
    b.style.fontSize = (16 + Math.random() * 30) + 'px';
    b.style.animationDuration = (7 + Math.random() * 9) + 's';
    b.style.animationDelay = (-Math.random() * 16) + 's';
    layer.appendChild(b);
  }
  document.body.appendChild(layer);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
mountBallRain();
if (NEEDS_SETUP) {
  render();
} else {
  initFirebase().catch(err => {
    appEl.innerHTML = `<div class="panel"><h2>Could not connect</h2>
      <p class="muted">${esc(err.message)}</p>
      <p class="small muted">Check the values in <code>firebase-config.js</code> and that
      Firestore is enabled. See <code>README.md</code>.</p></div>`;
  });
}
