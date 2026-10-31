"""What the addon knows about DMM and Cinemeta, kept free of Kodi so it can be tested anywhere.

Metadata (posters, plots, seasons) comes from Cinemeta, the catalogue Stremio itself uses, the same
one a DMM Cast install in Stremio relies on. Streams, the library and playback come from the
member's own DMM Cast addons, which DMM hands Kodi when it is linked (see /api/kodi/*).
"""
import datetime
import json
import re
import struct
import urllib.error
import urllib.parse
import urllib.request
import zlib
from concurrent.futures import ThreadPoolExecutor

CINEMETA = 'https://v3-cinemeta.strem.io'
USER_AGENT = 'DMM-Kodi/1.0'
TIMEOUT = 20

SERVICE_CODES = {'rd': 'RD', 'ad': 'AD', 'tb': 'TB', 'pm': 'PM', 'oc': 'OC', 'dl': 'DL'}


class HttpError(Exception):
    def __init__(self, status, message, body=None):
        super().__init__(message)
        self.status = status
        self.body = body


def http_json(url, data=None, headers=None, method=None, timeout=TIMEOUT):
    """GET (or POST `data` as JSON) and decode JSON; HttpError carries the status and any JSON body."""
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(url, data=body, method=method)
    req.add_header('User-Agent', USER_AGENT)
    req.add_header('Accept', 'application/json')
    if body is not None:
        req.add_header('Content-Type', 'application/json')
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        try:
            parsed = json.loads(e.read() or b'null')
        except ValueError:
            parsed = None
        message = (parsed or {}).get('error') if isinstance(parsed, dict) else None
        raise HttpError(e.code, message or 'HTTP %d' % e.code, parsed)
    except (urllib.error.URLError, OSError, ValueError) as e:
        raise HttpError(0, str(getattr(e, 'reason', e)))


def parallel(fn, items):
    """fn over items at once; an item that raises yields its exception instead of failing the rest."""
    def safe(item):
        try:
            return fn(item)
        except Exception as e:  # noqa: BLE001 - reported per item by the caller
            return e
    items = list(items)
    if not items:
        return []
    with ThreadPoolExecutor(max_workers=min(8, len(items))) as pool:
        return list(pool.map(safe, items))


# ---------------------------------------------------------------- Cinemeta

def _extra(params):
    parts = ['%s=%s' % (k, urllib.parse.quote(str(v), safe='')) for k, v in params.items() if v not in (None, '')]
    return ('/' + '&'.join(parts)) if parts else ''


def catalog(kind, catalog_id, genre=None, search=None, skip=0):
    """One Cinemeta catalogue page; `kind` is 'movie' or 'series'."""
    extra = _extra({'genre': genre, 'search': search, 'skip': skip or None})
    _, data = http_json('%s/catalog/%s/%s%s.json' % (CINEMETA, kind, catalog_id, extra))
    return [m for m in (data or {}).get('metas', []) if str(m.get('id', '')).startswith('tt')]


def meta(kind, imdb_id):
    _, data = http_json('%s/meta/%s/%s.json' % (CINEMETA, kind, imdb_id))
    return (data or {}).get('meta') or {}


def genres(kind):
    _, data = http_json('%s/manifest.json' % CINEMETA)
    for cat in (data or {}).get('catalogs', []):
        if cat.get('type') == kind and cat.get('id') == 'top':
            return cat.get('genres', [])
    return []


def search(query):
    """Films and shows for one query, best matches first across both kinds."""
    movies, shows = parallel(lambda kind: catalog(kind, 'top', search=query), ['movie', 'series'])
    movies = movies if isinstance(movies, list) else []
    shows = shows if isinstance(shows, list) else []
    return hydrate(rank_results(query, movies, shows))


def hydrate(metas):
    """Search results and DMM's catalogues carry only a name and poster; fill in plot, rating and the rest."""
    def full(m):
        if m.get('description'):
            return m
        kind = 'series' if m.get('type') == 'series' else 'movie'
        got = meta(kind, m['id'])
        return dict(got, **{k: v for k, v in m.items() if v and k not in got}, type=kind) if got else m
    return [m if isinstance(r, Exception) else r for m, r in zip(metas, parallel(full, metas))]


def rank_results(query, movies, shows):
    """Exact title, then title starting with the query, then the rest, alternating films and shows."""
    q = query.strip().lower()

    def score(m):
        name = (m.get('name') or '').strip().lower()
        return 0 if name == q else 1 if name.startswith(q) else 2

    interleaved = []
    for i in range(max(len(movies), len(shows))):
        interleaved += [x for x in (movies[i:i + 1] + shows[i:i + 1])]
    seen, out = set(), []
    for m in sorted(interleaved, key=score):
        key = (m.get('type'), m.get('id'))
        if key not in seen:
            seen.add(key)
            out.append(m)
    return out


def bigger(url, size='medium'):
    """metahub art at a size worth showing on a TV; anything else unchanged."""
    return re.sub(r'(images\.metahub\.space/(?:poster|background|logo)/)small/', r'\1%s/' % size, url or '')


def year_of(m):
    return str(m.get('year') or m.get('releaseInfo') or '')[:4]


def released_after_today(date_str, today=None):
    today = today or datetime.date.today()
    try:
        return datetime.date.fromisoformat((date_str or '')[:10]) > today
    except ValueError:
        return False


def title_label(m, today=None):
    """'Dune (2021)'; a show shows its run ('2011–2019'); unreleased titles say when, in grey."""
    name = m.get('name') or 'Untitled'
    years = (m.get('releaseInfo') or '') if m.get('type') == 'series' else year_of(m)
    years = years.replace('-', '–').rstrip()
    label = '%s (%s)' % (name, years) if years else name
    if released_after_today(m.get('released'), today):
        label = '[COLOR grey][I]%s · out %s[/I][/COLOR]' % (label, m['released'][:10])
    return label


def runtime_seconds(runtime):
    m = re.search(r'(\d+)\s*min', runtime or '')
    if m:
        return int(m.group(1)) * 60
    h = re.search(r'(\d+)\s*h', runtime or '')
    return int(h.group(1)) * 3600 if h else 0


def info_of(m):
    """Cinemeta meta to Kodi video info."""
    rating = m.get('imdbRating')
    try:
        rating = float(rating) if rating else 0.0
    except ValueError:
        rating = 0.0
    return {
        'mediatype': 'tvshow' if m.get('type') == 'series' else 'movie',
        'title': m.get('name') or '',
        'year': int(year_of(m)) if year_of(m).isdigit() else 0,
        'plot': m.get('description') or '',
        'genre': m.get('genres') or m.get('genre') or [],
        'rating': rating,
        'director': m.get('director') or [],
        'writer': m.get('writer') or [],
        'cast': m.get('cast') or [],
        'duration': runtime_seconds(m.get('runtime')),
        'premiered': (m.get('released') or '')[:10],
        'country': [m['country']] if isinstance(m.get('country'), str) else (m.get('country') or []),
        'imdb': m.get('id') or m.get('imdb_id') or '',
    }


def art_of(m):
    poster = bigger(m.get('poster'))
    art = {'poster': poster, 'thumb': poster, 'fanart': bigger(m.get('background')),
           'clearlogo': bigger(m.get('logo'))}
    return {k: v for k, v in art.items() if v}


def seasons_of(meta_obj):
    """Season numbers with their episode counts, specials (season 0) last."""
    counts = {}
    for v in meta_obj.get('videos') or []:
        s = v.get('season')
        if isinstance(s, int):
            counts[s] = counts.get(s, 0) + 1
    return sorted(counts.items(), key=lambda kv: (kv[0] == 0, kv[0]))


def episodes_of(meta_obj, season):
    eps = [v for v in meta_obj.get('videos') or [] if v.get('season') == season]
    return sorted(eps, key=lambda v: v.get('episode') or v.get('number') or 0)


def episode_label(v, today=None):
    num = v.get('episode') or v.get('number') or 0
    label = '%dx%02d. %s' % (v.get('season') or 0, num, v.get('name') or v.get('title') or 'Episode %d' % num)
    if released_after_today(v.get('released') or v.get('firstAired'), today):
        label = '[COLOR grey][I]%s[/I][/COLOR]' % label
    return label


# ---------------------------------------------------------------- DMM Cast streams

_EMOJI = re.compile('[\U0001F000-\U0001FAFF☀-➿️‍⭐⬆↔-⇿]')


def strip_emoji(text):
    """Kodi's skin fonts have no emoji: they draw as empty boxes. Flags become their country letters."""
    text = re.sub('[\U0001F1E6-\U0001F1FF]{2}',
                  lambda f: ''.join(chr(ord(c) - 0x1F1E6 + 65) for c in f.group(0)), text or '')
    return re.sub(r'[ \t]{2,}', ' ', _EMOJI.sub('', text)).strip()


def unwrap_filename(lines):
    """DMM splits a filename over 60 characters in half with '-\\n' (formatStremioStreamTitle); join it back."""
    if len(lines) >= 2 and lines[0].endswith('-'):
        a, b = lines[0][:-1], lines[1]
        if len(a) + len(b) > 60 and abs(len(a) - len(b)) <= 1:
            return [a + b] + lines[2:]
    return lines


def parse_streams(service, data):
    """A DMM Cast stream answer split into playable sources, the cast-a-release link and notices."""
    sources, notices, cast_url = [], [], None
    for s in (data or {}).get('streams') or []:
        hints = s.get('behaviorHints') or {}
        if s.get('url'):
            lines = unwrap_filename((s.get('title') or '').split('\n'))
            credit = lines[-1] if lines and 'DMM Cast' in lines[-1] else ''
            body = lines[:-1] if credit else lines
            sources.append({
                'service': service,
                'url': s['url'],
                'quality': strip_emoji(s.get('name') or ''),
                'filename': body[0] if body else '',
                'details': strip_emoji(' '.join(body[1:])),
                'yours': '(Yours)' in credit,
                'group': hints.get('bingeGroup', ''),
            })
        elif str(hints.get('bingeGroup', '')).endswith(':cast'):
            cast_url = s.get('externalUrl')
        else:
            notices.append({'service': service, 'title': strip_emoji(s.get('name') or s.get('title') or ''),
                            'text': strip_emoji(s.get('title') or s.get('description') or ''),
                            'url': s.get('externalUrl')})
    return sources, notices, cast_url


def order_sources(sources):
    """The member's own casts first, then everyone else's, each in DMM's order (stable)."""
    return sorted(sources, key=lambda s: not s['yours'])


def source_label(s):
    """No colour here: the row's badge icon carries the service colour, which on text would sink into the
    skin's focus bar (blue on blue in The Loop)."""
    code = '[B]%s[/B]' % SERVICE_CODES.get(s['service'], s['service'].upper())
    parts = [s['quality'].replace(' • ', ' · ')]
    if s['yours']:
        parts.append('your cast')
    return '%s  %s' % (code, ' · '.join(p for p in parts if p))


def source_label2(s):
    return ' · '.join(p for p in (s['filename'], s['details'].replace(' • ', ' · ')) if p)


def stream_id(kind, imdb_id, season=None, episode=None):
    return '%s:%s:%s' % (imdb_id, season, episode) if kind == 'series' else imdb_id


def streams(account, kind, sid):
    _, data = http_json('%s/stream/%s/%s.json' % (account['addon'], kind, urllib.parse.quote(sid, safe=':')))
    return data


# ---------------------------------------------------------------- QR code PNG

def qr_png(matrix, scale=10, border=4):
    """A black-on-white PNG of a QR module matrix (rows of 0/1), with the quiet zone QR readers need."""
    n = len(matrix)
    size = (n + 2 * border) * scale
    rows = []
    for y in range(size):
        my = y // scale - border
        row = bytearray([0])  # filter type 0
        for x in range(size):
            mx = x // scale - border
            dark = 0 <= my < n and 0 <= mx < n and matrix[my][mx]
            row.append(0 if dark else 255)
        rows.append(bytes(row))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(b''.join(rows), 9)) + chunk(b'IEND', b''))
