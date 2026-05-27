// ---------------------------------------------------------------------------
// update-results.mjs
//
// Reads `results-feed.json` — a list of completed matches as [winner, loser]
// name pairs — resolves each pair against the official Roland Garros 2026
// draws, and writes the computed match-winner structure to Firestore
// (the `meta/results` document) so the family leaderboard updates.
//
// The scheduled agent fills `results-feed.json` from the official results,
// then runs:   node scripts/update-results.mjs
//
// It is fully idempotent: each run recomputes the entire results state from
// scratch, so it is safe to run as often as you like.
// ---------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { DRAWS } from '../draws.js';
import { firebaseConfig } from '../firebase-config.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const ROUND_SIZES = [64, 32, 16, 8, 4, 2, 1];
const ROUND_SHORT = ['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'Final'];

// --- name matching -------------------------------------------------------
function norm(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
}
function surname(s) {
  const t = norm(s).split(' ').filter(Boolean);
  return t.length ? t[t.length - 1] : '';
}
function namesMatch(feedName, drawName) {
  const a = norm(feedName), b = norm(drawName);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const sa = surname(feedName), sb = surname(drawName);
  // Require surname length >= 3 before substring matching to avoid "li" matching "kalinina" etc.
  return !!sa && !!sb && (sa === sb ||
    (sa.length >= 3 && sb.length >= 3 && (sa.includes(sb) || sb.includes(sa))));
}
// 2 = real name match, 1 = "Qualifier" placeholder (wildcard), 0 = no match
function slotScore(feedName, draw, slot) {
  if (slot == null) return 0;
  const drawName = draw[slot].name;
  if (norm(drawName) === 'qualifier') return 1;
  return namesMatch(feedName, drawName) ? 2 : 0;
}

// --- bracket helpers -----------------------------------------------------
function emptyPicks() {
  const p = {};
  ROUND_SIZES.forEach((n, r) => { p['r' + r] = Array(n).fill(null); });
  return p;
}
function contenders(picks, r, m) {
  if (r === 0) return [2 * m, 2 * m + 1];
  return [picks['r' + (r - 1)][2 * m], picks['r' + (r - 1)][2 * m + 1]];
}

// Resolve one draw's results round by round from the [winner, loser] feed.
function resolveDraw(draw, pairs) {
  const picks = emptyPicks();
  for (let r = 0; r < 7; r++) {
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const [a, b] = contenders(picks, r, m);
      if (a == null || b == null) continue; // both players not yet known
      let best = null, bestScore = 0;
      for (const [w, l] of pairs) {
        // option 1: winner=a, loser=b   option 2: winner=b, loser=a
        const s1 = Math.min(slotScore(w, draw, a), slotScore(l, draw, b));
        const s2 = Math.min(slotScore(w, draw, b), slotScore(l, draw, a));
        if (s1 > bestScore && s1 >= s2) { best = a; bestScore = s1; }
        else if (s2 > bestScore) { best = b; bestScore = s2; }
      }
      if (best != null) picks['r' + r][m] = best;
    }
  }
  return picks;
}

function countResolved(picks) {
  let n = 0;
  for (let r = 0; r < 7; r++) picks['r' + r].forEach(v => { if (v != null) n++; });
  return n;
}

// --- Firestore REST value encoding --------------------------------------
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'string') return { stringValue: v };
  const fields = {};
  for (const k of Object.keys(v)) fields[k] = toValue(v[k]);
  return { mapValue: { fields } };
}

// --- diff against the currently stored results (for the change log) -----
async function fetchExistingResults() {
  const { projectId, apiKey } = firebaseConfig;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/meta/results?key=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.fields) return null;
  const fromMap = (m) => {
    if (!m || !m.mapValue || !m.mapValue.fields) return null;
    const out = {};
    for (const r of Object.keys(m.mapValue.fields)) {
      const arr = (m.mapValue.fields[r].arrayValue && m.mapValue.fields[r].arrayValue.values) || [];
      out[r] = arr.map(v => v.integerValue !== undefined ? Number(v.integerValue) : null);
    }
    return out;
  };
  return {
    men: fromMap(data.fields.men) || emptyPicks(),
    women: fromMap(data.fields.women) || emptyPicks(),
  };
}

function diffPicks(oldP, newP, draw, eventLabel) {
  const lines = [];
  const nm = (s) => s == null ? '(none)' : draw[s].name;
  for (let r = 0; r < 7; r++) {
    const oldArr = (oldP && oldP['r' + r]) || [];
    const newArr = newP['r' + r];
    for (let m = 0; m < ROUND_SIZES[r]; m++) {
      const o = oldArr[m] == null ? null : oldArr[m];
      const n = newArr[m] == null ? null : newArr[m];
      if (o === n) continue;
      lines.push(`  ${eventLabel} ${ROUND_SHORT[r]} m${m + 1}: ${nm(o)} → ${nm(n)}`);
    }
  }
  return lines;
}

// --- main ----------------------------------------------------------------
async function main() {
  let feed;
  try {
    feed = JSON.parse(readFileSync(join(ROOT, 'results-feed.json'), 'utf8'));
  } catch (e) {
    console.error('Could not read results-feed.json — it must contain ' +
      '{ "men": [["Winner","Loser"], ...], "women": [...] }');
    process.exit(1);
  }
  const menPairs = Array.isArray(feed.men) ? feed.men : [];
  const womenPairs = Array.isArray(feed.women) ? feed.women : [];

  const men = resolveDraw(DRAWS.men, menPairs);
  const women = resolveDraw(DRAWS.women, womenPairs);

  console.log(`Feed: ${menPairs.length} men's pairs, ${womenPairs.length} women's pairs`);
  console.log(`Resolved: men ${countResolved(men)} matches, women ${countResolved(women)} matches`);

  // Change log: diff against what's currently in Firestore so each run
  // prints exactly which matches were added, changed, or removed.
  const existing = await fetchExistingResults();
  const menChanges = diffPicks(existing && existing.men, men, DRAWS.men, "Men's");
  const womenChanges = diffPicks(existing && existing.women, women, DRAWS.women, "Women's");
  console.log('Change log since last run:');
  if (menChanges.length + womenChanges.length === 0) {
    console.log('  (no changes)');
  } else {
    menChanges.forEach(l => console.log(l));
    womenChanges.forEach(l => console.log(l));
  }

  if (process.argv.includes('--dry-run')) {
    const champ = (draw, p) => p.r6[0] != null ? draw[p.r6[0]].name : '(undecided)';
    console.log(`Men's champion so far:   ${champ(DRAWS.men, men)}`);
    console.log(`Women's champion so far: ${champ(DRAWS.women, women)}`);
    console.log('Dry run — nothing written to Firestore.');
    return;
  }

  const { projectId, apiKey } = firebaseConfig;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}` +
    `/databases/(default)/documents/meta/results?key=${apiKey}`;
  const body = {
    fields: {
      men: toValue(men),
      women: toValue(women),
      updatedAt: toValue(Date.now()),
    },
  };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Firestore write failed (${res.status}): ${await res.text()}`);
    process.exit(1);
  }
  console.log('✓ Leaderboard results updated in Firestore.');
}

main().catch(err => { console.error(err); process.exit(1); });
