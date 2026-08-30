"""Offline reference-data compiler. Never contacts Firebase or changes draws/results.

Usage: python3 scripts/build-player-reference.py /path/to/pinned-reference-data
See sources/player-reference/README.md for provenance and scope.
"""
import collections
import csv
import hashlib
import json
import pathlib
import re
import subprocess
import sys
import unicodedata

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCE = pathlib.Path(sys.argv[1])
COMMIT = '83733587353df8a41f2fd4f516147d5aa83f5a8d'

def read_draw(path):
    code = 'const fs=require("node:fs"),vm=require("node:vm"); console.log(JSON.stringify(vm.runInNewContext(fs.readFileSync(process.argv[1],"utf8").replace("export const DRAWS =","var DRAWS =")+"; DRAWS")));'
    return json.loads(subprocess.check_output(['node', '-e', code, str(path)]))

def norm(value):
    return re.sub('[^a-z0-9]', '', unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode().lower())

def rows(path):
    with path.open(encoding='utf-8-sig', newline='') as f:
        yield from csv.DictReader(f)

draws = read_draw(ROOT / 'draws.js')
old = read_draw(ROOT / 'wim2026/draws.js')
reference = {'coverage': 'Through Cincinnati 2026', 'rankingDate': '2026-08-24', 'reviewedDate': '2026-08-29', 'commit': COMMIT, 'profiles': {}, 'h2h': {}}
current_rankings = json.loads((ROOT / 'sources/player-reference/rankings-2026-08-24.json').read_text())
birthdate_supplements = {
    'Jack Kennedy': ('2008-06-04', 'https://www.tennis.com/players-rankings/jack-kennedy'),
    'Thea Frodin': ('2008-12-17', 'https://www.itftennis.com/media/13748/2025-girls-year-end-rankings.pdf'),
}
aliases = {'Daniel Merida': 'Daniel Merida Aguilar', 'Aleksandr Shevchenko': 'Alexander Shevchenko', 'Gabriela Knutson': 'Gabriela Andrea Knutson'}
manifest = {}
for event, tour in [('men', 'atp'), ('women', 'wta')]:
    directory = SOURCE / tour
    required = [f'{tour}_players.csv', f'{tour}_rankings_current.csv'] + [f'{tour}_matches_{year}.csv' for year in range(1990, 2027)]
    assert all((directory / file).is_file() for file in required), f'Incomplete {tour} snapshot'
    people = collections.defaultdict(list)
    for p in rows(directory / f'{tour}_players.csv'):
        people[norm(p['name_first'] + ' ' + p['name_last'])].append(p)
    profiles, by_id = {}, {}
    for p in draws[event]:
        name = p['fullName']
        found = people[norm(aliases.get(name, name))]
        # ATP profile confirms 2005-02-02; reject the conflicting duplicate.
        if name == 'Juncheng Shang':
            found = [x for x in found if x['dob'] == '20050202']
        signatures = {(x['dob'], x['ioc']) for x in found}
        if not found or len(signatures) != 1:
            profiles[name] = {'available': False}
            continue
        for x in found:
            assert x['player_id'] not in by_id
            by_id[x['player_id']] = name
        dob = found[0]['dob']
        hands = {x['hand'] for x in found if x['hand'] in ['L', 'R']}
        previous = [x for x in old[event] if norm(x['name']) == norm(p['name']) and (not p['country'] or x['country'] == p['country'])]
        profiles[name] = {
            'available': True, 'ids': [x['player_id'] for x in found],
            'dob': f'{dob[:4]}-{dob[4:6]}-{dob[6:]}' if len(dob) == 8 else None,
            'plays': next(iter(hands)) if len(hands) == 1 else None,
            'rank': None, 'high': previous[0]['high'] if len(previous) == 1 else None,
            'titles': 0, 'recordedMatches': 0, 'ao': None, 'rg': None, 'wim': None, 'uso': None,
        }
    for name, p in profiles.items():
        p['rank'] = current_rankings[event].get(name)
        # A past #1 cannot become an outdated career best. Other carried-over
        # highs are not presented as newly verified current statistics.
        p['priorHigh'] = p.get('high')
        p['high'] = 1 if p.get('high') == 1 else None
        # ATP profile checked 2026-08-29: career high #2 (2022-06-13).
        if name == 'Alexander Zverev':
            p['high'] = 2
    names = {norm(aliases.get(name, name)):name for name in profiles}
    names.update({norm(name):name for name in profiles})
    def current_rows():
        for row in rows(SOURCE / 'current' / f'{tour}-2026.csv'):
            # The June source already includes the complete French Open.
            # Only append later completed events, with an explicit US Open ban.
            if row['tourney_date'] < '20260608':
                continue
            assert row['tourney_date'] <= '20260824'
            assert norm(row['tourney_name']) not in ['usopen', 'rolandgarros', 'frenchopen']
            assert row['tourney_id'] not in ['2026-560', '2026-905']
            for side in ['winner', 'loser']:
                name = names.get(norm(row[side + '_name']))
                row[side + '_id'] = 'tml:' + row[side + '_id']
                if name:
                    by_id[row[side + '_id']] = name
            yield row
    h2h, bests, seen = {}, {}, set()
    rounds = {'R128': 0, 'R64': 1, 'R32': 2, 'R16': 3, 'QF': 4, 'SF': 5, 'F': 6, 'W': 7}
    slams = {norm(k): v for k,v in {'Australian Open': 'ao', 'Roland Garros': 'rg', 'Wimbledon': 'wim', 'US Open': 'uso'}.items()}
    historical = []
    for path in sorted(directory.glob(f'{tour}_matches_*.csv')):
        assert re.fullmatch(rf'{tour}_matches_(199\d|20[012]\d)\.csv', path.name)
        for row in rows(path):
            assert row['tourney_date'] <= '20260525', 'Historical base exceeds reviewed cutoff'
            historical.append(row)
    for batch in [historical, current_rows()]:
        for row in batch:
            key = (row['tourney_id'], row['match_num'], row['winner_id'], row['loser_id'])
            if key in seen:
                continue
            seen.add(key)
            winner, loser = by_id.get(row['winner_id']), by_id.get(row['loser_id'])
            if row['tourney_level'] in ['E', 'C', 'S', 'CC', '50+H', '35+H'] or 'Next Gen' in row['tourney_name']:
                continue
            played = bool(row['score']) and not any(x in row['score'].upper() for x in ['W/O', 'DEF'])
            for name in [winner, loser]:
                if name and played:
                    profiles[name]['recordedMatches'] += 1
            if winner and loser and winner != loser and played:
                pair = sorted([winner, loser])
                record = h2h.setdefault('|'.join(pair), [0, 0, 0, 0])
                side = pair.index(winner)
                record[side] += 1
                if row['surface'] == 'Hard':
                    record[side + 2] += 1
            if winner and row['round'] == 'F' and row['tourney_level'] != 'D' and row['tourney_name'] not in ['United Cup', 'ATP Cup', 'Hopman Cup', 'World Team Cup']:
                profiles[winner]['titles'] += 1
            slam = slams.get(norm(row['tourney_name'])) if row['tourney_level'] == 'G' else None
            if slam and row['round'] in rounds:
                for name, stage in [(winner, 'W' if row['round'] == 'F' else row['round']), (loser, row['round'])]:
                    if not name:
                        continue
                    k = (name, slam)
                    current = bests.get(k, (-1, set()))
                    value = rounds[stage]
                    year = row['tourney_date'][:4]
                    if value > current[0]:
                        bests[k] = (value, {year})
                    elif value == current[0]:
                        current[1].add(year)
    for (name, slam), (stage, years) in bests.items():
        profiles[name][slam] = list(rounds)[stage] + ' ' + ', '.join(sorted(years))
    for p in profiles.values():
        if p.get('available') and not p['recordedMatches']:
            p['titles'] = None
    for name, (dob, source) in birthdate_supplements.items():
        if name in profiles:
            profiles[name].update(dob=dob, bioSource=source)
    reference['profiles'][event], reference['h2h'][event] = profiles, h2h
    print(event, sum(p['available'] for p in profiles.values()), 'matched biographies;', len(h2h), 'recorded pairings; missing:', [n for n,p in profiles.items() if not p['available']])
    for path in sorted(directory.iterdir()):
        manifest[str(path.relative_to(SOURCE))] = hashlib.sha256(path.read_bytes()).hexdigest()

for path in sorted((SOURCE / 'current').iterdir()):
    manifest[str(path.relative_to(SOURCE))] = hashlib.sha256(path.read_bytes()).hexdigest()
manifest['rankings-2026-08-24.json'] = hashlib.sha256((ROOT / 'sources/player-reference/rankings-2026-08-24.json').read_bytes()).hexdigest()
header = '// Player reference only; no live results. Jeff Sackmann / Tennis Abstract (CC BY-NC-SA 4.0), TennisMyLife, ATP/WTA rankings.\n// See sources/player-reference/README.md. Generated offline; do not edit by hand.\n'
(ROOT / 'player-reference.js').write_text(header + 'export const PLAYER_REFERENCE = ' + json.dumps(reference, ensure_ascii=False, separators=(',', ':')) + ';\n')
out = ROOT / 'sources/player-reference'
out.mkdir(exist_ok=True)
(out / 'manifest.json').write_text(json.dumps({'commit': COMMIT, 'sha256': manifest}, indent=2) + '\n')
