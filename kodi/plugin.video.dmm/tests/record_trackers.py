#!/usr/bin/env python3
"""Record what Trakt and Simkl answer the addon into fixtures/, three rows per list.

    TRAKT_ACCESS_TOKEN=... TRAKT_CLIENT_ID=... SIMKL_ACCESS_TOKEN=... SIMKL_CLIENT_ID=... \\
        python3 kodi/plugin.video.dmm/tests/record_trackers.py

It asks exactly what the addon asks (trackers.PATHS), Trakt's lists 100 to a page so a long history spans two
pages, and writes each answer as it came, cut to three rows per list (per page on Trakt) because the repository is
public. The rows kept are the ones the tests need: films on both trackers, on one alone and without an IMDb id;
shows on both with the most seasons watched, then one watched to the end. Trakt's pagination headers go to
trakt-pages.json. It prints how many rows came without ids.imdb, and writes no token. TRAKT_CLIENT_ID defaults to
DMM's public one. Then update fixtures/README.md and the expectations in test_trackers.py.
"""
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
FIXTURES = os.path.join(HERE, 'fixtures')
sys.path.insert(0, os.path.dirname(HERE))
from resources.lib import dmm, trackers  # noqa: E402

KEEP = 3


def imdb(row):
    return ((row.get('movie') or row.get('show') or {}).get('ids') or {}).get('imdb')


def rows_of(data, name):
    return data if isinstance(data, list) else (data or {}).get(name) or []


def in_order(rows, picked):
    return [r for r in rows if any(r is p for p in picked)][:KEEP]


def pick_films(rows, other):
    """One film the other tracker has too, one it lacks and one without an IMDb id, then the first ones."""
    groups = ([r for r in rows if imdb(r) in other], [r for r in rows if imdb(r) and imdb(r) not in other],
              [r for r in rows if not imdb(r)])
    picked = [g[0] for g in groups if g]
    return in_order(rows, picked + [r for r in rows if not any(r is p for p in picked)][:KEEP - len(picked)])


def pick_shows(service, rows, other):
    """The two shows on both trackers with the most seasons watched, then one with every aired episode watched."""
    def seasons(r):
        return -len({s['number'] for s in r.get('seasons') or [] if s['number']})

    def finished(r):
        one = trackers.parse(service, None, [r] if service == 'trakt' else {'shows': [r]})
        return trackers.marks(trackers.union([one]), {'mediatype': 'tvshow', 'imdb': imdb(r)}) == {'playcount': 1}
    picked = sorted([r for r in rows if imdb(r) in other], key=seasons)[:KEEP - 1]
    picked += [r for r in rows if finished(r) and not any(r is p for p in picked)][:1]
    picked += sorted([r for r in rows if not any(r is p for p in picked)], key=seasons)[:KEEP - len(picked)]
    return in_order(rows, picked)


def main():
    with open(os.path.join(os.path.dirname(HERE), 'addon.xml'), encoding='utf-8') as f:
        dmm.USER_AGENT = 'DMM-Kodi/%s' % re.search(r'<addon\b[^>]*\bversion="([^"]+)"', f.read()).group(1)
    trackers.TRAKT_PAGE = 100
    real, asking, pages = dmm.http_json, [None], {}

    def recording(url, **kw):
        seen = kw.setdefault('response_headers', {})
        for attempt in range(4):
            try:
                answer = real(url, **kw)
                break
            except dmm.HttpError as e:  # Trakt's Cloudflare answers 429 'error code: 1015' now and then
                if e.status != 429 or attempt == 3:
                    raise
                print('  %s: HTTP 429, trying again in 45 s' % url.split('?')[0])
                time.sleep(45)
        pages.setdefault(asking[0], []).append(
            (answer[1], {k: v for k, v in seen.items() if k.startswith('x-pagination')}))
        return answer
    dmm.http_json = recording

    for service in trackers.PATHS:
        token = os.environ.get('%s_ACCESS_TOKEN' % service.upper())
        if not token:
            print('%s: skipped, no %s_ACCESS_TOKEN' % (service, service.upper()))
            continue
        get = trackers.client(service, {'accessToken': token,
                                        'clientId': os.environ.get('%s_CLIENT_ID' % service.upper())})
        for name, path in trackers.PATHS[service].items():
            asking[0] = (service, name)
            get(path)

    every = {key: [r for data, _ in answers for r in rows_of(data, key[1])] for key, answers in pages.items()}
    kept = {'movies': set(), 'shows': set()}  # what Trakt's fixtures keep
    for (service, name), answers in pages.items():  # Trakt's first
        rows = every[(service, name)]
        if name in ('movies', 'shows'):
            missing = [r for r in rows if not imdb(r)]
            print('%s %s: %d rows, %d without ids.imdb %s' % (
                service, name, len(rows), len(missing),
                [(r.get('movie') or r.get('show') or {}).get('title') for r in missing][:5] or ''))
        for page, (data, _) in enumerate(answers, 1):
            if name in ('movies', 'shows'):
                # Trakt first, from all of Simkl; Simkl then from what was kept of Trakt, so the union tests overlap.
                other = {imdb(r) for r in every.get(('simkl', name), [])} if service == 'trakt' else kept[name]
                keep = (pick_films(rows_of(data, name), other) if name == 'movies'
                        else pick_shows(service, rows_of(data, name), other))
                if service == 'trakt':
                    kept[name] |= {imdb(r) for r in keep}
                data = keep if isinstance(data, list) else dict(data, **{name: keep})
            fixture = '%s-%s%s.json' % (service, name, '-%d' % page if page > 1 else '')
            with open(os.path.join(FIXTURES, fixture), 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
                f.write('\n')
            print('  %s' % fixture)
    trakt_pages = {name: [h for _, h in answers] for (service, name), answers in pages.items()
                   if service == 'trakt' and any(h for _, h in answers)}
    if trakt_pages:
        with open(os.path.join(FIXTURES, 'trakt-pages.json'), 'w', encoding='utf-8') as f:
            json.dump(trakt_pages, f, indent=2)
            f.write('\n')
        print('  trakt-pages.json')
    return 0 if pages else 1


if __name__ == '__main__':
    sys.exit(main())
