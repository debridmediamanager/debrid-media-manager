#!/usr/bin/env python3
"""Record what Trakt and Simkl answer the addon, replacing the trakt-* and simkl-* fixtures built from their docs.

    TRAKT_ACCESS_TOKEN=... SIMKL_ACCESS_TOKEN=... SIMKL_CLIENT_ID=... \\
        python3 kodi/plugin.video.dmm/tests/record_trackers.py

TRAKT_CLIENT_ID overrides DMM's public Trakt client id. It asks exactly what the addon asks (trackers.PATHS) and
writes the answers as they come: an account's watch history and no token. The repository is public, so record a
test account. Then update fixtures/README.md and the expectations in test_trackers.py.
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from resources.lib import dmm, trackers  # noqa: E402


def main():
    with open(os.path.join(os.path.dirname(HERE), 'addon.xml'), encoding='utf-8') as f:
        dmm.USER_AGENT = 'DMM-Kodi/%s' % re.search(r'<addon\b[^>]*\bversion="([^"]+)"', f.read()).group(1)
    recorded = 0
    for service in trackers.PATHS:
        token = os.environ.get('%s_ACCESS_TOKEN' % service.upper())
        if not token:
            print('%s: skipped, no %s_ACCESS_TOKEN' % (service, service.upper()))
            continue
        get = trackers.client(service, {'accessToken': token,
                                        'clientId': os.environ.get('%s_CLIENT_ID' % service.upper())})
        answers = {}
        for name, path in trackers.PATHS[service].items():
            answers[name] = get(path)
            with open(os.path.join(HERE, 'fixtures', '%s-%s.json' % (service, name)), 'w', encoding='utf-8') as f:
                json.dump(answers[name], f, indent=2, ensure_ascii=False)
                f.write('\n')
            print('%s-%s.json  %s' % (service, name, path))
            recorded += 1
        # Whether every row carries the IMDb id the addon looks titles up by (Simkl's extended=full included).
        for name, kind in (('movies', 'movie'), ('shows', 'show')):
            rows = answers[name] if isinstance(answers[name], list) else (answers[name] or {}).get(name) or []
            missing = [r[kind].get('title') for r in rows if not (r.get(kind, {}).get('ids') or {}).get('imdb')]
            print('  %d of %d %s without ids.imdb %s' % (len(missing), len(rows), name, missing[:5] or ''))
        parsed = trackers.parse(service, answers['movies'], answers['shows'])
        print('  parsed %d films and %d shows' % (len(parsed['movies']), len(parsed['shows'])))
    return 0 if recorded else 1


if __name__ == '__main__':
    sys.exit(main())
