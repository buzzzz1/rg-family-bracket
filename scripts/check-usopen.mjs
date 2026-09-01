// Offline rollover checks. Never imports or executes any results updater.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => readFileSync(join(root, path), 'utf8');
const drawSource = read('draws.js').replace('export const', 'const');
const noop = () => {};
function loadApp(path = 'app.js', hostname = '127.0.0.1') {
  const timers = new Map(), writes = [], storage = [];
  let serial = 0;
  const element = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], style: {}, innerHTML: '' };
  const context = vm.createContext({
    console, structuredClone, URL, URLSearchParams,
    location: { hostname, hash: '', href: `http://${hostname}/`, reload: noop },
    history: { replaceState: noop }, navigator: {},
    document: { getElementById: () => element, addEventListener: noop, querySelector: () => null, documentElement: {}, body: {} },
    window: { addEventListener: noop, matchMedia: () => ({ matches: false }) },
    localStorage: { getItem: key => { storage.push(key); return null; }, setItem: (key) => storage.push(key), removeItem: key => storage.push(key) },
    firebaseConfig: { apiKey: 'offline-fixture' }, COMMISSIONER_PASSWORD: 'offline-test-only',
    confirm: () => true, alert: noop,
    setTimeout: fn => { timers.set(++serial, fn); return serial; },
    clearTimeout: id => timers.delete(id), setInterval: () => { throw new Error('No polling in offline checks'); },
    requestAnimationFrame: noop,
    fetch: () => { throw new Error('Network access forbidden in checks'); },
    _writes: writes,
  });
  let source = read(path).replace(/^import .*;\n/gm, '');
  source = source.slice(0, source.lastIndexOf('\nmountBallRain();'));
  const draws = path.startsWith('wim2026/') ? read('wim2026/draws.js').replace('export const', 'const') : drawSource;
  const reference = path.startsWith('wim2026/') ? '' : read('player-reference.js').replace('export const', 'const');
  vm.runInContext(draws + '\n' + reference + '\n' + source, context);
  const run = code => vm.runInContext(code, context);
  run('render = () => {}; db = {}; fb = { doc: (db, collection, id) => ({ collection, id }), setDoc: (ref, data) => { _writes.push({ ...ref, data }); return Promise.resolve(); } };');
  return { run, context, writes, storage, flush: () => { const queued = [...timers.values()]; timers.clear(); queued.forEach(fn => fn()); } };
}

const local = loadApp();
assert.equal(local.run("label([{name:'Player',entry:'Q'}],0)"), 'Player (Q)');
assert.equal(local.run("label([{name:'Player',entry:'W'}],0)"), 'Player (WC)');
assert.equal(local.run("label([{name:'Player',entry:'L'}],0)"), 'Player (LL)');
assert.equal(local.run("label([{name:'Player',seed:2,entry:null}],0)"), 'Player (2)');
const data = JSON.parse(local.run('JSON.stringify(DRAWS)'));
for (const event of ['men', 'women']) {
  const rows = read(`sources/usopen2026/${event}-round1.txt`).split('\n').filter(line => /^\d+\./.test(line));
  assert.equal(rows.length, 128);
  assert.equal(data[event].length, 128);
  assert.equal(new Set(data[event].map(p => p.fullName)).size, 128);
  assert.deepEqual(data[event].filter(p => p.seed).map(p => p.seed).sort((a,b) => a-b), Array.from({length:32},(_,i)=>i+1));
  rows.forEach((line, index) => {
    assert.equal(data[event][index].entry, line.match(/\(([QWL])\)/)?.[1] || null);
    assert.equal(data[event][index].drawPosition, index + 1);
    assert.equal(data[event][index].seed, line.match(/\[(\d+)\]/) ? +line.match(/\[(\d+)\]/)[1] : null);
    const named = line.replace(/^\d+\. /, '').replace(/\s*(\[\d+\]|\([QWL]\))/g, '').replace(/ [A-Z]{3}$/, '').split(', ');
    assert.equal(data[event][index].fullName.toUpperCase(), `${named[1]} ${named[0]}`.toUpperCase());
  });
}
console.log('PASS: all 256 positions/names and both sets of 32 seeds match official transcripts');

local.run("state.pendingName = 'Chloe'; submitPin('1234'); doPick(0, 0, 0);");
local.flush();
assert.equal(local.run('state.entries.chloe.men.r0[0]'), 0);
assert.equal(local.run('state.entries.chloe.women.r0[0]'), null);
assert.equal(local.storage.length, 0);
assert.equal(local.writes.length, 0);
assert.equal(local.run('LOCAL_PREVIEW'), true);
local.run('state.commish = true; setLocked(true);');
local.run('doPick(0, 0, 1);');
assert.equal(local.run('state.myPicks.men.r0[0]'), 0);
local.run('setLocked(false); doResult(0, 0, 0);');
local.flush();
assert.equal(local.run('score(state.myPicks.men, state.results.men).total'), 10);
local.run('advanceRecap();');
assert.equal(local.run('state.recapSnapshot.men.r0[0]'), 0);
assert.equal(local.run('recapDayMatches().length'), 0);
assert.equal(local.writes.length, 0);
console.log('PASS: preview picks, locks, results, scoring, and recap checkpoints never write to Firebase');

local.run('state.results.men = emptyPicks(); state.results.men.r0[0] = 0; state.results.men.r0[1] = 2; state.results.men.r1[0] = 0;');
let prompt = '';
local.context.confirm = message => { prompt = message; return false; };
const before = local.run('JSON.stringify(state.results)');
local.run('doResult(0, 0, 1);');
assert.match(prompt, /R64 match 1/);
assert.equal(local.run('JSON.stringify(state.results)'), before);
local.context.confirm = () => true;
local.run('doResult(0, 0, 1);');
assert.equal(local.run('state.results.men.r0[0]'), 1);
assert.equal(local.run('state.results.men.r1[0]'), null);
local.run('state.results.men = emptyPicks(); state.results.men.r1[0] = 0; doResult(0, 1, 2);');
assert.equal(local.run('state.results.men.r1[0]'), 0);
console.log('PASS: correction confirmation, cancellation, and incomplete-feeder result preservation');

// Daily recap keeps the 1-32 survivor maps while its fallen-seed list is checkpoint-scoped.
local.run("state.results.men.r0[0] = 1");
const seedRecap = local.run('dailyRecapView()');
assert.equal((seedRecap.match(/class=\"seed-grid\"/g) || []).length, 2);
assert(seedRecap.includes('seed-chip out\" aria-label=\"Seed 1: out'));
assert(seedRecap.includes('aria-label=\"Seed 2: still in'));
local.run("state.results.men.r0[0] = null");
console.log('PASS: recap renders both seed-survivor grids with live/out states');


assert.equal(local.run(`(() => { const p = emptyPicks(); for (let r=0;r<7;r++) p['r'+r] = Array.from({length:ROUND_SIZES[r]},(_,m)=>m * 2**(r+1)); return score(p,p).total; })()`), 4480);
console.log('PASS: unchanged perfect-draw score of 4,480');

// Exercise the existing recap/leaderboard renderers with a complete synthetic
// tournament. This is an offline fixture, never a real result import.
local.run(`
  const fixture = emptyPicks();
  for (let r=0;r<7;r++) fixture['r'+r] = Array.from({length:ROUND_SIZES[r]},(_,m)=>m * 2**(r+1));
  state.results = {men:normalizePicks(fixture), women:normalizePicks(fixture)};
  state.entries = {chloe:{id:'chloe',name:'Chloe',men:normalizePicks(fixture),women:normalizePicks(fixture)}};
  state.recapSnapshot = {men:normalizePicks(fixture),women:normalizePicks(fixture)};
  state.results.men.r0[0] = 1;
`);
assert.match(local.run('dailyRecapView()'), /-10/);
assert.match(local.run('generateRecapText()'), /Standings/);
local.run('state.config.tournamentComplete = true;');
for (const renderer of ['leaderboardView','recapView','shareCardView','commissionerView','generateFinalRecapText','generateTournamentRecapText']) {
  assert.equal(typeof local.run(`${renderer}()`), 'string');
}
local.run("state.playerModal = {ev:'men',slot:0};");
assert.match(local.run('playerModalHTML()'), /Alexander Zverev/);
console.log('PASS: recap correction delta, wrap-up, share card, leaderboard, commissioner, and player-card rendering');

// Reference cards follow the displayed picks, including hypothetical pairings.
// They must remain pure reads and preserve score orientation when sides swap.
const referenceApp = loadApp();
const stateBeforeReference = referenceApp.run('JSON.stringify(state)');
assert.match(referenceApp.run("matchupReferenceHTML('men',[0,1])"), /<strong>6<\/strong><span>wins<\/span><strong>0<\/strong>/);
assert.match(referenceApp.run("matchupReferenceHTML('men',[1,0])"), /<strong>0<\/strong><span>wins<\/span><strong>6<\/strong>/);
assert.equal(referenceApp.run("matchupReferenceHTML('men',[0,null])"), '');
assert.equal(referenceApp.run("matchupReferenceHTML('men',[0,0])"), '');
assert.match(referenceApp.run("matchupReferenceHTML('men',[0,DRAWS.men.findIndex(p=>p.fullName==='Jack Kennedy')])"), /data unavailable/);
referenceApp.run(`
  const picksA = emptyPicks(), picksB = emptyPicks();
  picksA.r0[0]=0; picksA.r0[1]=2;
  picksB.r0[0]=1; picksB.r0[1]=3;
`);
assert.match(referenceApp.run("flowMatch(picksA,DRAWS.men,'men',1,0,'pick',emptyPicks())"), /data-pair="0,2"/);
assert.match(referenceApp.run("flowMatch(picksB,DRAWS.men,'men',1,0,'pick',emptyPicks())"), /data-pair="1,3"/);
assert.equal(referenceApp.run('JSON.stringify(state)'), stateBeforeReference);
referenceApp.run("state.playerModal={ev:'women',slot:DRAWS.women.findIndex(p=>p.fullName==='Aryna Sabalenka')};");
assert.match(referenceApp.run('playerModalHTML()'), /W \(2024, 2025\)/);
assert.match(referenceApp.run('playerModalHTML()'), /Rankings Aug 24/);
assert(!referenceApp.run('playerModalHTML()').includes('pm-sources'));
assert(!/historical snapshot|June snapshot|prior Wimbledon profile/.test(referenceApp.run('playerModalHTML()')));
assert.equal(referenceApp.run("PLAYER_REFERENCE.profiles.men['Alexander Zverev'].wim"), 'F 2026');
assert.equal(referenceApp.run("PLAYER_REFERENCE.profiles.men['Alexander Zverev'].rank"), 2);
assert.equal(referenceApp.run("PLAYER_REFERENCE.profiles.men['Alexander Zverev'].high"), 2);
referenceApp.run("state.playerModal={ev:'men',slot:0};");
assert.match(referenceApp.run('playerModalHTML()'), /Current ATP ranking<\/span><span class="pm-val">#2/);
assert.match(referenceApp.run('playerModalHTML()'), /Highest ranking<\/span><span class="pm-val">#2/);
assert.equal(referenceApp.run("PLAYER_REFERENCE.profiles.men['Alexander Zverev'].titles"), 25); // French Open not double-counted.
assert.equal(referenceApp.run('PLAYER_REFERENCE.coverage'), 'Through Cincinnati 2026');
assert.equal(referenceApp.writes.length,0);
assert.equal(referenceApp.storage.length,0);
const referenceData = JSON.parse(referenceApp.run('JSON.stringify(PLAYER_REFERENCE)'));
for (const event of ['men','women']) {
  const names = new Set(data[event].map(p=>p.fullName));
  assert(data[event].every(p=>/^\d{4}-\d{2}-\d{2}$/.test(referenceData.profiles[event][p.fullName]?.dob)));
  assert(data[event].every(p=>Number.isInteger(referenceData.profiles[event][p.fullName]?.rank)));
  for (const [pair, counts] of Object.entries(referenceData.h2h[event])) {
    const [a,b] = pair.split('|');
    assert(names.has(a) && names.has(b) && a!==b);
    assert(counts.length===4 && counts.every(n=>Number.isInteger(n)&&n>=0));
    assert(counts[0]+counts[1]>0 && counts[2]<=counts[0] && counts[3]<=counts[1]);
  }
}
assert(!/\b(fetch|setDoc|localStorage|setInterval)\s*\(/.test(read('player-reference.js')));
console.log('PASS: H2H orientation, hypothetical picks, unknown coverage, dated bios, and no reference-data writes');

const live = loadApp('app.js', 'kiwihousebracket.com');
assert.equal(live.run('LOCAL_PREVIEW'), false);
assert.deepEqual(live.storage, ['usopen2026_uid', 'usopen2026_name']);
for (const collection of ['entries','meta','wim2026_entries','wim2026_meta']) {
  await assert.rejects(live.run(`writeTournamentDocument('${collection}', 'results', {})`), /Blocked write/);
}
await assert.rejects(live.run("writeTournamentDocument('usopen2026_meta','unknown',{})"), /Blocked write/);
await assert.rejects(live.run("writeTournamentDocument('usopen2026_meta','results',{})"), /Commissioner/);
live.run("state.pendingName = 'Chloe'; submitPin('1234'); doPick(0,0,0); state.commish = true; doResult(0,0,0); advanceRecap(); setTournamentComplete(true);");
live.flush();
await live.run('setLocked(true)');
live.run('state.config.locked = true;'); // Simulate the config listener acknowledging the lock.
assert(live.writes.length >= 5);
assert(live.writes.every(w => ['usopen2026_entries','usopen2026_meta'].includes(w.collection)));
await assert.rejects(live.run("writeTournamentDocument('usopen2026_entries','chloe',{})"), /locked/);
console.log('PASS: production request simulation targets only exact US Open paths; locked writes rejected');

const archive = loadApp('wim2026/app.js');
archive.run("state.commish = true; saveMyEntry(); saveResults(); setLocked(false); setTournamentComplete(true); advanceRecap(); doPick(0,0,0); doResult(0,0,0); enterBracket('Chloe','1234');");
archive.flush();
assert.equal(archive.writes.length, 0);
assert.equal(archive.storage.length, 0);
assert.equal(archive.run('ENTRIES_COLL'), 'wim2026_entries');
assert.equal(archive.run('META_COLL'), 'wim2026_meta');
assert(!/fb\.(setDoc|updateDoc|deleteDoc|addDoc)/.test(read('wim2026/app.js')));
console.log('PASS: Wimbledon archive has no database or identity writes');

function walk(dir) { return readdirSync(join(root,dir),{withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]); }
for (const file of [...walk('rg2026'),'CNAME','.nojekyll','favicon.svg','firebase-config.js']) {
  assert.deepEqual(readFileSync(join(root,file)),execFileSync('git',['show',`a356f7c9c89f6b0b21ae4c1c95fb603a69e1d366:${file}`],{cwd:root}));
}
for (const file of ['draws.js','styles.css','logo.png','firebase-config.js','favicon.svg','results-feed.json']) {
  assert.deepEqual(readFileSync(join(root,'wim2026',file)),execFileSync('git',['show',`a356f7c9c89f6b0b21ae4c1c95fb603a69e1d366:${file}`],{cwd:root}));
}
const stub = read('scripts/update-results.mjs').replace(/^\/\/.*$/gm,'');
assert(!/\b(import|fetch|setDoc|readFile|https?:)\b/.test(stub));
assert(!/results-feed|update-results\.mjs/.test(read('app.js')));
assert(!/rg26_uid|rg26_name/.test(read('app.js')));
console.log('PASS: historical assets/data files and hosting configuration unchanged; root updater inert');
console.log('All offline US Open checks passed. No live database access was made.');
