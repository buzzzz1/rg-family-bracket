// NOTE: keep ?v= in sync with the stamp in index.html on every deploy so a
// changed draws.js / firebase-config.js is refetched (assets are cached 4h).
import { DRAWS } from './draws.js?v=20260707-1600';
import { firebaseConfig, COMMISSIONER_PASSWORD } from './firebase-config.js?v=20260628-1200';

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
// Categorical line colors (dataviz-validated order; assigned to players by a
// stable key so a person keeps their color regardless of standing).
const CHART_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
// Build stamp — keep in sync with the ?v= stamp in index.html. The app polls
// index.html and shows a "refresh for the new version" banner when this differs
// from the deployed stamp, so open tabs find out about code updates on their own.
const BUILD = '20260708-1245';
// Tournament day + date shown on the Daily Recap header. Pinned (not clock-
// derived) so they stay put; bump both by hand as play advances.
const TOURNAMENT_DAY = 10;
const TOURNAMENT_DATE = 'Wednesday, July 8';
const TOURNAMENT_ROUND = 4; // round shown in the recap header (0=R128, 1=R64, 2=R32, 3=R16, 4=QF, …)
// The matches actually played on the recap's day (its order of play), hand-entered
// so the recap — points for the day, highlights, and who fell — is scoped to
// exactly that day's matches (not inferred). Names must match draws.js exactly;
// the round is derived. Update this together with the day/date above.
const RECAP_DAY_MATCHES = [
  { ev: 'men',   a: 'F. Cobolli',  b: 'A. Fery' },
  { ev: 'men',   a: 'T. Fritz',    b: 'A. Zverev' },
  { ev: 'women', a: 'M. Kostyuk',  b: 'J. Paolini' },
  { ev: 'women', a: 'L. Noskova',  b: 'E. Mertens' },
];
// "Matches to Watch" is today's order of play — hand-entered from the official
// schedule since the real OOP can't be derived from the draw. `a`/`b` names must
// match draws.js exactly; times are UK local (BST). Update this daily; set the
// list to [] on a rest/finished day. Matches drop off automatically once their
// result is entered, so the panel always shows only what's still to come today.
const WATCH_DATE = 'Semifinals — Thursday & Friday';
// Featured upcoming matches. `a`/`b` names must match draws.js exactly; the round
// (R16, QF, …) is derived from where the two players meet. `court`/`order`/`time`
// are optional schedule bits (UK local / BST). Each match shows a two-sided
// "if A wins / if B wins" read on what it means for the pool.
const TODAY_MATCHES = [
  { ev: 'women', a: 'K. Muchova',  b: 'C. Gauff',    court: 'Centre Court', order: 'Thu 1st on', time: '' },
  { ev: 'women', a: 'M. Kostyuk',  b: 'L. Noskova',  court: 'Centre Court', order: 'Thu 2nd on', time: '' },
  { ev: 'men',   a: 'J. Sinner',   b: 'N. Djokovic', court: 'Centre Court', order: 'Fri 1st on', time: '' },
  { ev: 'men',   a: 'A. Fery',     b: 'A. Zverev',   court: 'Centre Court', order: 'Fri 2nd on', time: '' },
];
const EVENTS = [['men', "Men's Singles"], ['women', "Women's Singles"]];
const TOTAL_PICKS = ROUND_SIZES.reduce((a, b) => a + b, 0); // 127 per draw

// Each tournament gets its own Firestore namespace so a new pool starts empty
// while past tournaments keep their data. Bump SEASON for the next event.
// The archived Roland Garros 2026 page (in /rg2026/) leaves SEASON empty and
// keeps using the original 'entries' / 'meta' collections.
const SEASON = 'wim2026';
const ENTRIES_COLL = SEASON ? `${SEASON}_entries` : 'entries';
const META_COLL = SEASON ? `${SEASON}_meta` : 'meta';

// The family members. Each picks their name from the dropdown; their bracket
// is stored under that name and follows them across devices.
const PLAYERS = ['Chloe', 'Claire', 'Adrian', 'Chris', 'Mom', 'Michael', 'Andrew'];

const NEEDS_SETUP = !firebaseConfig || !firebaseConfig.apiKey ||
  /PASTE_|YOUR_/.test(firebaseConfig.apiKey);

// ISO 3166-1 alpha-2 → display name, for the codes used in the draws.
const COUNTRY_NAMES = {
  ad: 'Andorra', ar: 'Argentina', at: 'Austria', au: 'Australia', ba: 'Bosnia & Herzegovina',
  be: 'Belgium', bg: 'Bulgaria', br: 'Brazil', by: 'Belarus', ca: 'Canada', ch: 'Switzerland',
  cl: 'Chile', cn: 'China', co: 'Colombia', cz: 'Czechia', de: 'Germany', dk: 'Denmark',
  es: 'Spain', fi: 'Finland', fr: 'France', gb: 'Great Britain', ge: 'Georgia', gr: 'Greece',
  hr: 'Croatia', hu: 'Hungary', id: 'Indonesia', it: 'Italy', jp: 'Japan', kr: 'South Korea',
  kz: 'Kazakhstan', lt: 'Lithuania', lv: 'Latvia', mk: 'North Macedonia', mx: 'Mexico',
  nl: 'Netherlands', no: 'Norway', pe: 'Peru', ph: 'Philippines', pl: 'Poland', pt: 'Portugal',
  py: 'Paraguay', ro: 'Romania', rs: 'Serbia', ru: 'Russia', si: 'Slovenia', sk: 'Slovakia',
  th: 'Thailand', tr: 'Turkey', ua: 'Ukraine', us: 'United States', uz: 'Uzbekistan',
};
function countryName(cc) {
  cc = (cc || '').toLowerCase();
  return COUNTRY_NAMES[cc] || (cc ? cc.toUpperCase() : '');
}
// Age in whole years from a 'YYYY-MM-DD' date of birth, or null if unknown.
function ageFromDob(dob) {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const b = new Date(dob + 'T00:00:00');
  if (isNaN(b)) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age--;
  return age;
}

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
  config: { locked: false, tournamentComplete: false },
  commish: false,
  viewingEntryId: null,
  playerModal: null,        // { ev, slot } when a player info card is open
  shareCard: false,         // true when the screenshot-friendly one-pager is open
  ready: false,
};

// The top-level tabs, mirrored into the URL hash so a refresh (or a shared
// link) lands back on the same page instead of resetting to the bracket.
const VIEWS = ['bracket', 'draw', 'leaderboard', 'recap', 'commissioner', 'archive'];
function viewFromHash() {
  const h = location.hash.replace(/^#/, '');
  return VIEWS.includes(h) ? h : null;
}
// Restore the view from the hash on load, before the first render.
{ const hv = viewFromHash(); if (hv) { state.view = hv; if (hv === 'draw') state._pendingDrawRound = true; } }

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

// Cumulative points from correct picks in rounds 0..rMax (for the trend chart).
function scoreThroughRound(picks, results, rMax) {
  let t = 0;
  for (let r = 0; r <= rMax; r++) for (let m = 0; m < ROUND_SIZES[r]; m++) {
    const res = results['r' + r][m];
    if (res !== null && res !== undefined && picks['r' + r][m] === res) t += ROUND_POINTS[r];
  }
  return t;
}

// How many matches in a draw have a recorded result (the shared denominator).
function playedCount(results) {
  let n = 0;
  for (let r = 0; r < 7; r++) for (let m = 0; m < ROUND_SIZES[r]; m++) {
    const v = results['r' + r][m];
    if (v !== null && v !== undefined) n++;
  }
  return n;
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

// Round at which a player exited (lost). -1 if they're still alive or won everything.
function exitRound(slot, results) {
  for (let r = 0; r < 7; r++) {
    const v = results['r' + r][matchOfSlot(slot, r)];
    if (v !== null && v !== undefined && v !== slot) return r;
  }
  return -1;
}
// Deepest round an entry has picked player c (i.e., the furthest round they had them winning).
function deepestStage(entryPicks, ev, c) {
  let d = -1;
  for (let r = 0; r < 7; r++) {
    if (entryPicks[ev]['r' + r][matchOfSlot(c, r)] === c) d = r;
  }
  return d;
}
// Bracket's theoretical max: if every pick they made had won, regardless of outcome.
function bracketCeiling(entryPicks) {
  let t = 0;
  for (const ev of ['men', 'women']) {
    for (let r = 0; r < 7; r++) {
      for (let m = 0; m < ROUND_SIZES[r]; m++) {
        if (entryPicks[ev]['r' + r][m] !== null && entryPicks[ev]['r' + r][m] !== undefined) {
          t += ROUND_POINTS[r];
        }
      }
    }
  }
  return t;
}
// What stage an entry reaches a player TO by winning round r (R6 win => 'title'; R5 win => 'final'; etc.).
const REACHED = ['R64', 'R32', 'R16', 'QF', 'SF', 'final', 'title'];

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
  const unanimousCorrect = [], unanimousWrong = [], splits = [];
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
    let pickCount = 0, winC = 0, loseC = 0;
    for (const e of entries) {
      const p = e[t.event]['r' + t.r][t.m];
      if (p === null || p === undefined) continue;
      if (p !== cA && p !== cB) continue; // dead pick — player isn't in this match
      pickCount++; total++;
      byRound[t.r].played++;
      if (p === t.winner) { correct++; winC++; byRound[t.r].correct++; }
      else loseC++; // picked the other contender (who lost)
    }
    const loser = (t.winner === cA) ? cB : cA;
    // Categorize by everyone who still had a LIVE pick on this match (their
    // bracket pick was one of the two contenders). People whose pick lost
    // earlier hold a "dead pick" and have no real opinion here, so they don't
    // count either way. This keeps matches from vanishing when, in later
    // rounds, fewer than N brackets still have a horse in the race.
    // Need at least two brackets with a live pick — a lone bracket isn't "we all".
    if (pickCount >= 2) {
      if (loseC === 0) unanimousCorrect.push({ ...t, loser, winC, loseC, pickCount });
      else if (winC === 0) unanimousWrong.push({ ...t, loser, familyPick: loser, winC, loseC, pickCount });
      else splits.push({ ...t, loser, winC, loseC, pickCount });
    }
    if (pickCount > 0) {
      const rec = { ...t, correctCount: winC, pickCount };
      if (!hardest || winC < hardest.correctCount) hardest = rec;
      if (!easiest || winC > easiest.correctCount) easiest = rec;
    }
  }
  return { total, correct, byRound, unanimousCorrect, unanimousWrong, splits, hardest, easiest };
}

// The daily recap covers YESTERDAY's play, so the header date is yesterday.
function tournamentDay() {
  return { dateStr: TOURNAMENT_DATE };
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
  // Deepest round an entry has carried player `c` (its furthest pick for them).
  function deepestStage(e, ev, c) {
    let d = -1;
    for (let r = 0; r < 7; r++) if (e[ev]['r' + r][matchOfSlot(c, r)] === c) d = r;
    return d;
  }
  // Max points an entry still has riding on player `c`, from round `from` onward.
  function ridingPoints(e, ev, c, from) {
    let pts = 0;
    for (let r = from; r < 7; r++) if (e[ev]['r' + r][matchOfSlot(c, r)] === c) pts += ROUND_POINTS[r];
    return pts;
  }
  // Stage an entry reaches a player to by winning round r (pick at r = "wins r").
  const REACHED = ['R64', 'R32', 'R16', 'QF', 'SF', 'final', 'champion'];
  function outlookForEvent(ev, r) {
    if (r < 0) return null;
    const matches = [];
    let locked = 0, split = 0;
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      let a, b;
      if (r === 0) { a = 2 * m; b = 2 * m + 1; }
      else { a = state.results[ev]['r' + (r - 1)][2 * m]; b = state.results[ev]['r' + (r - 1)][2 * m + 1]; }
      if (a == null || b == null) continue;
      const aBackers = entries.filter(e => e[ev]['r' + r][m] === a);
      const bBackers = entries.filter(e => e[ev]['r' + r][m] === b);
      const inPlay = aBackers.length + bBackers.length;
      if (inPlay === 0) continue; // nobody alive on this match — skip
      if (aBackers.length === inPlay || bBackers.length === inPlay) locked++; else split++;
      // Total family max-points hinging on this single match (lost if your pick falls).
      let stakes = 0;
      for (const e of [...aBackers, ...bBackers]) stakes += ridingPoints(e, ev, e[ev]['r' + r][m], r);
      // Furthest stage each side is carried to, grouped (deepest first).
      const carry = (backers, c) => {
        const byStage = {};
        backers.forEach(e => { const d = deepestStage(e, ev, c); (byStage[d] = byStage[d] || []).push(e.name); });
        return Object.keys(byStage).map(Number).sort((x, y) => y - x)
          .map(d => ({ rank: d, stage: REACHED[d], names: byStage[d] }));
      };
      matches.push({
        ev, r, m, a, b,
        aP: aBackers.map(e => e.name), bP: bBackers.map(e => e.name),
        aCarry: carry(aBackers, a), bCarry: carry(bBackers, b),
        inPlay, out: N - inPlay, stakes,
      });
    }
    matches.sort((x, y) => y.stakes - x.stakes);
    return { ev, matches, locked, split, label: ROUND_SHORT[r] };
  }
  const nextMen = nextActiveRound(state.results.men);
  const nextWomen = nextActiveRound(state.results.women);
  const outMen = outlookForEvent('men', nextMen);
  const outWomen = outlookForEvent('women', nextWomen);

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

  const r64Missed = allMissed.filter(t => t.r === 1);
  if (r64Missed.length) {
    lines.push(`😱 WE ALL MISSED — R64 (${r64Missed.length} matches)`);
    r64Missed.slice(0, 15).forEach(t => {
      const draw = DRAWS[t.event];
      const a = state.results[t.event].r0[2 * t.m];
      const b = state.results[t.event].r0[2 * t.m + 1];
      const loser = t.winner === a ? b : a;
      lines.push(`   ${t.event === 'men' ? 'M' : 'W'} ${ROUND_SHORT[t.r]}: ${recapName(draw, t.winner)} d. ${recapName(draw, loser)}`);
    });
    if (r64Missed.length > 15) lines.push(`   …and ${r64Missed.length - 15} more`);
    lines.push('');
  }

  lines.push(`🤝 We were all right on ${unanimousCount} matches.`);

  function renderOutlook(out) {
    if (!out) return;
    const ev = out.ev, draw = DRAWS[ev];
    const evLabel = ev === 'men' ? "Men's" : "Women's";
    const last = (slot) => draw[slot].name.split(' ').pop();
    const STAGE = { 6: 'title', 5: 'finalist' };
    // Only the split matches — the ones where it's family-vs-family.
    const splits = out.matches.filter(mm => mm.aP.length > 0 && mm.bP.length > 0);
    lines.push('');
    if (splits.length === 0) {
      lines.push(`👀 ${evLabel} ${out.label} — the family fully agrees this round.`);
      return;
    }
    lines.push(`👀 ${evLabel} ${out.label} — ones to watch (where we disagree)`);
    splits.forEach(mm => {
      const aFav = mm.aP.length >= mm.bP.length;
      const fav = aFav ? mm.a : mm.b, oth = aFav ? mm.b : mm.a;
      const favNames = aFav ? mm.aP : mm.bP, othNames = aFav ? mm.bP : mm.aP;
      const deep = [
        ...mm.aCarry.map(g => ({ ...g, slot: mm.a })),
        ...mm.bCarry.map(g => ({ ...g, slot: mm.b })),
      ].filter(g => STAGE[g.rank]).sort((x, y) => y.rank - x.rank)[0];
      const whoPoss = deep
        ? (deep.names.length > 2 ? `${deep.names.length} brackets'` : `${deep.names.join(' & ')}'s`)
        : '';
      const tag = deep ? ` · ${last(deep.slot)} is ${whoPoss} ${STAGE[deep.rank]}` : '';
      lines.push(`   • ${recapName(draw, fav)} vs ${recapName(draw, oth)} — ` +
        `${favNames.length} on ${last(fav)}, ${othNames.join(', ')} on ${last(oth)}${tag}`);
    });
  }
  renderOutlook(outMen);
  renderOutlook(outWomen);

  return lines.join('\n');
}

function advanceRecap() {
  if (!db) return;
  fb.setDoc(fb.doc(db, META_COLL, 'recap_snapshot'), {
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

// ===========================================================================
// END-OF-TOURNAMENT WRAP-UP RECAP
// ===========================================================================
// One big pure compute function so the HTML page and the copyable-text export
// stay consistent. Returns everything both renderers need.
function computeFinalRecap(entries) {
  const N = entries.length;
  const trueMC = state.results.men.r6[0];
  const trueWC = state.results.women.r6[0];

  function statsFor(e) {
    let mCorr=0, mPlay=0, wCorr=0, wPlay=0;
    let contrarian=0, lonely=0, upsets=0, withCrowd=0;
    const byRound = ROUND_SIZES.map(() => ({ c: 0, p: 0 }));
    const heartCandidates = [], standoutCandidates = [];

    for (const ev of ['men', 'women']) {
      const draw = DRAWS[ev], picks = e[ev], res = state.results[ev];
      for (let r = 0; r < 7; r++) for (let m = 0; m < ROUND_SIZES[r]; m++) {
        const w = res['r' + r][m]; if (w === null || w === undefined) continue;
        let a, b;
        if (r === 0) { a = 2*m; b = 2*m+1; }
        else { a = res['r'+(r-1)][2*m]; b = res['r'+(r-1)][2*m+1]; }
        if (a === null || b === null) continue;
        const p = picks['r'+r][m];
        if (p !== a && p !== b) continue; // dead pick
        if (ev === 'men') mPlay++; else wPlay++;
        byRound[r].p++;
        if (p === w) {
          if (ev === 'men') mCorr++; else wCorr++;
          byRound[r].c++;
          const others = entries.filter(o => o !== e).filter(o => o[ev]['r'+r][m] === w).length;
          if (others < (N-1)/2) contrarian++;
          if (others === 0) lonely++;
          if (others >= (N-1)/2) withCrowd++;
          const loser = w === a ? b : a;
          const ws = draw[w].seed || 99, ls = draw[loser].seed || 99;
          const upset = (ls !== 99 && (ws === 99 || ws > ls));
          if (upset) upsets++;
          const rarity = N - 1 - others;
          const sc = (r+1)*100 + rarity*15 + (upset ? 20 : 0);
          standoutCandidates.push({ ev, r, m, slot: w, rarity, upset, sc, key: `${ev}:${r}:${m}:${w}` });
        }
      }
    }

    // Heartbreak: each picked player who exited earlier than their deepest pick.
    // Dedup key is per-PLAYER so the same player doesn't show up across the field.
    const seen = new Set();
    for (const ev of ['men', 'women']) {
      const res = state.results[ev], picks = e[ev];
      for (let r = 0; r < 7; r++) for (let m = 0; m < ROUND_SIZES[r]; m++) {
        const c = picks['r'+r][m];
        if (c === null || c === undefined || seen.has(ev + ':' + c)) continue;
        seen.add(ev + ':' + c);
        const deep = deepestStage(e, ev, c);
        const exit = exitRound(c, res);
        if (exit === -1 || deep <= exit) continue;
        let lost = 0;
        for (let rr = exit; rr <= deep; rr++) lost += ROUND_POINTS[rr];
        heartCandidates.push({ ev, slot: c, deepestR: deep, exitR: exit, lostPts: lost, key: `${ev}:${c}` });
      }
    }
    heartCandidates.sort((a, b) => b.lostPts - a.lostPts);
    standoutCandidates.sort((a, b) => b.sc - a.sc);

    const sM = score(e.men, state.results.men).total;
    const sW = score(e.women, state.results.women).total;
    return {
      name: e.name, e,
      sM, sW, total: sM + sW,
      ceiling: bracketCeiling(e),
      mCorr, mPlay, wCorr, wPlay,
      mAcc: mPlay ? mCorr/mPlay : 0, wAcc: wPlay ? wCorr/wPlay : 0,
      correctTotal: mCorr + wCorr, playedTotal: mPlay + wPlay,
      accuracy: (mPlay + wPlay) ? (mCorr + wCorr) / (mPlay + wPlay) : 0,
      byRound, contrarian, lonely, upsets, withCrowd,
      heartCandidates, standoutCandidates,
      champM: e.men.r6[0], champW: e.women.r6[0],
    };
  }

  const stats = entries.map(statsFor).sort((a,b) => b.total - a.total);
  stats.forEach((s,i) => { s.rank = (i>0 && stats[i-1].total === s.total) ? stats[i-1].rank : i+1; });

  // Dedup standouts and heartbreaks across the field — top rank first, others fall to next-best distinct.
  const usedStand = new Set(), usedHeart = new Set();
  for (const s of stats) {
    s.standout = s.standoutCandidates.find(c => !usedStand.has(c.key)) || s.standoutCandidates[0] || null;
    if (s.standout) usedStand.add(s.standout.key);
    s.heartbreak = s.heartCandidates.find(c => !usedHeart.has(c.key)) || s.heartCandidates[0] || null;
    if (s.heartbreak) usedHeart.add(s.heartbreak.key);
  }

  // Champions
  const calledMChamp = (trueMC === null || trueMC === undefined) ? [] : stats.filter(s => s.champM === trueMC).map(s => s.name);
  const calledWChamp = (trueWC === null || trueWC === undefined) ? [] : stats.filter(s => s.champW === trueWC).map(s => s.name);
  const champions = {
    men: (trueMC === null || trueMC === undefined) ? null : { slot: trueMC, name: DRAWS.men[trueMC].name, callers: calledMChamp },
    women: (trueWC === null || trueWC === undefined) ? null : { slot: trueWC, name: DRAWS.women[trueWC].name, callers: calledWChamp },
  };

  // Family aggregate
  let famC = 0, famP = 0;
  const famByRound = ROUND_SIZES.map(() => ({ c: 0, p: 0 }));
  stats.forEach(s => {
    famC += s.correctTotal; famP += s.playedTotal;
    s.byRound.forEach((b, r) => { famByRound[r].c += b.c; famByRound[r].p += b.p; });
  });
  const famAcc = famByRound.map(b => b.p ? b.c/b.p : 0);

  // Awards — one per person, each unique.
  const awards = {};
  const remaining = () => stats.filter(s => !awards[s.name]);
  awards[stats[0].name] = { title: '🏆 Champion of the Pool', detail: `${stats[0].total} pts. Took the crown.` };
  { const r = remaining().slice().sort((a,b) => b.accuracy - a.accuracy)[0];
    if (r) awards[r.name] = { title: '🎯 The Oracle', detail: `Best accuracy at ${(r.accuracy*100).toFixed(1)}% — read the draws the cleanest.` }; }
  { const r = remaining().slice().sort((a,b) => b.mCorr - a.mCorr)[0];
    if (r) awards[r.name] = { title: "🎾 Men's Singles MVP", detail: `${r.mCorr} men's matches called — top of the field.` }; }
  { const r = remaining().slice().sort((a,b) => b.wCorr - a.wCorr)[0];
    if (r) awards[r.name] = { title: "🎀 Women's Singles MVP", detail: `${r.wCorr} women's matches called — top of the field.` }; }
  { const r = remaining().slice().sort((a,b) => b.contrarian - a.contrarian)[0];
    if (r && r.contrarian > 0) awards[r.name] = {
      title: '🃏 The Maverick',
      detail: `${r.contrarian} correct picks against the family consensus${r.lonely ? ` (${r.lonely} only-they-saw-it calls)` : ''}.`,
    }; }
  // Remaining people get a custom award: their best round-vs-family-avg gap, or Steady Hand fallback.
  for (const last of remaining()) {
    let bestR = -1, bestGap = -Infinity;
    last.byRound.forEach((b, r) => {
      if (!b.p) return;
      const gap = (b.c/b.p) - famAcc[r];
      if (gap > bestGap) { bestGap = gap; bestR = r; }
    });
    if (bestR >= 0 && bestGap > 0.001) {
      awards[last.name] = {
        title: `🧗 ${ROUND_SHORT[bestR]} Specialist`,
        detail: `Beat the family ${ROUND_SHORT[bestR]} hit rate by ${(bestGap*100).toFixed(0)} pts (${(last.byRound[bestR].c/last.byRound[bestR].p*100).toFixed(0)}% vs ${(famAcc[bestR]*100).toFixed(0)}% field).`,
      };
    } else {
      awards[last.name] = {
        title: '🧭 The Steady Hand',
        detail: `${last.total} pts at ${(last.accuracy*100).toFixed(1)}% accuracy — held the middle without big swings.`,
      };
    }
  }

  // Moments
  let bigUpset = null;
  for (const ev of ['men', 'women']) {
    const draw = DRAWS[ev], res = state.results[ev];
    for (let r = 0; r < 7; r++) for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const w = res['r'+r][m]; if (w === null || w === undefined) continue;
      let a, b; if (r === 0) { a = 2*m; b = 2*m+1; } else { a = res['r'+(r-1)][2*m]; b = res['r'+(r-1)][2*m+1]; }
      if (a === null || b === null) continue;
      const loser = w === a ? b : a;
      const ws = draw[w].seed || 99, ls = draw[loser].seed || 99;
      if (ls === 99) continue;
      const gap = (ws === 99 ? 33 - ls : ws - ls);
      if (gap <= 0) continue;
      // Raw seed gap (no round multiplier) — an early shocker like unseeded
      // over #1 in R64 ranks ahead of a smaller-gap upset in a later round.
      const sc = gap;
      if (!bigUpset || sc > bigUpset.sc) bigUpset = { ev, r, m, winner: w, loser, gap, sc };
    }
  }

  let divisive = null, divScore = -1;
  for (const ev of ['men', 'women']) {
    const res = state.results[ev];
    for (let r = 0; r < 7; r++) for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const w = res['r'+r][m]; if (w === null || w === undefined) continue;
      let a, b; if (r === 0) { a = 2*m; b = 2*m+1; } else { a = res['r'+(r-1)][2*m]; b = res['r'+(r-1)][2*m+1]; }
      if (a === null || b === null) continue;
      const aP = entries.filter(en => en[ev]['r'+r][m] === a).length;
      const bP = entries.filter(en => en[ev]['r'+r][m] === b).length;
      if (aP + bP < N) continue;
      const tightness = N - Math.abs(aP - bP);
      const sc = tightness * (r + 1) * 10;
      if (sc > divScore) { divScore = sc; divisive = { ev, r, m, a, b, aP, bP, winner: w }; }
    }
  }

  const champCount = { men: {}, women: {} };
  for (const e of entries) for (const ev of ['men', 'women']) {
    const c = e[ev].r6[0];
    if (c !== null && c !== undefined) champCount[ev][c] = (champCount[ev][c] || 0) + 1;
  }
  function topPick(ev) {
    const ents = Object.entries(champCount[ev]);
    if (!ents.length) return null;
    const [slot, n] = ents.sort((a,b) => b[1] - a[1])[0];
    return { slot: Number(slot), n, name: DRAWS[ev][slot].name };
  }
  const mostPickedMen = topPick('men'), mostPickedWomen = topPick('women');

  function exitCost(ev, slot) {
    let lost = 0;
    const res = state.results[ev];
    const ex = exitRound(slot, res);
    if (ex === -1) return null;
    for (const e of entries) {
      const deep = deepestStage(e, ev, slot);
      if (deep < ex) continue;
      for (let r = ex; r <= deep; r++) lost += ROUND_POINTS[r];
    }
    return { lost, exitR: ex, name: DRAWS[ev][slot].name };
  }
  const sinnerCost = (mostPickedMen && champions.men && mostPickedMen.slot !== champions.men.slot) ? exitCost('men', mostPickedMen.slot) : null;
  const sabaCost = (mostPickedWomen && champions.women && mostPickedWomen.slot !== champions.women.slot) ? exitCost('women', mostPickedWomen.slot) : null;

  // Unanimous (every entry's pick was for one of the actual contenders)
  const uniCorr = [], uniWrong = [];
  for (const ev of ['men', 'women']) {
    const res = state.results[ev];
    for (let r = 0; r < 7; r++) for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const w = res['r'+r][m]; if (w === null || w === undefined) continue;
      let a, b; if (r === 0) { a = 2*m; b = 2*m+1; } else { a = res['r'+(r-1)][2*m]; b = res['r'+(r-1)][2*m+1]; }
      if (a === null || b === null) continue;
      const aP = entries.filter(en => en[ev]['r'+r][m] === a).length;
      const bP = entries.filter(en => en[ev]['r'+r][m] === b).length;
      if (aP + bP < N) continue;
      if (aP === N) (w === a ? uniCorr : uniWrong).push({ ev, r, m, winner: w, loser: w === a ? b : a, pick: a });
      else if (bP === N) (w === b ? uniCorr : uniWrong).push({ ev, r, m, winner: w, loser: w === b ? a : b, pick: b });
    }
  }
  uniCorr.sort((a, b) => b.r - a.r);
  uniWrong.sort((a, b) => b.r - a.r);

  // Seeds at QF — R3 winners advance to QF (R4).
  function seedsAtQF(ev) {
    const res = state.results[ev], draw = DRAWS[ev];
    let seededIn = 0;
    for (let m = 0; m < ROUND_SIZES[3]; m++) {
      const w = res['r3'][m];
      if (w !== null && w !== undefined && draw[w].seed) seededIn++;
    }
    return { seededIn };
  }
  const seedM = seedsAtQF('men'), seedW = seedsAtQF('women');

  // Bios — assembled here once so HTML and text renderers stay aligned.
  function bioFor(s) {
    const a = awards[s.name];
    let tag = '';
    if (a.title.includes('Champion of the Pool')) tag = 'Played the contrarian title card and watched it pay all the way through.';
    else if (a.title.includes('Oracle')) tag = 'Highest pure accuracy in the family — just read the draw cleaner than anyone.';
    else if (a.title.includes("Men's Singles MVP")) tag = `Best men's bracket in the field with ${s.mCorr} correct calls.`;
    else if (a.title.includes("Women's Singles MVP")) tag = `Best women's bracket in the field with ${s.wCorr} correct calls.`;
    else if (a.title.includes('Maverick')) tag = `Made ${s.contrarian} correct calls the rest of the family didn't see — the most distinctive bracket in the pool.`;
    else tag = a.detail;

    const numbersLine = `${s.total.toLocaleString()} pts on ${s.correctTotal}/${s.playedTotal} live predictions = ${(s.accuracy*100).toFixed(1)}% accuracy. Men's ${s.mCorr}/${s.mPlay} · Women's ${s.wCorr}/${s.wPlay}.`;

    let callLine = '';
    if (s.standout) {
      const d = DRAWS[s.standout.ev];
      const stage = s.standout.r >= 3 ? ` (${ROUND_SHORT[s.standout.r]})` : '';
      if (s.standout.upset) callLine = `Called the upset of ${recapName(d, s.standout.slot)}${stage} when the seeds said otherwise.`;
      else if (s.standout.rarity >= N - 2) callLine = `Lone-wolf call: ${recapName(d, s.standout.slot)}${stage} — nobody else had it.`;
      else if (s.standout.rarity >= Math.ceil((N-1)/2)) callLine = `Contrarian read: ${recapName(d, s.standout.slot)}${stage} when the family was split the other way.`;
      else callLine = `Standout call: ${recapName(d, s.standout.slot)}${stage}.`;
    }
    let heartLine = '';
    if (s.heartbreak) {
      const d = DRAWS[s.heartbreak.ev];
      heartLine = `One that got away: had ${recapName(d, s.heartbreak.slot)} going to the ${REACHED[s.heartbreak.deepestR]}, fell in ${ROUND_SHORT[s.heartbreak.exitR]} (−${s.heartbreak.lostPts.toLocaleString()} max).`;
    }

    let zinger = '';
    if (a.title.includes('Champion of the Pool')) zinger = 'Holds the trophy until the next Slam.';
    else if (a.title.includes('Oracle')) zinger = "If only points scaled with accuracy, this'd be the trophy.";
    else if (a.title.includes("Men's Singles MVP")) zinger = "Imagine if the women's side had cooperated.";
    else if (a.title.includes("Women's Singles MVP")) zinger = 'Best WTA eye in the family — pure forecasting skill.';
    else if (a.title.includes('Maverick')) zinger = "The contrarian math eats well most Slams — this just wasn't the one.";
    else zinger = 'Rock-steady all fortnight — a solid bracket without the wild swings.';

    return { tag, numbersLine, callLine, heartLine, zinger };
  }

  const bios = {};
  stats.forEach(s => { bios[s.name] = bioFor(s); });

  // Per-round computed facts (used by the Round-by-Round section).
  const byRoundFacts = [];
  for (let r = 0; r < 7; r++) {
    // Biggest seed-gap upset of the round across both events.
    let upset = null;
    for (const ev of ['men', 'women']) {
      const draw = DRAWS[ev], res = state.results[ev];
      for (let m = 0; m < ROUND_SIZES[r]; m++) {
        const w = res['r'+r][m]; if (w === null || w === undefined) continue;
        let a, b;
        if (r === 0) { a = 2*m; b = 2*m+1; }
        else { a = res['r'+(r-1)][2*m]; b = res['r'+(r-1)][2*m+1]; }
        if (a === null || b === null) continue;
        const loser = w === a ? b : a;
        const ws = draw[w].seed || 99, ls = draw[loser].seed || 99;
        if (ls === 99) continue;
        const gap = (ws === 99 ? 33 - ls : ws - ls);
        if (gap <= 0) continue;
        if (!upset || gap > upset.gap) upset = { ev, winner: w, loser, gap };
      }
    }
    // Champion-pick exits at this round (with count of brackets affected).
    const champOut = [];
    for (const ev of ['men', 'women']) {
      const tally = {};
      for (const e of entries) {
        const c = e[ev].r6[0];
        if (c === null || c === undefined) continue;
        const ex = exitRound(c, state.results[ev]);
        if (ex !== r) continue;
        tally[c] = (tally[c] || 0) + 1;
      }
      for (const slot in tally) champOut.push({ ev, slot: Number(slot), count: tally[slot] });
    }
    champOut.sort((a, b) => b.count - a.count);
    const fam = famByRound[r];
    byRoundFacts.push({
      r, label: ROUND_SHORT[r],
      acc: fam.p ? fam.c/fam.p : 0, played: fam.p, correct: fam.c,
      upset, champOut,
    });
  }

  return {
    N, stats, awards, champions, bios,
    famC, famP, famByRound, famAcc,
    bigUpset, divisive, mostPickedMen, mostPickedWomen, sinnerCost, sabaCost,
    uniCorr, uniWrong, seedM, seedW,
    byRoundFacts,
  };
}

function recapView() {
  // The big tournament wrap-up is held back until the commissioner marks the
  // tournament complete. Until then this tab shows the day-by-day recap.
  if (!state.config.tournamentComplete) return dailyRecapView();

  const rawEntries = Object.values(state.entries).filter(e => e.name).map(e => ({
    id: e.id, name: e.name,
    men: normalizePicks(e.men), women: normalizePicks(e.women),
  }));
  if (rawEntries.length === 0) {
    return `<div class="panel"><h2>🏆 Tournament Wrap-Up</h2><p class="muted">No brackets to recap yet.</p></div>`;
  }
  if (!hasResults()) {
    return `<div class="panel"><h2>🏆 Tournament Wrap-Up</h2><p class="muted">No results entered yet — the wrap-up fills in as the tournament unfolds.</p></div>`;
  }
  return renderFinalRecapHTML(computeFinalRecap(rawEntries));
}

// The earliest round that still has an undecided match (across both draws) —
// i.e. the round currently being played.
function currentRoundIndex() {
  for (let r = 0; r < 7; r++) {
    for (const ev of ['men', 'women']) {
      const res = state.results[ev]['r' + r];
      for (let m = 0; m < ROUND_SIZES[r]; m++) {
        if (res[m] === null || res[m] === undefined) return r;
      }
    }
  }
  return 6;
}

// Marquee value of a slot: a lower seed = a bigger name. Unseeded = 0.
function slotBuzz(draw, slot) {
  if (slot === null || slot === undefined) return 0;
  const s = draw[slot] && draw[slot].seed;
  return s ? (33 - s) : 0;
}

// The two contenders of a match (fixed for R1, otherwise the prior round's winners).
function matchContenders(res, r, m) {
  if (r === 0) return [2 * m, 2 * m + 1];
  return [res['r' + (r - 1)][2 * m], res['r' + (r - 1)][2 * m + 1]];
}

// Today's scheduled matchups (from TODAY_MATCHES), resolved to bracket slots and
// annotated with whether they've been played yet. Skips any entry whose players
// don't actually meet in the current bracket (bad name / stale schedule).
function todaysMatches() {
  const out = [];
  for (const t of TODAY_MATCHES) {
    const draw = DRAWS[t.ev];
    const a = draw.findIndex(p => p && p.name === t.a);
    const b = draw.findIndex(p => p && p.name === t.b);
    if (a < 0 || b < 0) continue;
    // The round where the two slots share a match is where they'd meet.
    let r = -1;
    for (let rr = 0; rr < 7; rr++) if (matchOfSlot(a, rr) === matchOfSlot(b, rr)) { r = rr; break; }
    if (r < 0) continue;
    const m = matchOfSlot(a, r);
    const [ca, cb] = matchContenders(state.results[t.ev], r, m);
    if (!((ca === a && cb === b) || (ca === b && cb === a))) continue; // not both through yet
    const res = state.results[t.ev]['r' + r][m];
    out.push({ ev: t.ev, r, m, a, b, court: t.court, order: t.order, time: t.time,
      played: res !== null && res !== undefined });
  }
  return out;
}

// "A", "A & B", "A, B & C"
function nameList(arr) {
  if (arr.length <= 1) return arr[0] || '';
  if (arr.length === 2) return `${arr[0]} & ${arr[1]}`;
  return `${arr.slice(0, -1).join(', ')} & ${arr[arr.length - 1]}`;
}

// Seed numbers still alive in a draw (so the rest can be greyed as "out").
function aliveSeedSet(ev) {
  const draw = DRAWS[ev], res = state.results[ev], set = new Set();
  for (let slot = 0; slot < draw.length; slot++) {
    const p = draw[slot];
    if (p && p.seed && isAlive(slot, res)) set.add(p.seed);
  }
  return set;
}

// Seeded players already knocked out, with the round and who beat them.
function fallenSeeds(ev) {
  const draw = DRAWS[ev], res = state.results[ev], out = [];
  for (let r = 0; r < 7; r++) {
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const w = res['r' + r][m];
      if (w === null || w === undefined) continue;
      const [a, b] = matchContenders(res, r, m);
      if (a === null || a === undefined || b === null || b === undefined) continue;
      const loser = w === a ? b : a;
      const lp = draw[loser];
      if (lp && lp.seed) out.push({ seed: lp.seed, name: lp.name, r, m, by: draw[w].name });
    }
  }
  return out.sort((x, y) => x.seed - y.seed);
}

// Resolve RECAP_DAY_MATCHES (the day's order of play) to played matches with a
// winner: {event, r, m, winner, loser}. Skips any not yet played or not actually
// in the bracket, so the recap covers exactly that day's results.
function recapDayMatches() {
  const out = [];
  for (const t of RECAP_DAY_MATCHES) {
    const draw = DRAWS[t.ev];
    const a = draw.findIndex(p => p && p.name === t.a);
    const b = draw.findIndex(p => p && p.name === t.b);
    if (a < 0 || b < 0) continue;
    let r = -1;
    for (let rr = 0; rr < 7; rr++) if (matchOfSlot(a, rr) === matchOfSlot(b, rr)) { r = rr; break; }
    if (r < 0) continue;
    const m = matchOfSlot(a, r);
    const [ca, cb] = matchContenders(state.results[t.ev], r, m);
    if (!((ca === a && cb === b) || (ca === b && cb === a))) continue; // players don't actually meet here
    const w = state.results[t.ev]['r' + r][m];
    if (w === null || w === undefined) continue; // not played yet
    out.push({ event: t.ev, r, m, winner: w, loser: w === a ? b : a });
  }
  return out;
}

// ---- daily recap page (visible to everyone, refreshes as results come in) ----
// Same beats as the shareable text recap (generateRecapText), rendered as a page.
function dailyRecapView() {
  const { dateStr } = tournamentDay();
  let html = `<div class="daily-head">
    <div class="dh-day">Day ${TOURNAMENT_DAY} <span class="dh-sep">|</span> ${esc(ROUND_NAMES[TOURNAMENT_ROUND])}</div>
    <div class="dh-date">${esc(dateStr)}</div>
  </div>`;

  // The day's matches (from its order of play) drive everything below. "Before
  // today" = current results with those matches removed, so movement and points
  // gained reflect exactly this day — independent of any checkpoint.
  const dayMatches = recapDayMatches();
  const prevRes = { men: normalizePicks(state.results.men), women: normalizePicks(state.results.women) };
  for (const t of dayMatches) prevRes[t.event]['r' + t.r][t.m] = null;

  const totalPlayed = playedCount(state.results.men) + playedCount(state.results.women);
  const raw = Object.values(state.entries).filter(e => e.name).map(e => {
    const mp = normalizePicks(e.men), wp = normalizePicks(e.women);
    const sm = score(mp, state.results.men), sw = score(wp, state.results.women);
    const total = sm.total + sw.total;
    const prev = score(mp, prevRes.men).total + score(wp, prevRes.women).total;
    return { id: e.id, name: e.name, men: mp, women: wp, total, prev, today: total - prev, correct: sm.correct + sw.correct };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  if (raw.length === 0) {
    return html + `<div class="panel"><p class="muted">No brackets yet.</p></div>`;
  }

  // Today's matches = the day's order of play — shared by Leaders + Highlights.
  const snap = prevRes; // "before today" state, used for champion-down / movement
  const todayAll = dayMatches;
  const todayPoints = {}, todayCorrect = {};
  raw.forEach(e => { todayPoints[e.id] = 0; todayCorrect[e.id] = 0; });
  for (const t of todayAll) for (const e of raw) {
    if (e[t.event]['r' + t.r][t.m] === t.winner) { todayPoints[e.id] += ROUND_POINTS[t.r]; todayCorrect[e.id]++; }
  }

  // Leaders — all six on a 3-up grid. Ties share a rank/medal (standard "1-1-3"
  // competition ranking). Each card shows points gained + picks correct today.
  const ranks = raw.map(() => 0);
  raw.forEach((e, i) => { ranks[i] = (i > 0 && e.total === raw[i - 1].total) ? ranks[i - 1] : i + 1; });
  const prevSorted = raw.slice().sort((a, b) => b.prev - a.prev || a.name.localeCompare(b.name));
  const prevRank = {};
  prevSorted.forEach((e, i) => {
    prevRank[e.id] = (i > 0 && e.prev === prevSorted[i - 1].prev) ? prevRank[prevSorted[i - 1].id] : i + 1;
  });
  const medals = ['🥇', '🥈', '🥉'];
  const leaderCard = (e, i) => {
    const rank = ranks[i];
    const badge = rank <= 3 ? `<div class="dp-medal">${medals[rank - 1]}</div>` : `<div class="dp-rank">${rank}</div>`;
    const rankCls = rank === 1 ? ' first' : rank === 2 ? ' second' : rank === 3 ? ' third' : '';
    // Overall: total points + correct/total picks.
    const overall = totalPlayed > 0 ? `<div class="dp-tot">${e.correct}/${totalPlayed} correct</div>` : '';
    // Today: point change, correct/total today, and position change.
    let day = '';
    if (todayAll.length) {
      const delta = prevRank[e.id] - rank;
      const move = delta > 0 ? `<span class="up">▲${delta}</span>` : delta < 0 ? `<span class="down">▼${-delta}</span>` : `<span class="flat">–</span>`;
      day = `<div class="dp-day"><div class="dp-drow"><span class="dp-pp">+${todayPoints[e.id].toLocaleString()}</span> ${move}</div>
        <div class="dp-dsub">${todayCorrect[e.id]}/${todayAll.length} today</div></div>`;
    }
    return `<div class="dp-card${rankCls}">${badge}
      <div class="dp-name">${esc(e.name)}</div>
      <div class="dp-pts">${e.total.toLocaleString()}</div>${overall}${day}</div>`;
  };
  html += `<div class="panel"><h2>🏅 Leaders</h2><div class="day-podium">${raw.map((e, i) => leaderCard(e, i)).join('')}</div></div>`;

  // Daily highlights
  html += `<div class="panel"><h2>⚡ Daily Highlights</h2>`;
  if (!hasResults()) {
    html += `<p class="muted">The tournament hasn't started yet — daily highlights will appear here as results come in.</p>`;
  } else if (todayAll.length === 0) {
    html += `<p class="muted">No new results since the last update.</p>`;
  } else {
    const beat = (icon, label, val) => `<div class="dr-beat"><span class="dr-ic">${icon}</span><span class="dr-tx"><strong>${label}</strong> ${val}</span></div>`;

    // Most points today (with the leader's correct-pick count when it's one person).
    const maxToday = Math.max(0, ...raw.map(e => todayPoints[e.id]));
    if (maxToday > 0) {
      const top = raw.filter(e => todayPoints[e.id] === maxToday);
      const picks = top.length === 1 ? ` (${todayCorrect[top[0].id]}/${todayAll.length} correct)` : '';
      html += beat('📈', 'Most points today:', `${esc(nameList(top.map(e => e.name)))} +${maxToday.toLocaleString()}${picks}`);
    }
    // Mover of the day = biggest climb in the standings.
    const climb = {};
    raw.forEach((e, i) => { climb[e.id] = prevRank[e.id] - ranks[i]; });
    const maxClimb = Math.max(0, ...raw.map(e => climb[e.id]));
    if (maxClimb > 0) {
      const climbers = raw.filter(e => climb[e.id] === maxClimb).map(e => e.name);
      html += beat('🧗', 'Mover of the day:', `${esc(nameList(climbers))} — up ${maxClimb} ${maxClimb === 1 ? 'place' : 'places'}`);
    }
    // Upset of the day.
    const todayUpsets = todayAll.map(t => {
      const draw = DRAWS[t.event];
      const ws = draw[t.winner].seed || 99, ls = draw[t.loser].seed || 99;
      const gap = ls === 99 ? 0 : (ws === 99 ? (33 - ls) : (ws - ls));
      return { ...t, gap };
    }).filter(t => t.gap > 0).sort((a, b) => b.gap - a.gap);
    if (todayUpsets.length) {
      const top = todayUpsets[0], draw = DRAWS[top.event];
      const whoHad = raw.filter(e => e[top.event]['r' + top.r][top.m] === top.winner).map(e => e.name);
      const sawIt = whoHad.length === 0 ? 'nobody saw it coming'
        : whoHad.length === 1 ? `only ${whoHad[0]} had it` : `${whoHad.length} of you had it`;
      html += beat('😱', 'Upset of the day:', `${esc(recapName(draw, top.winner))} def. ${esc(recapName(draw, top.loser))} — ${esc(sawIt)}`);
    }
    // Champion picks knocked out today.
    const champLosses = [];
    for (const e of raw) {
      const mch = e.men.r6[0], wch = e.women.r6[0];
      if (mch !== null && isAlive(mch, snap.men) && !isAlive(mch, state.results.men)) champLosses.push(`${e.name} lost ${DRAWS.men[mch].name} (men's)`);
      if (wch !== null && isAlive(wch, snap.women) && !isAlive(wch, state.results.women)) champLosses.push(`${e.name} lost ${DRAWS.women[wch].name} (women's)`);
    }
    if (champLosses.length) html += beat('💀', 'Champion pick down:', esc(champLosses.join('; ')));

    // Family scorecard + unanimous calls (same "Winner def. Loser" format).
    const fam = familyStats(raw, todayAll);
    if (fam.total > 0) {
      const pct = Math.round(fam.correct / fam.total * 100);
      html += beat('📊', 'Family today:', `${pct}% (${fam.correct}/${fam.total})`);
      const N = raw.length;
      // Every card gets the same second line: how many brackets were live and
      // the win–loss tally among them — "Active in 6 brackets (6–0)" for a
      // unanimous nail, "(0–6)" for a unanimous miss, "(2–1)" for a split — so
      // all three groups read consistently.
      const bracketWord = (n) => n === 1 ? 'bracket' : 'brackets';
      const callLine = (u) => { const d = DRAWS[u.event];
        return `<span class="dl-main"><b>${esc(recapName(d, u.winner))}</b> <span class="dl-def">def.</span> ${esc(recapName(d, u.loser))}</span>`
          + `<span class="dl-active">Active in ${u.pickCount} ${bracketWord(u.pickCount)} (${u.winC}–${u.loseC})</span>`; };
      const defLine = callLine;
      const splitLine = callLine;
      const rows = (items, fn) => `<div class="dr-ul">${items.map(u => `<div class="dr-mrow">${fn(u)}</div>`).join('')}</div>`;
      // Three collapsible groups: everyone-with-a-live-pick nailed it, all missed,
      // and splits (with the family's pick count on each side).
      const group = (cls, icon, label, items, fn) => items.length
        ? `<details class="dr-grp ${cls}"><summary>${icon} ${label} (${items.length})</summary>${rows(items, fn)}</details>`
        : '';
      html += `<div class="dr-groups">`
        + group('right', '✅', 'We all nailed it', fam.unanimousCorrect, defLine)
        + group('wrong', '❌', 'We all missed', fam.unanimousWrong, defLine)
        + group('split', '⚖️', 'Splits', fam.splits, splitLine)
        + `</div>`;
    }
  }
  html += `</div>`;

  // Matches to watch — the next marquee matchups still to be played, each with a
  // one-line hook (a family member's title pick, or how the pool split on it).
  // Deepest round any picker has a player reaching (for the "advancing" detail).
  const deepestPick = (e, ev, slot) => {
    let d = -1;
    for (let rr = 0; rr < 7; rr++) if (e[ev]['r' + rr][matchOfSlot(slot, rr)] === slot) d = rr;
    return d;
  };
  const watchNote = (ev, r, m, a, b) => {
    const draw = DRAWS[ev];
    const champFans = (slot) => raw.filter(e => e[ev].r6[0] === slot).map(e => e.name);
    const ca = champFans(a), cb = champFans(b);
    if (ca.length || cb.length) {
      const parts = [];
      if (ca.length) parts.push(`${draw[a].name} is ${nameList(ca)}'s pick to win it all`);
      if (cb.length) parts.push(`${draw[b].name} is ${nameList(cb)}'s pick to win it all`);
      return parts.join('; ') + '.';
    }
    let pa = 0, pb = 0;
    for (const e of raw) { const p = e[ev]['r' + r][m]; if (p === a) pa++; else if (p === b) pb++; }
    const N = pa + pb;
    if (N === 0) return 'Nobody in the pool has a call on this one.';
    if (pa === 0 || pb === 0) {
      const fav = pa > 0 ? a : b;
      const pickers = raw.filter(e => e[ev]['r' + r][m] === fav);
      // deepestPick = the deepest round they've got `fav` WINNING; reaching the
      // next round (maxD+1). Only worth mentioning if that's beyond just winning
      // this match (maxD > r), otherwise it's the same as "advancing".
      const maxD = Math.max(...pickers.map(e => deepestPick(e, ev, fav)));
      const lead = N === 1 ? `1 bracket has` : `All ${N} brackets have`;
      if (maxD > r) {
        const farNames = pickers.filter(e => deepestPick(e, ev, fav) === maxD).map(e => e.name);
        const reach = maxD === 6 ? 'lifting the trophy' : `the ${ROUND_NAMES[maxD + 1]}`;
        if (N === 1) return `${lead} ${esc(draw[fav].name)} advancing — as far as ${reach}.`;
        const who = farNames.length === N ? `all ${N}` : `${farNames.length}`;
        const names = farNames.length === N ? '' : ` (${esc(nameList(farNames))})`;
        return `${lead} ${esc(draw[fav].name)} advancing — ${who} as far as ${reach}${names}.`;
      }
      return `${lead} ${esc(draw[fav].name)} advancing.`;
    }
    if (pa === pb) return `A pool coin-flip — split ${pa}–${pb}.`;
    return `The pool leans ${esc(draw[pa > pb ? a : b].name)} (${Math.max(pa, pb)}–${Math.min(pa, pb)}).`;
  };
  // Only today's scheduled matches, still to be played, in schedule order.
  const watch = todaysMatches().filter(w => !w.played);
  if (watch.length) {
    // Who benefits if a given player wins this match (and how far they had them).
    // `otherN` = how many brackets backed the opponent, so a no-backer side reads
    // "busts all N" only when the opponent truly had everyone.
    const sideImp = (ev, r, m, slot, otherN) => {
      const draw = DRAWS[ev];
      const backers = raw.filter(e => e[ev]['r' + r][m] === slot);
      if (!backers.length) return otherN === raw.length
        ? `busts all ${raw.length} brackets` : `no bracket picked ${esc(draw[slot].name)}`;
      const champs = backers.filter(e => e[ev].r6[0] === slot).map(e => e.name);
      const who = backers.length === raw.length ? `all ${raw.length} stay alive`
        : `${esc(nameList(backers.map(e => e.name)))} stay${backers.length === 1 ? 's' : ''} alive`;
      let tail = '';
      if (champs.length) tail = ` — ${esc(nameList(champs))} ${champs.length === 1 ? 'has' : 'have'} them winning it all`;
      else {
        const deepest = Math.max(...backers.map(e => deepestPick(e, ev, slot)));
        if (deepest > r) {
          const dn = backers.filter(e => deepestPick(e, ev, slot) === deepest).map(e => e.name);
          const reach = deepest === 6 ? 'the title' : deepest === 5 ? 'the final' : `the ${ROUND_NAMES[deepest + 1]}`;
          tail = ` — ${esc(nameList(dn))} ${dn.length === 1 ? 'has' : 'have'} them reaching ${reach}`;
        }
      }
      return `${who}${tail}`;
    };
    const meta = (w) => {
      const parts = [`<span class="w-rd">${w.ev === 'men' ? 'M' : 'W'} ${ROUND_SHORT[w.r]}</span>`];
      if (w.court) parts.push(`<span class="w-court">${esc(w.court)}</span>`);
      if (w.order) parts.push(`<span class="w-order">${esc(w.order)}</span>`);
      if (w.time) parts.push(`<span class="w-time">Approx. ${esc(w.time)}</span>`);
      return parts.join('<span class="w-sep">|</span>');
    };
    html += `<div class="panel"><h2>👀 Matches to Watch <span class="wl-date">${esc(WATCH_DATE)} · Times in BST</span></h2><div class="watch-list">`;
    watch.forEach(w => {
      const draw = DRAWS[w.ev];
      const nA = raw.filter(e => e[w.ev]['r' + w.r][w.m] === w.a).length;
      const nB = raw.filter(e => e[w.ev]['r' + w.r][w.m] === w.b).length;
      const imp = (nA === 0 && nB === 0)
        ? `<div class="wi-row wi-none">No one in the pool has a pick in this one — no impact on the standings.</div>`
        : `<div class="wi-row"><span class="wi-if">If ${esc(draw[w.a].name)} wins →</span> ${sideImp(w.ev, w.r, w.m, w.a, nB)}</div>
           <div class="wi-row"><span class="wi-if">If ${esc(draw[w.b].name)} wins →</span> ${sideImp(w.ev, w.r, w.m, w.b, nA)}</div>`;
      html += `<div class="watch-row wr-imp">
        <div class="w-ev">${meta(w)}</div>
        <div class="w-match">${flagImg(draw, w.a)}${esc(recapName(draw, w.a))} <span class="w-v">v</span> ${flagImg(draw, w.b)}${esc(recapName(draw, w.b))}</div>
        <div class="w-imp">${imp}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Seeds out today — only the seeds that fell in this day's matches.
  const fList = (items) => `<ul class="fs-list">${items.map(s =>
    `<li><span class="fs-seed">${s.seed}</span><span class="fs-name">${esc(s.name)}</span><span class="fs-by">lost to ${esc(s.by)}</span></li>`).join('')}</ul>`;
  const fColumn = (ev, lbl) => {
    const draw = DRAWS[ev];
    const fell = dayMatches.filter(t => t.event === ev)
      .map(t => ({ seed: draw[t.loser].seed, name: draw[t.loser].name, by: draw[t.winner].name }))
      .filter(x => x.seed).sort((a, b) => a.seed - b.seed);
    const body = fell.length ? fList(fell) : `<p class="muted small" style="margin:0">No seeds fell.</p>`;
    return `<div class="fallen-col"><div class="fc-head">${lbl}</div>${body}</div>`;
  };
  html += `<div class="panel"><h2>📉 Seeds Out Today</h2><div class="fallen2">
    ${fColumn('men', 'Men')}
    ${fColumn('women', 'Women')}
  </div></div>`;

  // Champions still alive
  html += `<div class="panel"><h2>🏆 Champions Still Alive</h2><div class="dr-champs">`;
  for (const [ev, lbl] of [['men', "Men's"], ['women', "Women's"]]) {
    const draw = DRAWS[ev], tally = {};
    for (const e of raw) {
      const c = e[ev].r6[0];
      if (c === null || !isAlive(c, state.results[ev])) continue;
      tally[draw[c].name] = (tally[draw[c].name] || 0) + 1;
    }
    const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    html += `<div class="dr-champ"><div class="dr-clbl">${lbl}</div><div class="dr-cval">${
      sorted.length === 0 ? `<span class="muted">nobody's champion still in 😱</span>`
        : sorted.map(([n, c]) => `${esc(n)} <span class="dr-cn">(${c})</span>`).join(', ')
    }</div></div>`;
  }
  html += `</div></div>`;
  return html;
}

// A compact, full-screen one-pager built for screenshotting / downloading on a
// phone: branding, standings (men/women split + picks correct + today's gain),
// and the day's two headline beats.
function shareCardView() {
  const { dateStr } = tournamentDay();
  const res = state.results;
  const prevRes = state.recapSnapshot
    ? { men: state.recapSnapshot.men, women: state.recapSnapshot.women }
    : { men: emptyPicks(), women: emptyPicks() };
  const played = playedCount(res.men) + playedCount(res.women);
  const raw = Object.values(state.entries).filter(e => e.name).map(e => {
    const mp = normalizePicks(e.men), wp = normalizePicks(e.women);
    const men = score(mp, res.men), women = score(wp, res.women);
    const total = men.total + women.total;
    const prev = score(mp, prevRes.men).total + score(wp, prevRes.women).total;
    return {
      id: e.id, name: e.name, total, today: total - prev,
      menPts: men.total, womenPts: women.total, correct: men.correct + women.correct,
    };
  }).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const ranks = raw.map(() => 0);
  raw.forEach((e, i) => { ranks[i] = (i > 0 && e.total === raw[i - 1].total) ? ranks[i - 1] : i + 1; });
  const medals = ['🥇', '🥈', '🥉'];

  let rows = '';
  raw.forEach((e, i) => {
    const badge = ranks[i] <= 3 ? medals[ranks[i] - 1] : `<span class="sc-rk">${ranks[i]}</span>`;
    const today = e.today > 0 ? `<span class="sc-td">+${e.today.toLocaleString()}</span>` : '';
    const sub = `M ${e.menPts.toLocaleString()} · W ${e.womenPts.toLocaleString()}`
      + (played > 0 ? ` · ${e.correct}/${played} correct` : '');
    rows += `<div class="sc-row${ranks[i] === 1 ? ' lead' : ''}">
      <span class="sc-badge">${badge}</span>
      <div class="sc-mid">
        <div class="sc-nl"><span class="sc-name">${esc(e.name)}</span>${today}</div>
        <div class="sc-sub">${sub}</div>
      </div>
      <span class="sc-pts">${e.total.toLocaleString()}</span>
    </div>`;
  });

  // Bottom beats: most points today + upset of the day.
  const beats = [];
  const maxToday = Math.max(0, ...raw.map(e => e.today));
  if (maxToday > 0) {
    const movers = raw.filter(e => e.today === maxToday).map(e => e.name);
    beats.push(`<div class="sc-beat">📈 <b>Most points today</b> — ${esc(nameList(movers))} (+${maxToday.toLocaleString()})</div>`);
  }
  const snap = state.recapSnapshot || { men: emptyPicks(), women: emptyPicks() };
  const todayAll = [...diffTodayMatches(res.men, snap.men, 'men'), ...diffTodayMatches(res.women, snap.women, 'women')];
  const upsets = todayAll.map(t => {
    const d = DRAWS[t.event];
    const ws = d[t.winner].seed || 99, ls = d[t.loser].seed || 99;
    return { ...t, gap: ls === 99 ? 0 : (ws === 99 ? (33 - ls) : (ws - ls)) };
  }).filter(t => t.gap > 0).sort((a, b) => b.gap - a.gap);
  if (upsets.length) {
    const u = upsets[0], d = DRAWS[u.event];
    beats.push(`<div class="sc-beat">😱 <b>Upset of the day</b> — ${esc(recapName(d, u.winner))} def. ${esc(recapName(d, u.loser))}</div>`);
  }

  return `<div class="share-wrap">
    <div class="sc-bar">
      <button class="sc-back" data-action="close-share">‹ Back</button>
      <button class="sc-dl" data-action="download-share">⬇ Download image</button>
    </div>
    <div class="share-card" data-action="pm-stop">
      <div class="sc-top">
        <div class="sc-emoji">🎾</div>
        <div class="sc-brand">Kiwi House Bracket</div>
        <div class="sc-meta">Day ${TOURNAMENT_DAY} · ${esc(ROUND_NAMES[TOURNAMENT_ROUND])} · ${esc(dateStr)}</div>
      </div>
      <div class="sc-standings">${rows}</div>
      ${beats.length ? `<div class="sc-beats">${beats.join('')}</div>` : ''}
    </div>
  </div>`;
}

// Render the share card to a PNG and download it (loads html2canvas on demand).
async function downloadShareCard() {
  const el = document.querySelector('.share-card');
  if (!el) return;
  try {
    const mod = await import('https://esm.sh/html2canvas@1.4.1');
    const html2canvas = mod.default || mod;
    // backgroundColor null => the area outside the card's rounded corners stays
    // transparent in the PNG (no white triangles).
    const canvas = await html2canvas(el, { scale: 2, backgroundColor: null, useCORS: true });
    const link = document.createElement('a');
    link.download = `kiwi-house-bracket-day-${TOURNAMENT_DAY}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  } catch (err) {
    alert('Could not build the image automatically — please screenshot the card instead.\n(' + err.message + ')');
  }
}

function renderFinalRecapHTML(rc) {
  const { stats, awards, champions, bios, famByRound, famC, famP, bigUpset, divisive,
    mostPickedMen, mostPickedWomen, sinnerCost, sabaCost, uniCorr, uniWrong, seedM, seedW } = rc;
  const stripIcon = (t) => t.replace(/^[^\w]+\s/, '');

  let html = `<div class="recap-page">`;
  html += `<div class="recap-hero">
    <h2>🏆 Tournament Wrap-Up</h2>
    <div class="sub">Wimbledon 2026 · the family vs the draw</div>
    <div class="actions"><button data-action="copy-final-recap">📋 Copy as text</button></div>
  </div>`;

  // Podium — DOM order is 1, 2, 3 so mobile (single column) reads top-to-bottom
  // gold → silver → bronze. CSS reorders the grid columns on desktop to put the
  // gold card in the middle for the Olympic-style 2-1-3 visual.
  const medals = ['🥇','🥈','🥉'];
  const top3 = stats.slice(0, 3);
  html += `<div class="panel"><h2>Podium</h2><div class="podium">`;
  top3.forEach((s, i) => {
    html += `<div class="podium-card place-${i+1} ${i === 0 ? 'first' : ''}">
      <div class="medal">${medals[i]}</div>
      <div class="name">${esc(s.name)}</div>
      <div class="pts">${s.total.toLocaleString()} pts</div>
      <div class="award">${esc(stripIcon(awards[s.name].title))}</div>
    </div>`;
  });
  html += `</div>`;
  if (stats.length > 3) {
    html += `<ul class="also-ran">`;
    stats.slice(3).forEach((s) => {
      html += `<li>
        <span class="rank">${s.rank}.</span>
        <span class="ar-name">${esc(s.name)}</span>
        <span class="ar-pts">${s.total.toLocaleString()} pts</span>
        <span class="ar-award" title="${esc(awards[s.name].title)}">${esc(stripIcon(awards[s.name].title))}</span>
      </li>`;
    });
    html += `</ul>`;
  }
  const last = stats.at(-1);
  html += `<p class="small muted" style="margin: 8px 0 0">${(stats[0].total - last.total).toLocaleString()} pts cover the field, 1st to last.</p>`;
  html += `</div>`;

  // Champions
  if (champions.men || champions.women) {
    html += `<div class="panel"><h2>👑 Wimbledon Champions</h2><div class="champ-row">`;
    [['men', "Men's"], ['women', "Women's"]].forEach(([k, lbl]) => {
      const c = champions[k]; if (!c) return;
      html += `<div class="champ-card">
        <div class="lbl">${lbl}</div>
        <div class="name">${esc(c.name)}</div>
        <div class="called ${c.callers.length ? '' : 'nobody'}">${c.callers.length
          ? `Called by <span class="who">${esc(c.callers.join(', '))}</span>`
          : 'Called by NOBODY 😬'}</div>
      </div>`;
    });
    html += `</div></div>`;
  }

  // Stories of the Tournament — a short, tournament-agnostic lead-in. The
  // blow-by-blow narrative lives in the data-driven Round-by-Round and
  // Champions panels below, so there are no hand-written storylines to keep
  // current from one event to the next.
  html += `<div class="panel"><h2>🌟 Stories of the Tournament</h2>`;
  html += `<div class="story-card">
    <p>Two weeks, 254 matches, one family bracket. Here's how Wimbledon 2026
    played out against everyone's picks — the upsets that wrecked brackets, the
    rounds the family nailed, and who ended up on the podium.</p>
  </div>`;
  html += `</div>`;

  // Round-by-Round
  html += `<div class="panel"><h2>🎬 Round-by-Round</h2>
    <p class="small muted" style="margin: 0 0 12px">The headline moment from each round of the draw.</p>`;
  rc.byRoundFacts.forEach(f => {
    let headline = '';
    if (f.r === 5 && f.played > 0 && f.acc === 1) {
      headline = `Family unanimity — every live SF pick was correct (${f.correct}/${f.played}). The brackets that survived to the semis all called the winner.`;
    } else if (f.upset) {
      const d = DRAWS[f.upset.ev];
      let line = `${recapName(d, f.upset.winner)} d. ${recapName(d, f.upset.loser)}`;
      if (f.champOut.length && f.champOut[0].count >= 2) {
        const co = f.champOut[0];
        const evLbl = co.ev === 'men' ? "men's" : "women's";
        line += ` — ${co.count} of ${rc.N} brackets lose their ${evLbl} champion.`;
      }
      headline = line;
    } else {
      headline = f.played ? `Family went ${f.correct}/${f.played} = ${Math.round(f.acc*100)}%.` : '(no data)';
    }
    const stat = f.played > 0
      ? `Family hit rate: ${f.correct}/${f.played} = ${Math.round(f.acc*100)}%`
      : '';
    html += `<div class="rbr-row">
      <div class="rbr-round">${f.label}</div>
      <div class="rbr-content">
        <div class="rbr-headline">${esc(headline)}</div>
        ${stat ? `<div class="rbr-stat">${esc(stat)}</div>` : ''}
      </div>
    </div>`;
  });

  html += `</div>`;

  // Unanimous (latest rounds first; expandable "show all")
  const uniRightLi = (t) => {
    const d = DRAWS[t.ev];
    return `<li>${t.ev === 'men' ? 'M' : 'W'} ${ROUND_SHORT[t.r]}: ${esc(recapName(d, t.winner))} d. ${esc(recapName(d, t.loser))}</li>`;
  };
  const uniWrongLi = (t) => {
    const d = DRAWS[t.ev];
    return `<li>${t.ev === 'men' ? 'M' : 'W'} ${ROUND_SHORT[t.r]}: had ${esc(recapName(d, t.pick))} — actually ${esc(recapName(d, t.winner))}</li>`;
  };
  html += `<div class="panel"><h2>🤝 Unanimous Picks</h2><div class="unanimous-grid">`;
  html += `<div class="uni-side right">
    <h3>We were ALL right</h3>
    <div class="count">${uniCorr.length}</div>
    ${uniCorr.length ? `<details class="uni-details">
      <summary>Show all ${uniCorr.length} matches</summary>
      <ul class="uni-all">${uniCorr.map(uniRightLi).join('')}</ul>
    </details>` : ''}
  </div>`;
  html += `<div class="uni-side wrong">
    <h3>We were ALL wrong</h3>
    <div class="count">${uniWrong.length}</div>
    ${uniWrong.length ? `<details class="uni-details">
      <summary>Show all ${uniWrong.length} matches</summary>
      <ul class="uni-all">${uniWrong.map(uniWrongLi).join('')}</ul>
    </details>` : ''}
  </div>`;
  html += `</div></div>`;

  // The People — bios with award embedded
  html += `<div class="panel"><h2>✨ The People</h2>`;
  const ord = ['1st','2nd','3rd','4th','5th','6th','7th'];
  stats.forEach(s => {
    const b = bios[s.name];
    const a = awards[s.name];
    html += `<div class="bio-card ${s.rank === 1 ? 'first' : ''}">
      <div class="bio-head">
        <div>
          <span class="bio-name">${esc(s.name)}</span>
          <span class="bio-rank"> — ${ord[s.rank-1] || (s.rank + 'th')}, ${s.total.toLocaleString()} pts</span>
        </div>
        <span class="bio-award">${esc(a.title)}</span>
      </div>
      <div class="bio-tag">${esc(b.tag)}</div>
      <div class="bio-numbers">${esc(b.numbersLine)}</div>
      ${b.callLine ? `<div class="bio-call">${esc(b.callLine)}</div>` : ''}
      ${b.heartLine ? `<div class="bio-heart">${esc(b.heartLine)}</div>` : ''}
      <div class="bio-zinger">${esc(b.zinger)}</div>
    </div>`;
  });
  html += `</div>`;

  html += `</div>`;
  return html;
}

function generateFinalRecapText() {
  const rawEntries = Object.values(state.entries).filter(e => e.name).map(e => ({
    id: e.id, name: e.name,
    men: normalizePicks(e.men), women: normalizePicks(e.women),
  }));
  if (rawEntries.length === 0 || !hasResults()) return 'No tournament results yet.';

  const rc = computeFinalRecap(rawEntries);
  const { stats, awards, champions, bios, famByRound, famC, famP,
    bigUpset, divisive, mostPickedMen, mostPickedWomen, sinnerCost, sabaCost,
    uniCorr, uniWrong, seedM, seedW } = rc;
  const L = [];
  L.push('🏆 KIWI HOUSE BRACKET — TOURNAMENT WRAP-UP');
  L.push('Wimbledon 2026');
  L.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  L.push('');
  L.push('🥇 PODIUM');
  const medals = ['🥇','🥈','🥉'];
  stats.slice(0, 3).forEach((s, i) => L.push(`   ${medals[i]} ${s.name.padEnd(8)} ${String(s.total).padStart(4)} pts`));
  stats.slice(3).forEach(s => L.push(`   ${s.rank}. ${s.name.padEnd(8)} ${String(s.total).padStart(4)} pts`));
  L.push(`   Spread: ${stats[0].total - stats.at(-1).total} pts between 1st and last.`);
  L.push('');
  L.push('👑 WIMBLEDON CHAMPIONS');
  if (champions.men) L.push(`   Men's:   ${champions.men.name} — called by ${champions.men.callers.length ? champions.men.callers.join(', ') : 'NOBODY 😬'}`);
  if (champions.women) L.push(`   Women's: ${champions.women.name} — called by ${champions.women.callers.length ? champions.women.callers.join(', ') : 'NOBODY 😬'}`);
  L.push('');
  L.push('🌟 STORIES OF THE TOURNAMENT');
  L.push('   Two weeks, 254 matches, one family bracket. The upsets, the rounds the');
  L.push('   family nailed, and the final podium — all from your picks vs. the draw.');
  L.push('');
  L.push('🎬 ROUND-BY-ROUND');
  rc.byRoundFacts.forEach(f => {
    let head = '';
    if (f.r === 5 && f.played > 0 && f.acc === 1) head = `Family unanimity — every live SF pick correct (${f.correct}/${f.played}). The brackets that survived to the semis all called the winner.`;
    else if (f.upset) {
      const d = DRAWS[f.upset.ev];
      head = `${recapName(d, f.upset.winner)} d. ${recapName(d, f.upset.loser)}`;
      if (f.champOut.length && f.champOut[0].count >= 2) {
        const co = f.champOut[0]; const evLbl = co.ev === 'men' ? "men's" : "women's";
        head += ` — ${co.count}/${rc.N} brackets lose their ${evLbl} champion.`;
      }
    } else head = f.played ? `Family went ${f.correct}/${f.played} = ${Math.round(f.acc*100)}%.` : '';
    L.push(`   ${f.label.padEnd(6)} ${head}`);
    if (f.played > 0) L.push(`          (Family hit rate: ${f.correct}/${f.played} = ${Math.round(f.acc*100)}%)`);
  });
  L.push('');
  L.push('🤝 UNANIMOUS PICKS');
  if (uniCorr.length) {
    L.push(`   We were ALL right on ${uniCorr.length} matches (full list in the app).`);
  }
  if (uniWrong.length) {
    L.push(`   We were ALL wrong on ${uniWrong.length} matches (full list in the app).`);
  }
  L.push('');
  L.push('🏅 EVERYONE GETS A TROPHY');
  stats.forEach(s => { const a = awards[s.name]; L.push(`   ${a.title} — ${s.name}`); L.push(`      ${a.detail}`); });
  L.push('');
  L.push('✨ THE PEOPLE');
  const ord = ['1st','2nd','3rd','4th','5th','6th','7th'];
  stats.forEach(s => {
    const b = bios[s.name];
    L.push(`${s.name} — ${ord[s.rank-1] || (s.rank+'th')}, ${s.total} pts  ·  ${awards[s.name].title}`);
    if (b.tag) L.push(`   ${b.tag}`);
    L.push(`   ${b.numbersLine}`);
    if (b.callLine) L.push(`   👍 ${b.callLine}`);
    if (b.heartLine) L.push(`   💔 ${b.heartLine}`);
    L.push(`   ${b.zinger}`);
    L.push('');
  });
  return L.join('\n');
}

async function copyFinalRecap() {
  const text = generateFinalRecapText();
  try {
    await navigator.clipboard.writeText(text);
    alert('Tournament wrap-up copied to clipboard!');
  } catch (e) {
    alert("Couldn't auto-copy — try selecting the text manually.");
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
  </div>`;
  // Publish toggle — until this is on, everyone sees the Daily Recap page and the
  // full wrap-up stays hidden.
  const published = state.config.tournamentComplete;
  html += `<div class="publish-row">
    <p class="small ${published ? '' : 'muted'}" style="margin:0">
      ${published
        ? '✅ The full tournament wrap-up is <strong>published</strong> — everyone sees it on the Daily Recap tab.'
        : '⏳ The wrap-up is <strong>pending</strong> — the family sees the Daily Recap until you publish.'}
    </p>
    <button class="btn ${published ? 'ghost' : ''}" data-action="toggle-final-recap">
      ${published ? 'Unpublish (back to daily)' : 'Publish final wrap-up'}
    </button>
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

// Small country flag for a player slot. Returns safe HTML (an <img> from the
// flagcdn CDN, which renders consistently across devices) or '' when the slot
// has no known country. The ISO code comes from our own draws data, but we
// still whitelist it to [a-z]{2} so this is always safe to insert unescaped.
function flagImg(draw, slot) {
  if (slot === null || slot === undefined) return '';
  const p = draw[slot];
  const cc = p && typeof p.country === 'string' ? p.country.toLowerCase() : '';
  if (!/^[a-z]{2}$/.test(cc)) return '';
  return `<img class="flag" src="https://flagcdn.com/20x15/${cc}.png" ` +
    `srcset="https://flagcdn.com/40x30/${cc}.png 2x" width="20" height="15" ` +
    `alt="${cc.toUpperCase()}" loading="lazy" decoding="async">`;
}

// Projection "strength" of a draw slot: lower = stronger. Seeds rank ahead of
// everyone (by seed number); unseeded players are ordered by current ranking.
function slotStrength(p) {
  if (!p) return 1e9;
  return p.seed != null ? p.seed : 1000 + (typeof p.rank === 'number' ? p.rank : 9999);
}

// The projected path "to the title" for a player: the opponent they'd be
// expected to meet in each round (R128 → Final) if the stronger seed/ranking
// wins every match. Returns 7 opponent slot indices.
function projectedPath(ev, slot) {
  const draw = DRAWS[ev];
  const path = [];
  for (let r = 0; r < 7; r++) {
    const blockSize = 1 << r;                                  // R128 slots per sub-bracket this round
    const sibStart = ((Math.floor(slot / blockSize)) ^ 1) * blockSize; // the opposing sub-bracket
    let best = sibStart, bestStr = slotStrength(draw[sibStart]);
    for (let i = sibStart + 1; i < sibStart + blockSize; i++) {
      const s = slotStrength(draw[i]);
      if (s < bestStr) { bestStr = s; best = i; }
    }
    path.push(best);
  }
  return path;
}

// The stage a slot reaches by WINNING its round-r match (R128 win → into R64).
const REACHED_STAGE = ['R64', 'R32', 'R16', 'QF', 'SF', 'Final', 'Champion'];

// Which family members picked this player, and how far. Returns entrants who
// picked the player to win at least their opening match, with the deepest stage
// they backed them to. Only meaningful once brackets are locked.
function pickedBy(ev, slot) {
  const out = [];
  for (const e of Object.values(state.entries)) {
    if (!e.name) continue;
    const picks = normalizePicks(e[ev]);
    let deepest = -1;
    for (let r = 0; r < 7; r++) {
      if (picks['r' + r][matchOfSlot(slot, r)] === slot) deepest = r;
    }
    if (deepest >= 0) out.push({ name: e.name, stage: REACHED_STAGE[deepest], r: deepest });
  }
  return out.sort((a, b) => b.r - a.r || a.name.localeCompare(b.name));
}

// Player info card shown when the ⓘ next to a player is tapped. Reads the extra
// fields (rank / high / dob / plays / titles / slam bests) from the draw; any
// that are missing show as "—". Men are on the ATP tour, women on the WTA tour.
// The projected path is computed live from the draw seeding.
function playerModalHTML() {
  if (!state.playerModal) return '';
  const { ev, slot, pair } = state.playerModal;
  const draw = DRAWS[ev];
  const p = draw && draw[slot];
  if (!p) return '';
  // If opened from a matchup, show a toggle between the two players. The pair is
  // in a fixed order, so flipping only moves the highlight — names never swap.
  const hasPair = pair && pair.length === 2 && pair[0] !== pair[1] && draw[pair[0]] && draw[pair[1]];
  const switcher = hasPair ? `<div class="pm-switch">
    ${pair.map(s => `<button class="pm-sw${s === slot ? ' active' : ''}"`
      + (s === slot ? '' : ` data-action="info" data-ev="${ev}" data-slot="${s}" data-pair="${pair[0]},${pair[1]}"`)
      + `>${flagImg(draw, s)}<span>${esc(draw[s].name)}</span></button>`).join('')}
  </div>` : '';
  const tour = ev === 'men' ? 'ATP' : 'WTA';
  const age = ageFromDob(p.dob);
  const cc = (p.country || '').toLowerCase();
  const fmtRank = (v) => (typeof v === 'number' ? `#${v}` : '—');
  const plays = p.plays === 'L' ? 'Left-handed' : p.plays === 'R' ? 'Right-handed' : '—';
  const row = (lbl, val) => `<div class="pm-row"><span class="pm-lbl">${lbl}</span><span class="pm-val">${val}</span></div>`;
  // "W 2024, 2025" → "W (2024, 2025)"
  const slamRow = (lbl, v) => {
    let disp = '—';
    if (v) { const m = String(v).match(/^(\S+)\s+(.+)$/); disp = m ? `${m[1]} (${m[2]})` : v; }
    return `<div class="pm-srow"><span class="pm-slbl">${lbl}</span><span class="pm-sval">${esc(disp)}</span></div>`;
  };
  const backers = state.config.locked ? pickedBy(ev, slot) : null;
  return `<div class="pm-backdrop" data-action="close-player">
    <div class="pm-card" role="dialog" aria-modal="true" data-action="pm-stop">
      <button class="pm-close" data-action="close-player" aria-label="Close">×</button>
      ${switcher}
      <div class="pm-head">
        ${flagImg(draw, slot)}
        <div>
          <div class="pm-name">${esc(p.name)}</div>
          ${p.seed ? `<div class="pm-seed">Seed ${p.seed}</div>` : `<div class="pm-seed unseeded">Unseeded</div>`}
        </div>
      </div>
      ${row('Country', esc(countryName(cc)) || '—')}
      ${row('Age', age != null ? age : '—')}
      ${row('Plays', plays)}
      ${row(`Current ${tour} ranking`, fmtRank(p.rank))}
      ${row(`Career-high ${tour} ranking`, fmtRank(p.high))}
      ${row(`${tour} singles titles`, typeof p.titles === 'number' ? p.titles : '—')}

      <div class="pm-sub">Best result at the slams</div>
      <div class="pm-slams">
        ${slamRow('Australian Open', p.ao)}
        ${slamRow('French Open', p.rg)}
        ${slamRow('Wimbledon', p.wim)}
        ${slamRow('US Open', p.uso)}
      </div>

      ${backers ? `<div class="pm-sub">Picked by your pool</div>
      ${backers.length ? `<div class="pm-slams">${backers.map(b =>
        `<div class="pm-srow"><span class="pm-slbl">${esc(b.name)}</span><span class="pm-sval">${b.stage}</span></div>`
      ).join('')}</div>` : `<p class="pm-empty">Nobody in the pool picked them to win a match.</p>`}` : ''}

      <div class="pm-sub">Projected path to the title <span class="pm-note2">(if the seeds hold)</span></div>
      <ol class="pm-path">
        ${projectedPath(ev, slot).map((opp, r) =>
          `<li><span class="pm-pr">${ROUND_SHORT[r]}</span>${flagImg(draw, opp)}<span class="pm-pname">${esc(label(draw, opp))}</span></li>`
        ).join('')}
      </ol>
    </div>
  </div>`;
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

  fb.onSnapshot(fb.collection(db, ENTRIES_COLL), snap => {
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

  fb.onSnapshot(fb.doc(db, META_COLL, 'results'), d => {
    const data = d.exists() ? d.data() : {};
    state.results = {
      men: normalizePicks(data.men),
      women: normalizePicks(data.women),
    };
    render();
  });

  fb.onSnapshot(fb.doc(db, META_COLL, 'config'), d => {
    const c = d.exists() ? d.data() : {};
    state.config = { locked: !!c.locked, tournamentComplete: !!c.tournamentComplete };
    render();
  });

  fb.onSnapshot(fb.doc(db, META_COLL, 'recap_snapshot'), d => {
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
    fb.setDoc(fb.doc(db, ENTRIES_COLL, state.userId), {
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
    fb.setDoc(fb.doc(db, META_COLL, 'results'), {
      men: state.results.men,
      women: state.results.women,
      updatedAt: Date.now(),
    }).catch(err => alert('Could not save results: ' + err.message));
  }, 500);
}

function setLocked(locked) {
  if (!db) return;
  fb.setDoc(fb.doc(db, META_COLL, 'config'), { locked }, { merge: true })
    .catch(err => alert('Could not update lock: ' + err.message));
}

function setTournamentComplete(tournamentComplete) {
  if (!db) return;
  fb.setDoc(fb.doc(db, META_COLL, 'config'), { tournamentComplete }, { merge: true })
    .catch(err => alert('Could not update wrap-up status: ' + err.message));
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
  history.replaceState(null, '', '#bracket');
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

  // The shareable one-pager takes over the whole screen (no header/tabs) so it's
  // clean to screenshot.
  if (state.shareCard) { appEl.innerHTML = shareCardView(); return; }

  let body;
  if (state.viewingEntryId) body = entryView();
  else if (state.view === 'draw') body = drawView();
  else if (state.view === 'leaderboard') body = leaderboardView();
  else if (state.view === 'recap') body = recapView();
  else if (state.view === 'commissioner') body = commissionerView();
  else if (state.view === 'archive') body = archiveView();
  else body = bracketView();

  appEl.innerHTML = header() + body + footer() + playerModalHTML();

  // After a swipe commits, slide the freshly-rendered round in from the
  // direction the next round is "coming from" so the change feels continuous.
  if (state._slideIn) {
    const from = state._slideIn === 'right' ? 100 : -100;
    state._slideIn = null;
    const pane = appEl.querySelector('.round-pane');
    if (pane) {
      pane.style.transition = 'none';
      pane.style.transform = `translateX(${from}%)`;
      pane.style.opacity = '0.4';
      requestAnimationFrame(() => requestAnimationFrame(() => {
        pane.style.transition = 'transform .2s ease-out, opacity .2s ease-out';
        pane.style.transform = 'translateX(0)';
        pane.style.opacity = '1';
      }));
    }
  }
}

function header() {
  const tab = (v, lbl) =>
    `<button class="${state.view === v && !state.viewingEntryId ? 'active' : ''}" data-action="nav" data-view="${v}">${lbl}</button>`;
  return `
    <header class="app-head">
      <div class="brand">
        <h1 class="title">Kiwi House Family Bracket Challenge</h1>
        <div class="subtitle">Wimbledon 2026</div>
        <div class="reign">👑 Reigning champion of the court: Michael</div>
      </div>
      <div class="whoami">Playing as <strong>${esc(state.userName)}</strong>
        · <a data-action="new-bracket">not you?</a></div>
      <nav class="tabs">
        ${tab('bracket', 'My Bracket')}
        ${tab('draw', '🎾 Draw')}
        ${tab('leaderboard', 'Leaderboard')}
        ${tab('recap', '📰 Daily Recap')}
        ${tab('commissioner', 'Commissioner')}
        ${tab('archive', 'Past Tournaments')}
      </nav>
    </header>`;
}

// Past tournaments — links out to each finished tournament's read-only archive.
function archiveView() {
  return `<div class="panel"><h2>Past Tournaments</h2>
    <p class="muted small">Browse the recap and every family member's bracket from past tournaments.</p>
    <a class="archive-card" href="/rg2026/">
      <span class="ac-emoji">🎾</span>
      <span class="ac-body">
        <span class="ac-title">Roland Garros 2026</span>
        <span class="ac-sub">French Open · recap &amp; brackets</span>
      </span>
      <span class="ac-go">→</span>
    </a>
  </div>`;
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
  }).join('')}</div>
  <div class="swipe-hint">‹ swipe to change round ›</div>`;
}

// ---- a single match's two option buttons ----
// `event` is the draw key ('men'/'women') so the ⓘ info button can open the
// right player. The ⓘ is a SEPARATE button (sibling of the pick button) so it
// still works when the pick button is disabled (locked / results view).
function optBtn(draw, slot, r, m, picked, action, results, event, pair) {
  const isPicked = picked !== null && picked === slot;
  const hasPlayer = slot !== null && slot !== undefined;
  const disabled = !hasPlayer || !action;
  let cls = 'opt';
  if (isPicked) cls += ' picked';
  if (results && isPicked) {
    const res = results['r' + r][m];
    if (res !== null && res !== undefined) {
      cls = 'opt ' + (picked === res ? 'correct' : 'wrong');
    }
  }
  const btn = `<button class="${cls}" ${disabled ? 'disabled' : ''}`
    + (action ? ` data-action="${action}" data-r="${r}" data-m="${m}" data-slot="${slot}"` : '')
    + `>${flagImg(draw, slot)}<span class="opt-name">${esc(label(draw, slot))}</span></button>`;
  // Carry both players of this matchup (in fixed order) so the info card can
  // offer a toggle between them without the names ever swapping positions.
  const pairAttr = pair ? ` data-pair="${pair[0]},${pair[1]}"` : '';
  const info = hasPlayer
    ? `<button class="info-dot" data-action="info" data-ev="${event}" data-slot="${slot}"${pairAttr} aria-label="Player info" title="Player info">i</button>`
    : '';
  return `<div class="optwrap">${btn}${info}</div>`;
}

// ---- the match list for one round ----
function matchList(picks, event, r, action, results) {
  const draw = DRAWS[event];
  let html = '<div class="matches">';
  for (let m = 0; m < ROUND_SIZES[r]; m++) {
    const c = contenders(picks, r, m);
    const picked = picks['r' + r][m];
    html += `<div class="match"><span class="mno">${m + 1}</span>`
      + optBtn(draw, c[0], r, m, picked, action, results, event)
      + `<span class="vs">v</span>`
      + optBtn(draw, c[1], r, m, picked, action, results, event)
      + `</div>`;
  }
  return html + '</div>';
}

// ---- connected "flow" bracket: current round → next round ----
// Both desktop and phones get a connected layout where each round's matches
// feed (via bracket braces) into the next round's slots. CSS sizes it
// comfortably on desktop and compactly on phones.
function isMobileFlow() {
  return typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(max-width: 600px)').matches;
}
function matchArea(picks, event, r, action, results) {
  return `<div class="round-pane">${flowList(picks, event, r, action, results)}</div>`;
}
// One current-round match: the two pickable options.
function flowMatch(picks, draw, event, r, m, action, results) {
  const c = contenders(picks, r, m);
  const picked = picks['r' + r][m];
  // Both options share the same fixed-order pair so the info-card toggle keeps
  // the two players in stable positions.
  const pair = (c[0] !== null && c[0] !== undefined && c[1] !== null && c[1] !== undefined) ? [c[0], c[1]] : null;
  return `<div class="match">`
    + optBtn(draw, c[0], r, m, picked, action, results, event, pair)
    + `<span class="vs">VS</span>`
    + optBtn(draw, c[1], r, m, picked, action, results, event, pair)
    + `</div>`;
}
// Read-only preview of a next-round match (the two winners that flow in).
function flowNext(picks, draw, r, m) {
  const c = contenders(picks, r, m);
  const cell = (slot) => slot === null || slot === undefined
    ? `<div class="fn-p tbd">TBD</div>`
    : `<div class="fn-p">${flagImg(draw, slot)}<span class="fn-name">${esc(label(draw, slot))}</span></div>`;
  return `<div class="flow-next">${cell(c[0])}${cell(c[1])}</div>`;
}
function flowList(picks, event, r, action, results) {
  const draw = DRAWS[event];
  // Final round → a single match flowing into the champion node.
  if (r === 6) {
    const champ = picks.r6[0];
    return `<div class="flow"><div class="flowgroup final">
      <div class="cur">${flowMatch(picks, draw, event, 6, 0, action, results)}</div>
      <div class="brace"></div>
      <div class="nxt"><div class="champ-node">🏆<div class="cn-name">${champ != null ? esc(label(draw, champ)) : 'Champion'}</div></div></div>
    </div></div>`;
  }
  let html = `<div class="flow-heads"><span>${ROUND_NAMES[r]}</span><span>${ROUND_NAMES[r + 1]}</span></div><div class="flow">`;
  for (let g = 0; g < ROUND_SIZES[r + 1]; g++) {
    html += `<div class="flowgroup">
      <div class="cur">
        ${flowMatch(picks, draw, event, r, 2 * g, action, results)}
        ${flowMatch(picks, draw, event, r, 2 * g + 1, action, results)}
      </div>
      <div class="brace"></div>
      <div class="nxt">${flowNext(picks, draw, r + 1, g)}</div>
    </div>`;
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

  html += matchArea(picks, state.event, state.round,
    locked ? null : 'pick', showResults ? state.results[state.event] : null);

  if (state.round === 6) {
    const champ = picks.r6[0];
    html += `<div class="champion-box"><div class="lbl">Your champion pick</div>
      <div class="name${champ !== null ? ' clickable' : ''}"${champ !== null ? ` data-action="info" data-ev="${state.event}" data-slot="${champ}"` : ''}>${champ !== null ? flagImg(DRAWS[state.event], champ) + esc(label(DRAWS[state.event], champ)) : '— not picked —'}</div></div>`;
  }
  html += '</div>';
  return html;
}

// Brute-force each bracket's path to finishing #1 from the current results.
// Returns per-entry canWin + the conditions forced in EVERY outcome where they
// end at least tied for 1st. Guards against combinatorial blow-up early on.
function pathToFirst() {
  const ents = Object.values(state.entries).filter(e => e.name)
    .map(e => ({ id: e.id, name: e.name, men: normalizePicks(e.men), women: normalizePicks(e.women) }));
  if (ents.length < 2) return null;
  const bank = {};
  ents.forEach(e => bank[e.id] = score(e.men, state.results.men).total + score(e.women, state.results.women).total);
  const enumerate = (ev) => {
    const work = {}; for (let r = 0; r < 7; r++) work['r' + r] = state.results[ev]['r' + r].slice();
    const u = [];
    for (let r = 3; r < 7; r++) for (let m = 0; m < ROUND_SIZES[r]; m++)
      if (work['r' + r][m] === null || work['r' + r][m] === undefined) u.push([r, m]);
    const out = [];
    const rec = (i) => {
      if (i === u.length) { out.push(u.map(([r, m]) => work['r' + r][m])); return; }
      const [r, m] = u[i];
      const a = work['r' + (r - 1)][2 * m], b = work['r' + (r - 1)][2 * m + 1];
      const opts = (a === null || a === undefined || b === null || b === undefined) ? [] : [a, b];
      for (const w of opts) { work['r' + r][m] = w; rec(i + 1); }
      work['r' + r][m] = null;
    };
    rec(0);
    return { u, out };
  };
  const men = enumerate('men'), women = enumerate('women');
  if (!men.out.length || !women.out.length) return null;
  if (men.out.length * women.out.length > 300000) return { tooEarly: true };
  const deltas = (enu, ev) => enu.out.map(assign => {
    const d = {};
    ents.forEach(e => { let t = 0; enu.u.forEach(([r, m], i) => { if (e[ev]['r' + r][m] === assign[i]) t += ROUND_POINTS[r]; }); d[e.id] = t; });
    return d;
  });
  const mD = deltas(men, 'men'), wD = deltas(women, 'women');
  const res = {}; ents.forEach(e => res[e.id] = { canWin: false, winCount: 0, forced: null });
  const total = men.out.length * women.out.length;
  for (let mi = 0; mi < men.out.length; mi++) {
    for (let wi = 0; wi < women.out.length; wi++) {
      let best = -Infinity; const fin = {};
      ents.forEach(e => { const f = bank[e.id] + mD[mi][e.id] + wD[wi][e.id]; fin[e.id] = f; if (f > best) best = f; });
      const leaders = ents.filter(e => fin[e.id] === best);
      for (const L of leaders) {
        const r = res[L.id]; r.canWin = true; r.winCount++;
        const assign = {};
        men.u.forEach(([rr, mm], i) => assign['men:' + rr + ':' + mm] = men.out[mi][i]);
        women.u.forEach(([rr, mm], i) => assign['women:' + rr + ':' + mm] = women.out[wi][i]);
        if (r.forced === null) r.forced = assign;
        else for (const k in r.forced) if (r.forced[k] !== assign[k]) delete r.forced[k];
      }
    }
  }
  return { ents, bank, res, total };
}

// Turn a set of forced match outcomes into short human phrases.
function describeForced(forced) {
  return Object.entries(forced).map(([k, w]) => { const p = k.split(':'); return { ev: p[0], r: +p[1], m: +p[2], w }; })
    .sort((a, b) => a.r - b.r || a.ev.localeCompare(b.ev))
    .map(({ ev, r, m, w }) => {
      const draw = DRAWS[ev];
      if (r === 6) return `${draw[w].name} wins the title`;
      if (r === 5) return `${draw[w].name} reaches the final`;
      const [a, b] = matchContenders(state.results[ev], r, m);
      const opp = (a === w) ? b : a;
      if (opp !== null && opp !== undefined) return `${draw[w].name} beats ${draw[opp].name}`;
      return `${draw[w].name} wins its ${ROUND_SHORT[r]}`;
    });
}

// Panel: what each bracket needs to finish #1, ordered by current standing.
function pathPanel() {
  const P = pathToFirst();
  if (!P) return '';
  if (P.tooEarly) return `<div class="panel"><h2>🏆 Path to the Final</h2>
    <p class="small muted">Too many matches left to call — the scenarios sharpen up after the quarterfinals.</p></div>`;
  const { ents, bank, res, total } = P;
  const order = ents.slice().sort((a, b) => bank[b.id] - bank[a.id] || a.name.localeCompare(b.name));
  const rows = order.map((e, i) => {
    const r = res[e.id]; let body, cls = '';
    if (!r.canWin) { body = 'Eliminated — can no longer finish 1st.'; cls = 'ptf-out'; }
    else if (r.winCount / total >= 0.5) { body = 'In control — finishes 1st in most remaining outcomes.'; cls = 'ptf-lead'; }
    else {
      const conds = describeForced(r.forced || {});
      body = conds.length ? `Needs: ${esc(conds.join('; '))}.` : 'Needs several results to break their way.';
      if (r.winCount / total < 0.1) body += ' <span class="ptf-ls">(long shot)</span>';
    }
    return `<div class="ptf-row ${cls}"><div class="ptf-name">${i + 1}. ${esc(e.name)}</div><div class="ptf-body">${body}</div></div>`;
  });
  return `<div class="panel"><h2>🏆 Path to the Final</h2>
    <p class="small muted">What each bracket needs to finish #1 — recomputed from every remaining outcome.</p>
    ${rows.join('')}</div>`;
}

// "Place over time" bump chart: each bracket's standing (1st–Nth) on every
// tournament day. A round is split across two days (top half of the draw one
// day, bottom half the next), so day = 2·round + top/bottom.
function pointsChartPanel() {
  const entries = Object.values(state.entries).filter(e => e.name)
    .sort((a, b) => a.name.localeCompare(b.name)); // stable order → stable colors
  if (!entries.length) return '';
  const RLABEL = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F'];
  // X-axis = rounds actually played, in order of play. The standing at each round
  // is the cumulative score once that round's results are in — so a round that's
  // already been played keeps its placement and never re-shuffles as later rounds
  // are entered. (The old version guessed a calendar "day" per match by splitting
  // each round in half; that guess is what made prior points drift.)
  let maxRound = -1;
  for (const [ev] of EVENTS) for (let r = 0; r < 7; r++)
    if (state.results[ev]['r' + r].some(v => v !== null && v !== undefined))
      maxRound = Math.max(maxRound, r);
  if (maxRound < 0) return ''; // nothing played yet
  const players = entries.map((e, i) => ({
    name: e.name, color: CHART_COLORS[i % CHART_COLORS.length],
    mp: normalizePicks(e.men), wp: normalizePicks(e.women),
  }));
  const scoreAt = (p, r) =>
    scoreThroughRound(p.mp, state.results.men, r) +
    scoreThroughRound(p.wp, state.results.women, r);
  const nCk = maxRound + 1; // one checkpoint per played round
  const N = players.length;
  const series = players.map(p => ({ name: p.name, color: p.color, rank: [], pts: [] }));
  for (let r = 0; r <= maxRound; r++) {
    const scored = players.map((p, pi) => ({ pi, v: scoreAt(p, r) }));
    const order = scored.slice().sort((a, b) => b.v - a.v);
    let rank = 0, prev = null;
    order.forEach((o, idx) => {
      rank = (prev !== null && o.v === prev) ? rank : idx + 1; prev = o.v;
      series[o.pi].rank[r] = rank; series[o.pi].pts[r] = o.v;
    });
  }
  const W = 360, H = 250, mL = 30, mR = 72, mT = 26, mB = 30;
  const pL = mL, pR = W - mR, pT = mT, pB = H - mB;
  const xAt = i => pL + (nCk <= 1 ? 0 : (i / (nCk - 1)) * (pR - pL));
  const yAt = rank => pT + ((rank - 1) / Math.max(1, N - 1)) * (pB - pT);
  const ord = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 - n % 10 === 10 ? 0 : n % 10)] || 'th');
  const lane = (pB - pT) / Math.max(1, N - 1);
  // Faint alternating lane bands (clamped to the plot) instead of gridlines.
  let bands = '';
  for (let rk = 1; rk <= N; rk += 2) {
    const y0 = Math.max(pT, yAt(rk) - lane / 2), y1 = Math.min(pB, yAt(rk) + lane / 2);
    bands += `<rect x="${pL}" y="${y0.toFixed(1)}" width="${(pR - pL).toFixed(1)}" height="${(y1 - y0).toFixed(1)}" rx="3" class="lbc-band"/>`;
  }
  let yl = '';
  for (let rk = 1; rk <= N; rk++) yl += `<text x="${pL - 9}" y="${(yAt(rk) + 3.2).toFixed(1)}" class="lbc-yl">${ord(rk)}</text>`;
  let xl = '';
  for (let r = 0; r <= maxRound; r++) xl += `<text x="${xAt(r).toFixed(1)}" y="${pB + 15}" class="lbc-xl">${RLABEL[r]}</text>`;
  // Each line: a surface-colored halo beneath, then the colored stroke — so where
  // lines cross, one reads as passing cleanly over the other.
  let paths = '', dots = '';
  series.forEach(s => {
    const pts = s.rank.map((rk, i) => `${xAt(i).toFixed(1)},${yAt(rk).toFixed(1)}`).join(' ');
    paths += `<polyline points="${pts}" class="lbc-halo"/>`
      + `<polyline points="${pts}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
  });
  series.forEach((s, si) => s.rank.forEach((rk, i) => {
    const cx = xAt(i), cy = yAt(rk), key = si + '-' + i;
    const tip = `${s.name}: ${ord(rk)} · ${s.pts[i].toLocaleString()} pts (${RLABEL[i]})`;
    dots += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="3" fill="${s.color}" class="lbc-dot"/>`
      + `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="9" fill="transparent" class="lbc-hit" data-action="chart-pt" data-key="${key}" data-cx="${cx.toFixed(1)}" data-cy="${cy.toFixed(1)}" data-tip="${esc(tip)}"/>`;
  }));
  const ends = series.map(s => ({ name: s.name, color: s.color, y: yAt(s.rank[maxRound]) }))
    .sort((a, b) => a.y - b.y);
  const gap = 12;
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < gap) ends[i].y = ends[i - 1].y + gap;
  if (ends.length && ends[ends.length - 1].y > pB) {
    ends[ends.length - 1].y = pB;
    for (let i = ends.length - 2; i >= 0; i--) if (ends[i].y > ends[i + 1].y - gap) ends[i].y = ends[i + 1].y - gap;
  }
  let endLabels = '';
  ends.forEach(e => { endLabels += `<circle cx="${pR + 7}" cy="${e.y.toFixed(1)}" r="2.6" fill="${e.color}"/><text x="${pR + 13}" y="${(e.y + 3.2).toFixed(1)}" class="lbc-end" fill="${e.color}">${esc(e.name)}</text>`; });
  // Tap tooltip (mobile-friendly) — SVG <title> only shows on desktop hover.
  let tipEl = '';
  if (state.chartTip) {
    const { cx, cy, text } = state.chartTip;
    const w = Math.max(56, text.length * 4.3 + 12), h = 15;
    let tx = Math.max(2, Math.min(cx - w / 2, W - w - 2));
    let ty = cy - h - 6; if (ty < 2) ty = cy + 8;
    tipEl = `<g class="lbc-tip"><rect x="${tx.toFixed(1)}" y="${ty.toFixed(1)}" width="${w.toFixed(1)}" height="${h}" rx="4"/>`
      + `<text x="${(tx + w / 2).toFixed(1)}" y="${(ty + 10.2).toFixed(1)}">${esc(text)}</text></g>`;
  }
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="lbc-svg" role="img" aria-label="Standings by round of play">
    ${bands}${yl}${xl}
    <text x="${((pL + pR) / 2).toFixed(0)}" y="${H - 3}" class="lbc-cap">Round</text>
    ${paths}${dots}${endLabels}${tipEl}</svg>`;
  return `<div class="panel"><h2>📈 Place Over Time</h2>
    <p class="small muted">Where each bracket sat after each round of play, in order. Once a round is done its placement is locked in. Tap a dot for the place and points.</p>
    <div class="lbc-wrap">${svg}</div></div>`;
}

// ---- leaderboard ----
function leaderboardView() {
  const locked = state.config.locked;
  const played = playedCount(state.results.men) + playedCount(state.results.women);
  const rows = Object.values(state.entries).map(e => {
    const mp = normalizePicks(e.men), wp = normalizePicks(e.women);
    const sm = score(mp, state.results.men);
    const sw = score(wp, state.results.women);
    return {
      id: e.id, name: e.name || 'Unnamed',
      men: sm.total, women: sw.total, total: sm.total + sw.total,
      max: entryMaxPossible(mp, state.results.men) + entryMaxPossible(wp, state.results.women),
      correct: sm.correct + sw.correct,
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
    <th class="num">Men</th><th class="num">Women</th><th class="num">Total</th><th class="num">Max</th>
    </tr></thead><tbody>`;
  rows.forEach((r, i) => {
    const me = r.id === state.userId;
    const canOpen = locked || me;
    html += `<tr class="${me ? 'me ' : ''}${canOpen ? 'clickable' : ''}"
      ${canOpen ? `data-action="view-entry" data-id="${r.id}"` : ''}>
      <td class="rank">${i === 0 && r.total > 0 ? '<span class="leader-crown">♛</span>' : (i + 1)}</td>
      <td>${esc(r.name)}${me ? ' (you)' : ''}<div class="small muted">${played > 0 ? `${r.correct}/${played} correct` : 'no results yet'}</div></td>
      <td class="num">${r.men}</td><td class="num">${r.women}</td>
      <td class="num total">${r.total}</td>
      <td class="num lb-max">${r.max.toLocaleString()}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  html += locked
    ? `<p class="small muted">Tap a row to view that bracket.</p>`
    : `<p class="small muted">Other players' picks stay hidden until brackets lock.</p>`;
  html += `</div>`;
  html += pointsChartPanel();
  html += pathPanel();
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

  // Switcher lists every viewable bracket (all of them once locked, else just
  // yours) so you can hop between brackets without going back to the leaderboard.
  const viewable = Object.values(state.entries).filter(x => x.name && (state.config.locked || x.id === state.userId))
    .sort((a, b) => a.name.localeCompare(b.name));
  let html = `<div class="panel">
    <div class="entry-head">
      <h2 class="entry-title">${esc(e.name || 'Bracket')}</h2>
      <div class="entry-nav">
        <select class="entry-switch" data-action="switch-entry" aria-label="View another bracket">
          ${viewable.map(x => `<option value="${x.id}"${x.id === state.viewingEntryId ? ' selected' : ''}>${esc(x.name)}${x.id === state.userId ? ' (you)' : ''}</option>`).join('')}
        </select>
        <button class="btn ghost" data-action="back">← Leaderboard</button>
      </div>
    </div>`;
  if (showResults) {
    html += `<div class="banner score" style="margin-top:10px">Men ${sm.total} · Women ${sw.total} · Total ${sm.total + sw.total}</div>`;
  }
  html += eventSeg();
  html += roundSeg(picks[ev]);
  html += `<h2 style="margin-top:12px">${ROUND_NAMES[state.round]} — ${EVENTS.find(x => x[0] === ev)[1]}</h2>`;
  html += matchArea(picks[ev], ev, state.round, null, showResults ? state.results[ev] : null);
  const champ = picks[ev].r6[0];
  html += `<div class="champion-box"><div class="lbl">Champion pick</div>
    <div class="name${champ !== null ? ' clickable' : ''}"${champ !== null ? ` data-action="info" data-ev="${ev}" data-slot="${champ}"` : ''}>${champ !== null ? flagImg(DRAWS[ev], champ) + esc(label(DRAWS[ev], champ)) : '—'}</div></div>`;
  html += `</div>`;
  return html;
}

// ---- public draw viewer ----
// The round that's currently "live": the deepest round with any result, or the
// next round if that one is already complete in both draws. Used as the Draw
// page's default landing round so people open on the action, not R128.
function currentDrawRound() {
  const anyRes = (ev, r) => state.results[ev]['r' + r].some(v => v !== null && v !== undefined);
  const allRes = (ev, r) => state.results[ev]['r' + r].every(v => v !== null && v !== undefined);
  let hi = 0;
  for (let r = 0; r < 7; r++) if (anyRes('men', r) || anyRes('women', r)) hi = r;
  if (hi < 6 && allRes('men', hi) && allRes('women', hi)) hi++;
  return hi;
}

// Read-only view of the actual draw progressing round by round (winners flow
// into the next round). Same flow layout as the bracket/commissioner, but not
// tappable. Tapping the ⓘ opens the player card — which, once brackets are
// locked, lists who in the pool picked that player and how far.
function drawView() {
  // On a fresh load / hash-refresh onto #draw, land on the live round once
  // results are in (tab clicks already do this via currentDrawRound()).
  if (state._pendingDrawRound && hasResults()) { state.round = currentDrawRound(); state._pendingDrawRound = false; }
  const picks = state.results[state.event];
  let html = `<div class="panel"><h2>🎾 The Draw</h2>
    <p class="muted small">Follow both draws as the rounds play out. Tap the
    <span class="info-dot-inline">i</span> on any player for their profile and to
    see who in the pool picked them.</p>`;
  html += eventSeg();
  html += roundSeg(picks);
  html += `<h2 style="margin-top:12px">${ROUND_NAMES[state.round]} — ${EVENTS.find(e => e[0] === state.event)[1]}</h2>`;
  html += matchArea(picks, state.event, state.round, null, null);
  if (state.round === 6) {
    const champ = picks.r6[0];
    html += `<div class="champion-box"><div class="lbl">Champion</div>
      <div class="name${champ !== null ? ' clickable' : ''}"${champ !== null ? ` data-action="info" data-ev="${state.event}" data-slot="${champ}"` : ''}>${champ !== null ? flagImg(DRAWS[state.event], champ) + esc(label(DRAWS[state.event], champ)) : '— not decided —'}</div></div>`;
  }
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
  html += `<button class="btn" data-action="open-share" style="margin-top:6px">📸 Shareable card</button>`;
  html += `<p class="small muted">Open the screenshot/download card to post the day's standings.</p>`;
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
  html += matchArea(picks, state.event, state.round, 'result', null);
  if (state.round === 6) {
    const champ = picks.r6[0];
    html += `<div class="champion-box"><div class="lbl">Champion</div>
      <div class="name${champ !== null ? ' clickable' : ''}"${champ !== null ? ` data-action="info" data-ev="${state.event}" data-slot="${champ}"` : ''}>${champ !== null ? flagImg(DRAWS[state.event], champ) + esc(label(DRAWS[state.event], champ)) : '— not decided —'}</div></div>`;
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
      <img class="hero-logo" src="logo.png?v=20260626-2000" alt="Wimbledon 2026"
        onerror="rgLogoFallback(this)" />
      <h1 class="title">Kiwi House<br>Family Bracket Challenge</h1>
      <div class="subtitle">Wimbledon 2026</div>
      <p class="hero-tagline">Men's &amp; Women's singles predictions</p>
      <div class="reign">👑 Reigning champion of the court: Michael</div>
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
      <div class="subtitle">Wimbledon 2026</div></div></header>
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
      <div class="subtitle">Wimbledon 2026</div></div></header>
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
  if (a === 'nav') { state.view = el.dataset.view; state.viewingEntryId = null; state.chartTip = null; state.round = el.dataset.view === 'draw' ? currentDrawRound() : 0; history.replaceState(null, '', '#' + el.dataset.view); render(); }
  else if (a === 'chart-pt') {
    const key = el.dataset.key;
    state.chartTip = (state.chartTip && state.chartTip.key === key)
      ? null : { key, cx: +el.dataset.cx, cy: +el.dataset.cy, text: el.dataset.tip };
    render();
  }
  else if (a === 'event') { state.event = el.dataset.event; render(); }
  else if (a === 'round') { state.round = +el.dataset.round; render(); }
  else if (a === 'pick') { doPick(+el.dataset.r, +el.dataset.m, +el.dataset.slot); }
  else if (a === 'result') { doResult(+el.dataset.r, +el.dataset.m, +el.dataset.slot); }
  else if (a === 'info') {
    const pair = el.dataset.pair ? el.dataset.pair.split(',').map(Number) : null;
    state.playerModal = { ev: el.dataset.ev, slot: +el.dataset.slot, pair };
    render();
  }
  else if (a === 'close-player') { state.playerModal = null; render(); }
  else if (a === 'pm-stop') { /* click inside the card — keep it open */ }
  else if (a === 'view-entry') { state.viewingEntryId = el.dataset.id; state.round = 0; render(); }
  else if (a === 'back') { state.viewingEntryId = null; render(); }
  else if (a === 'toggle-lock') { setLocked(!state.config.locked); }
  else if (a === 'new-bracket') { newBracket(); }
  else if (a === 'pick-different-name') { state.pendingName = null; state.pinError = null; render(); }
  else if (a === 'copy-recap') { copyRecap(); }
  else if (a === 'copy-tournament-recap') { copyTournamentRecap(); }
  else if (a === 'copy-final-recap') { copyFinalRecap(); }
  else if (a === 'advance-recap') {
    if (confirm('Mark this recap as sent? The next recap will diff from this point.')) advanceRecap();
  }
  else if (a === 'open-share') { state.shareCard = true; render(); }
  else if (a === 'close-share') { state.shareCard = false; render(); }
  else if (a === 'download-share') { downloadShareCard(); }
  else if (a === 'toggle-final-recap') {
    const now = !state.config.tournamentComplete;
    const msg = now
      ? 'Publish the full tournament wrap-up? Everyone will see it on the Daily Recap tab instead of the daily page.'
      : 'Hide the wrap-up and go back to showing the Daily Recap page?';
    if (confirm(msg)) setTournamentComplete(now);
  }
});

// Bracket switcher on the entry view — jump to another person's bracket.
appEl.addEventListener('change', e => {
  const el = e.target.closest('[data-action="switch-entry"]');
  if (el) { state.viewingEntryId = el.value; render(); }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && state.playerModal) { state.playerModal = null; render(); }
});

// Re-render when crossing the mobile/desktop breakpoint so the bracket switches
// between the connected flow (phone) and the flat list (desktop).
let _wasMobileFlow = isMobileFlow();
window.addEventListener('resize', () => {
  const now = isMobileFlow();
  if (now !== _wasMobileFlow) { _wasMobileFlow = now; if (state.ready) render(); }
});

// Manual URL-hash changes / browser back-forward switch the active tab. (Tab
// clicks use replaceState, so they don't fire this — no double render.)
window.addEventListener('hashchange', () => {
  const v = viewFromHash();
  if (v && v !== state.view) {
    state.view = v; state.viewingEntryId = null;
    if (v === 'draw') state._pendingDrawRound = true; else state.round = 0;
    render();
  }
});

// Swipe left/right to move the draw forward/back a round. The bracket pane
// follows the finger live, then slides to the next round on release (or springs
// back if the drag is too short). Only active where the round navigation is on
// screen (bracket / entry / commissioner) and ignored while a card is open.
// `axis` locks to 'h' or 'v' on the first real movement so we never hijack
// vertical scrolling.
let sw = null;
appEl.addEventListener('touchstart', e => {
  sw = null;
  if (e.touches.length !== 1 || state.playerModal) return;
  if (!appEl.querySelector('.rounds')) return;        // no round nav in this view
  const pane = appEl.querySelector('.round-pane');
  if (!pane) return;
  sw = { x0: e.touches[0].clientX, y0: e.touches[0].clientY, pane, w: pane.offsetWidth || 1, axis: null, dx: 0 };
}, { passive: true });

function swReset(restore) {
  if (sw && sw.pane && restore) {
    sw.pane.style.transition = 'transform .18s ease-out, opacity .18s ease-out';
    sw.pane.style.transform = 'translateX(0)';
    sw.pane.style.opacity = '1';
  }
  sw = null;
}

appEl.addEventListener('touchmove', e => {
  if (!sw) return;
  const dx = e.touches[0].clientX - sw.x0, dy = e.touches[0].clientY - sw.y0;
  if (sw.axis === null) {
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; // wait for a real movement
    sw.axis = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    if (sw.axis === 'v') { sw = null; return; }        // vertical → let the page scroll
    sw.pane.style.transition = 'none';
  }
  e.preventDefault();                                  // horizontal: we own the gesture
  let d = dx;
  if ((d > 0 && state.round === 0) || (d < 0 && state.round === 6)) d *= 0.3; // resist at the ends
  sw.dx = d;
  sw.pane.style.transform = `translateX(${d}px)`;
  sw.pane.style.opacity = String(1 - Math.min(Math.abs(d) / sw.w, 1) * 0.35);
}, { passive: false });

appEl.addEventListener('touchend', e => {
  if (!sw) return;
  if (sw.axis !== 'h') { swReset(true); return; }
  e.preventDefault();                                  // swipe shouldn't also fire a pick tap
  const { pane, w, dx } = sw;
  const forward = dx < 0;
  const next = state.round + (forward ? 1 : -1);
  const commit = Math.abs(dx) > Math.min(w * 0.22, 70) && next >= 0 && next <= 6;
  if (commit) {
    pane.style.transition = 'transform .16s ease-out, opacity .16s ease-out';
    pane.style.transform = `translateX(${forward ? -w : w}px)`;
    pane.style.opacity = '0';
    state._slideIn = forward ? 'right' : 'left';
    sw = null;
    setTimeout(() => { state.round = next; render(); }, 150);
  } else {
    swReset(true);
  }
}, { passive: false });

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
// Auto-update — open tabs notice new deploys without a manual refresh. We poll
// index.html (which the CDN only caches ~10 min) and compare the app.js stamp
// to this build; on a mismatch we show a one-tap "refresh" banner.
// ---------------------------------------------------------------------------
let updateBanner;
function showUpdateBanner() {
  if (updateBanner) return;
  updateBanner = document.createElement('div');
  updateBanner.className = 'update-banner';
  updateBanner.innerHTML = `<span>🎾 New version available</span><button>Refresh</button>`;
  updateBanner.querySelector('button').addEventListener('click', () => location.reload());
  document.body.appendChild(updateBanner);
}
async function checkForUpdate() {
  try {
    const base = location.href.replace(/[^/]*([?#].*)?$/, '');
    const res = await fetch(base + 'index.html?_=' + BUILD, { cache: 'no-store' });
    if (!res.ok) return;
    const m = (await res.text()).match(/app\.js\?v=([0-9-]+)/);
    if (m && m[1] !== BUILD) showUpdateBanner();
  } catch (e) { /* offline / blocked — try again next tick */ }
}
function startUpdateChecks() {
  setInterval(checkForUpdate, 3 * 60 * 1000); // every 3 minutes
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkForUpdate(); });
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
  startUpdateChecks();
}
