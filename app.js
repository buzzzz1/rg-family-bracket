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

// Inline tennis-ball SVG so it looks identical on every platform — the 🎾
// emoji renders as a racket on Windows. Ball artwork adapted from Twemoji
// (github.com/jdecked/twemoji), licensed CC-BY 4.0.
const BALL_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">' +
  '<circle fill="#c3d63a" cx="18" cy="18" r="18"/>' +
  '<path fill="#dce884" d="M26 18c0 6.048 2.792 10.221 5.802 11.546C34.42 26.42 36 22.396 36 18c0-4.396-1.58-8.42-4.198-11.546C28.792 7.779 26 11.952 26 18z"/>' +
  '<path fill="#FFF" d="M27 18c0-6.048 1.792-10.221 4.802-11.546-.445-.531-.926-1.028-1.428-1.504C27.406 6.605 25 10.578 25 18c0 7.421 2.406 11.395 5.374 13.05.502-.476.984-.973 1.428-1.504C28.792 28.221 27 24.048 27 18z"/>' +
  '<path fill="#dce884" d="M10 18c0-6.048-2.792-10.22-5.802-11.546C1.58 9.58 0 13.604 0 18c0 4.396 1.58 8.42 4.198 11.546C7.208 28.22 10 24.048 10 18z"/>' +
  '<path fill="#FFF" d="M4.198 6.454C7.208 7.78 9 11.952 9 18c0 6.048-1.792 10.22-4.802 11.546.445.531.926 1.027 1.428 1.504C8.593 29.395 11 25.421 11 18c0-7.421-2.406-11.395-5.374-13.049-.502.476-.984.972-1.428 1.503z"/>' +
  '</svg>';

function mountBallRain() {
  const layer = document.createElement('div');
  layer.className = 'ball-rain';
  layer.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 16; i++) {
    const b = document.createElement('span');
    b.innerHTML = BALL_SVG;
    const size = 16 + Math.random() * 30;
    b.style.left = (Math.random() * 96) + 'vw';
    b.style.width = size + 'px';
    b.style.height = size + 'px';
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
