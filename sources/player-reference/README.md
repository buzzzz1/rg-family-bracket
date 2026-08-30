# Player reference data

Reviewed August 29, 2026. Rankings are the official August 24 lists. Career totals, Grand Slam bests and H2H include completed events through Cincinnati 2026. **This week's ongoing-event records are not included.** The cards have one compact coverage line, with no Sources dropdown. This document is linked by the small Data credits link in the site footer.

No reference-data fetch runs in the website. Everything is compiled offline into `player-reference.js`. The compiler never contacts Firebase and never modifies tournament picks, results, archives, draw order or seeds.

## Sources and licensing

- Official ATP rankings: https://www.atptour.com/en/rankings/singles and its `rankRange` pages 101–200, 201–300, 301–400, 401–500, 501–600 and 701–800. The entrant subset is saved in `rankings-2026-08-24.json`. Full names or unambiguous initial/surname matches are used, with explicit aliases for multi-part given names.
- Official WTA rankings: https://wtafiles.wtatennis.com/pdf/rankings/Singles_Numeric.pdf, printed August 24, 2026. All 128 entrants matched by full name.
- Newer completed-event records: https://stats.tennismylife.org/data/2026.csv and https://stats.tennismylife.org/data/2026_wta.csv. The provider's file list dated both August 24, 2026. Documentation/attribution: https://stats.tennismylife.org/tennis-match-database, creator TennisMyLife, published under the MIT license. Its WTA data is a newer compilation with a provider reliability caveat; totals are not independently certified by the tours.
- Historical base and biographies: **Jeff Sackmann / Tennis Abstract**, via https://github.com/Aneeshers/tennis-sackmann-archive/tree/83733587353df8a41f2fd4f516147d5aa83f5a8d. Original repositories https://github.com/JeffSackmann/tennis_atp and https://github.com/JeffSackmann/tennis_wta returned 404 when checked. The base contains complete 1990–2025 files and 2026 through Roland Garros.
- Additional birth dates: Jack Kennedy, June 4, 2008, https://www.tennis.com/players-rankings/jack-kennedy; Thea Frodin, December 17, 2008, official ITF https://www.itftennis.com/media/13748/2025-girls-year-end-rankings.pdf.

The derived reference dataset retains **CC BY-NC-SA 4.0** attribution/licensing for the Sackmann data: https://creativecommons.org/licenses/by-nc-sa/4.0/. Noncommercial use only; redistributed adaptations must carry that license. This notice covers reference data, not unrelated application code. Attribution is accessible through Data credits in the footer.

## Compilation and safety

The historical base is retained, then only TennisMyLife records dated June 8–August 24 are appended. This avoids replacing early-2026 team events and double-counting the French Open. The newer provider mixes actual match dates and tournament start dates; coverage is therefore named by the completed Cincinnati event, not inferred from the maximum date field. Its ongoing-event feeds were not downloaded or used.

US Open 2026 records are explicitly rejected by normalized event name and tournament IDs. Roland Garros is rejected from appended records because the complete event already exists in the base. Qualifiers, lower-tier files and this week's in-progress events are not inputs. There is no scheduled download, automatic winner selection or connection between reference data and commissioner results.

H2H is keyed by displayed players' full names, so it works for hypothetical later rounds in anyone's bracket. Counts include source-classified main draws and team singles, excluding walkovers, defaults, empty scores, Next Gen, and known lower-tier classifications E/C/S/CC/50+H/35+H. Retirements count. Titles exclude team-event finals. Slam names are case-normalized. Source classifications/completeness can differ from official tour totals.

Missing pairings say “No recorded meetings” or “Head-to-head data unavailable”; they are not asserted to be a current 0–0. Ages and official rankings are available for all 256 entrants; 243 have handedness in the base. There are 5,991 pairings with recorded meetings. Jack Kennedy has a separately sourced age and official ranking but no matched match-history identity in the base. Other players may also lack covered tour matches.

Current and highest rankings are separate rows. Unverified prior Wimbledon highs remain unused provenance (`priorHigh`) and show as a dash rather than a guessed value. A prior No. 1 can safely remain a career high. Alexander Zverev's high of No. 2 (first reached June 13, 2022) was checked against his ATP profile on August 29, 2026: https://www.atptour.com/en/players/zverev/z355/overview. His current August 24 ranking is also No. 2.

Reviewed variants: Daniel Merida → Daniel Merida Aguilar (ATP https://www.atptour.com/en/players/daniel-merida%20aguilar/m0n7/overview); Aleksandr Shevchenko → Alexander Shevchenko (ATP https://www.atptour.com/en/players/alexander-shevchenko/s0h2/overview); Gabriela Knutson → Gabriela Andrea Knutson (WTA https://www.wtatennis.com/players/321367/gabriela-knutson). Juncheng Shang's conflicting duplicate is rejected using the ATP-confirmed birthday 2005-02-02: https://www.atptour.com/en/players/juncheng-shang/s0re/overview. No fuzzy surname matching is used.

## Offline reproduction

`python3 scripts/build-player-reference.py /path/to/reference-directory`

Inputs: `atp/` and `wta/` folders with pinned player tables, ranking tables and main-draw match files 1990–2026; plus `current/atp-2026.csv` and `current/wta-2026.csv` with the reviewed TennisMyLife completed-event downloads. The official ranking subset is read from this folder. Raw CSVs remain outside the repo. `manifest.json` records input SHA-256 hashes and the historical base commit.

The compiler writes only `player-reference.js` and the input manifest. Changed inputs or extended coverage require manual review; never use these records to populate commissioner results.
