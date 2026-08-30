# Kiwi House Family Bracket — US Open 2026

Static HTML/CSS/JavaScript. No build step or package installation. Seven existing family participants; the existing 10 / 20 / 40 / 80 / 160 / 320 / 640 scoring remains (4,480 per draw; 8,960 overall).

## Tournament isolation

| Site | Entries | Metadata |
| --- | --- | --- |
| `/` US Open 2026 | `usopen2026_entries/{player-slug}` | `usopen2026_meta/{results,config,recap_snapshot}` |
| `/wim2026/` Wimbledon archive | `wim2026_entries/{player-slug}` | `wim2026_meta/{results,config,recap_snapshot}` |
| `/rg2026/` Roland Garros archive | `entries/{player-slug}` | `meta/{results,config,recap_snapshot}` |

US Open identity uses only `usopen2026_uid` and `usopen2026_name` in localStorage. There is no migration, reset, or fallback to historical paths. Missing US Open documents mean empty brackets/results and an open, incomplete tournament. Only normal user actions create documents.

Wimbledon assets were copied before the rollover. Its browser write functions are disabled; visitors can browse recaps, the draw, standings, and all brackets without signing in. The historical draw, feed, styling, and logo were preserved. All Roland Garros files are unchanged. Neither archive is a database backup: both still read their original Firestore data.

## Local preview — no production writes

Run from this directory:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/ . On any host other than `kiwihousebracket.com` or `www.kiwihousebracket.com`, the US Open application starts in LOCAL PREVIEW mode. It does not initialize Firebase or connect to Firestore. Choose a name and a disposable four-digit test PIN; picks and manual controls work only in memory, reset on reload, and never persist an identity. The commissioner screen has a local-only preview button so no real password is necessary.

The historical archive pages read their original Firestore data; the Wimbledon app has no active write functions. Do not invoke historical scripts. Local preview does not verify live saving. A production saving test requires separate explicit approval; there is intentionally no query parameter that enables live writes on localhost.

## Manual results only

Only the commissioner selects actual match winners. The app then saves those selections to `usopen2026_meta/results` and recalculates scores. Firestore listeners display saved results; they do not fetch tennis results or choose winners.

- Root `scripts/update-results.mjs` is a disabled stub with no imports, network calls, or database writes. Do not run it.
- There is no root results feed, automated import, scraper, scheduled results task, or fallback results source.
- `wim2026/results-feed.json` is an unchanged historical artifact, never read by the application.
- `rg2026/scripts/update-results.mjs` and its feed remain only because the archive must stay unchanged. **Never run this historical updater.**
- External Claude jobs or copies of old updater scripts must be disabled separately by their owner. This repository cannot revoke their database access.
- The existing site-version check reads `index.html` to offer a refresh after deployment; it never reads or writes tennis results.

Tap a winner in the Commissioner tab to record it; tap again to clear that match. If a correction makes later-round recorded winners contradictory, a confirmation lists the results that would be cleared. Cancel preserves everything. Incomplete feeder rounds do not automatically erase recorded later results. Use one commissioner editing tab at a time: the existing save format writes the complete results document.

The Daily Recap and share card summarize manually entered results since the last commissioner recap checkpoint. “Mark recap as sent” advances that checkpoint, not the results. The initial screen is a preseason/empty recap; no Wimbledon schedule carries over. Featured match lists are intentionally empty. The tournament wrap-up is published manually through existing commissioner controls.

## Draw provenance

See `sources/usopen2026/README.md` and the two numbered first-round transcripts for official USTA draw URLs. Both draws contain 128 players and the 32 official seeds in draw order, including the qualifiers placed in those sheets. No match results were imported.

Player cards show ages, handedness, official August 24 rankings, singles titles and Slam bests, plus overall/hard-court H2H for the pair shown in each person's bracket (including hypothetical later rounds). Match-history coverage extends through Cincinnati 2026; this week's matches are not included. The cards use short labels and a compact coverage date, with data credits in the footer. Current and highest rankings have separate rows; unverified highs show a dash, and missing H2H data is not treated as zero. See `sources/player-reference/README.md` for provenance, licensing and the offline compiler. No reference-data fetch or result import runs in the browser. Countries omitted by the official draw stay blank. Review withdrawals/replacements before collecting picks; never reorder slots once picks exist.

## Verification

```sh
node scripts/check-usopen.mjs
```

The checks run offline with fake browser/database objects, validate official first-round positions/seeds, test scoring and manual correction confirmation, reject historical write paths, and verify that preview never calls Firebase. They never execute an updater or touch live Firestore.

## Deployment and deferred security

Work is on `usopen-2026`; do not push, merge, or deploy without explicit owner approval. GitHub Pages still serves `main` at the repository root. `CNAME`, `.nojekyll`, Firebase configuration, and the domain are unchanged. Asset version stamps are bumped for the rollover.

Before approved release: review the local preview, disable external automation, confirm the new namespace is unused, and explicitly test live saving when authorized. A Pages deployment does not revoke already-open old Wimbledon tabs; those should be closed/refreshed rather than used for editing after the rollover.

Authentication/security redesign is deferred. The existing name/PIN and commissioner password are client-side gates. The write-path guard prevents accidental cross-tournament writes from this app but is not backend security. Existing Firestore rules and external credentials determine what other clients can do. Do not treat this as protection against arbitrary external writers.
