"""What the member already watched, from their own Trakt and Simkl history, kept free of Kodi so it can be tested.

DMM links each tracker the way it links Kodi (/api/kodi/tracker/*) and holds the client secrets; the addon then
reads the history straight from the tracker with its own read-only grant, at most every few minutes, and keeps it
in one JSON file per tracker. Scrobbling stays with Kodi's own Trakt and Simkl addons (see dmm.trakt_ids).
"""
import datetime
import json
import os
import time
import urllib.parse

from resources.lib import dmm

NAMES = {'trakt': 'Trakt', 'simkl': 'Simkl'}
ACTIVATE = {'trakt': 'trakt.tv/activate', 'simkl': 'simkl.com/pin'}
API = {'trakt': 'https://api.trakt.tv', 'simkl': 'https://api.simkl.com'}
# DMM's own Trakt app, public by nature: the website ships it in its browser bundle. DMM's poll may name another.
TRAKT_CLIENT_ID = '8a7455d06804b07fa25e27454706c6f2107b6fe5ed2ad805eff3b456a17e79f0'
CHECK_EVERY = 300
# A live Trakt token lasted 7 days (2026-11-09) though Trakt's docs say 24 hours; an hour's margin suits both.
REFRESH_WITHIN = 3600
# Trakt's most per page; it may send fewer (100 with extended=progress) and says how many pages there are.
TRAKT_PAGE = 250

# What each tracker is asked, by name; the recorded fixtures are named '<service>-<name>.json'.
PATHS = {
    'trakt': {
        'activity': '/sync/last_activities',
        'movies': '/sync/watched/movies',
        # Since 2026-06-30 only extended=progress brings the seasons (trakt/trakt-api#775); show.aired_episodes
        # comes either way.
        'shows': '/sync/watched/shows?extended=progress',
    },
    'simkl': {
        'activity': '/sync/activities',
        # The default extent carries movie.ids.imdb and last_watched_at (live, 2026-11-09); ids_only drops the date.
        'movies': '/sync/all-items/movies/completed',
        # extended=full carries show.ids.imdb (live, 2026-11-09), so no ids_only call to join on ids.simkl.
        # Anime is left out: Simkl numbers its episodes per anime entry, not by IMDb's seasons.
        'shows': '/sync/all-items/shows?extended=full&include_all_episodes=yes&episode_watched_at=yes',
    },
}


def seconds(iso):
    try:
        return datetime.datetime.fromisoformat((iso or '').replace('Z', '+00:00')).timestamp()
    except ValueError:
        return 0


def fresh_grant(service, grant, origin, now=None):
    """The grant, renewed through DMM when it expires within the hour; None once the tracker refused it."""
    now = time.time() if now is None else now
    if seconds(grant.get('expiresAt')) - now > REFRESH_WITHIN:
        return grant
    try:
        _, body = dmm.http_json(origin + '/api/kodi/tracker/refresh',
                                data={'service': service, 'refreshToken': grant.get('refreshToken')})
    except dmm.HttpError as e:
        # Anything but a refusal leaves the old token, which may still work; the next listing tries again.
        return None if e.status == 401 else grant
    return dict(grant, **(body or {}))


def client(service, grant):
    """GET a path of the tracker's API as the member, returning the decoded JSON."""
    token = 'Bearer %s' % grant['accessToken']
    if service == 'trakt':
        headers = {'Authorization': token, 'Content-Type': 'application/json', 'trakt-api-version': '2',
                   'trakt-api-key': grant.get('clientId') or TRAKT_CLIENT_ID}

        def trakt(path):
            if not path.startswith('/sync/watched/'):
                return dmm.http_json(API[service] + path, headers=headers)[1]
            # Paged since 2026-06-30: asked without page and limit, Trakt sends the first 100 alone.
            rows = []
            for page in range(1, 201):  # ponytail: stops at 50,000 films or shows, far past any history seen
                seen = {}
                url = '%s%s%spage=%d&limit=%d' % (API[service], path, '&' if '?' in path else '?', page, TRAKT_PAGE)
                data = dmm.http_json(url, headers=headers, response_headers=seen)[1] or []
                rows += data
                # Trakt asks apps to stop at an empty page too, in case the count is ever missing.
                if not data or page >= int(seen.get('x-pagination-page-count') or page + 1):
                    break
            return rows
        return trakt
    if not grant.get('clientId'):
        raise ValueError('no Simkl client id: DMM sent none and the simkl_client_id setting is empty')
    query = urllib.parse.urlencode({'client_id': grant['clientId'], 'app-name': 'DMM Kodi',
                                    'app-version': dmm.USER_AGENT.rpartition('/')[2]})
    return lambda path: dmm.http_json('%s%s%s%s' % (API[service], path, '&' if '?' in path else '?', query),
                                      headers={'Authorization': token})[1]


def activity(service, data):
    """A token that changes whenever the member's watched history may have."""
    data = data or {}
    if service == 'trakt':
        return '%s|%s' % ((data.get('movies') or {}).get('watched_at'), (data.get('episodes') or {}).get('watched_at'))
    # Not `all`: it also moves on ratings, paused playback and settings, and each move costs a whole-library pull.
    movies, shows = data.get('movies') or {}, data.get('tv_shows') or {}
    return json.dumps([movies.get(k) for k in ('completed', 'removed_from_list')] +
                      [shows.get(k) for k in ('watching', 'completed', 'hold', 'dropped', 'plantowatch',
                                              'removed_from_list')])


def parse(service, movies, shows):
    """Both answers as {'movies': {imdb: watched_at}, 'shows': {imdb: {'aired': n|None, 'episodes': {'S:E': at}}}}."""
    out = {'movies': {}, 'shows': {}}
    if service == 'simkl':
        movies, shows = (movies or {}).get('movies'), (shows or {}).get('shows')
    for row in movies or []:
        imdb = ((row.get('movie') or {}).get('ids') or {}).get('imdb')
        if imdb:
            out['movies'][imdb] = row.get('last_watched_at')
    for row in shows or []:
        show = row.get('show') or {}
        imdb = (show.get('ids') or {}).get('imdb')
        if not imdb:
            continue
        if service == 'trakt':
            aired = show.get('aired_episodes')
        else:  # Simkl's total counts episodes yet to air
            total = row.get('total_episodes_count')
            aired = total - (row.get('not_aired_episodes_count') or 0) if total else None
        out['shows'][imdb] = {'aired': aired, 'episodes': {
            '%d:%d' % (s['number'], e['number']): e.get('last_watched_at') or e.get('watched_at')
            for s in row.get('seasons') or [] for e in s.get('episodes') or []}}
    return out


def history(service, grant, path, now=None, log=print):
    """The tracker's watched history from the file at `path`, read again from the tracker when it is over five
    minutes old and its activity moved. Never raises: a failure is logged and the last history stands."""
    now = time.time() if now is None else now
    try:
        with open(path, encoding='utf-8') as f:
            cache = json.load(f)
    except (OSError, ValueError):
        cache = {}
    if now - cache.get('checked', 0) < CHECK_EVERY:
        return cache
    try:
        get = client(service, grant)
        token = activity(service, get(PATHS[service]['activity']))
        if 'movies' not in cache or token != cache.get('activity'):
            cache = dict(parse(service, get(PATHS[service]['movies']), get(PATHS[service]['shows'])), activity=token)
    except Exception as e:  # noqa: BLE001 - an unreachable tracker or an answer we can't read must not fail the list
        log('DMM: %s history not read: %s' % (NAMES[service], e))
    cache = dict(cache, checked=now)  # a failure tries again in five minutes, not on every listing
    try:
        with open(path + '.tmp', 'w', encoding='utf-8') as f:
            json.dump(cache, f)
        os.replace(path + '.tmp', path)
    except OSError as e:
        log('DMM: %s history not saved: %s' % (NAMES[service], e))
    return cache


def later(a, b):
    return max(filter(None, (a, b)), default=None)


def union(histories):
    """Every linked tracker's history as one: watched on either counts."""
    out = {'movies': {}, 'shows': {}}
    for h in histories:
        for imdb, at in (h.get('movies') or {}).items():
            out['movies'][imdb] = later(out['movies'].get(imdb), at)
        for imdb, show in (h.get('shows') or {}).items():
            mine = out['shows'].setdefault(imdb, {'aired': None, 'episodes': {}})
            mine['aired'] = max(filter(None, (mine['aired'], show.get('aired'))), default=None)
            for key, at in (show.get('episodes') or {}).items():
                mine['episodes'][key] = later(mine['episodes'].get(key), at)
    return out


def played(seen, key):
    if key not in seen:
        return {}
    at = seen[key]
    return dict(playcount=1, **({'lastplayed': at[:19].replace('T', ' ')} if at else {}))


def marks(watched, info, videos=None, today=None):
    """Extra Kodi info for one list row: playcount 1 (and lastplayed) on a watched film or episode, or on a show
    or season whose aired episodes are all watched, else 'episodes': (watched, aired) for a part-watched one.
    Nothing for anything unwatched, so what Kodi itself recorded as played on this TV stays. A show counts its
    aired episodes from the tracker; a season from Cinemeta's `videos`, leaving out episodes yet to air."""
    imdb, kind = info.get('imdb'), info.get('mediatype')
    if kind == 'movie':
        return played(watched['movies'], imdb)
    episodes = (watched['shows'].get(imdb) or {}).get('episodes') or {}
    if kind == 'episode':
        return played(episodes, '%d:%d' % (info['season'], info['episode']))
    if kind == 'tvshow':
        seen = sum(not key.startswith('0:') for key in episodes)  # specials stay out, as from the aired counts
        aired = (watched['shows'].get(imdb) or {}).get('aired')
    elif kind == 'season':
        numbers = [v.get('episode') or v.get('number') or 0 for v in videos or [] if v.get('season') == info['season']
                   and not dmm.released_after_today(v.get('released') or v.get('firstAired'), today)]
        seen, aired = sum('%d:%d' % (info['season'], n) in episodes for n in numbers), len(numbers)
    else:
        return {}
    if not seen:
        return {}
    return {'playcount': 1} if aired and seen >= aired else {'episodes': (seen, aired)}
