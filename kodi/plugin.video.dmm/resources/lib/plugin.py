"""The Kodi side: menus, the pairing screen, the source picker and playback.

Built as an ordinary Kodi folder addon on purpose, so it follows the member's skin and works in
widgets. Every failure says what to do next, no folder opens empty without saying why, and nothing
interrupts a first launch: linking is offered where it is needed, when playing.
"""
import json
import os
import sys
import time
import urllib.parse

import xbmc
import xbmcaddon
import xbmcgui
import xbmcplugin
import xbmcvfs

from resources.lib import dmm

ADDON = xbmcaddon.Addon()
ADDON_ID = ADDON.getAddonInfo('id')
NAME = 'DMM'
ICON = ADDON.getAddonInfo('icon')
FANART = ADDON.getAddonInfo('fanart')
PROFILE = xbmcvfs.translatePath(ADDON.getAddonInfo('profile'))
MEDIA = os.path.join(xbmcvfs.translatePath(ADDON.getAddonInfo('path')), 'resources', 'media')

BASE = sys.argv[0] if sys.argv else 'plugin://%s/' % ADDON_ID
HANDLE = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].lstrip('-').isdigit() else -1

# Kodi 20+ sets video info through InfoTagVideo; ListItem.setInfo is deprecated there.
KODI_MAJOR = int(xbmc.getInfoLabel('System.BuildVersion').split('.')[0] or 19)


# ---------------------------------------------------------------- settings and link state

def origin():
    return (ADDON.getSetting('dmm_origin') or 'https://debridmediamanager.com').rstrip('/')


def link():
    try:
        return json.loads(ADDON.getSetting('link') or 'null') or {}
    except ValueError:
        return {}


def accounts():
    return link().get('accounts') or []


def sponsor():
    return link().get('sponsor')


def save_link(value):
    ADDON.setSetting('link', json.dumps(value) if value else '')
    ADDON.setSetting('sponsor_token', '')


def url(**params):
    return BASE + '?' + urllib.parse.urlencode({k: v for k, v in params.items() if v is not None})


def notify(message, time_ms=4000):
    xbmcgui.Dialog().notification(NAME, message, ICON, time_ms)


def explain(error):
    """A failure in words a person can act on."""
    if isinstance(error, dmm.HttpError):
        if error.status == 0:
            return "Couldn't reach the server (%s). Check this Kodi's internet connection and try again." % error
        if error.status == 429:
            return 'DMM asked to slow down. Wait a few seconds and try again.'
        if error.status >= 500:
            return 'DMM had a problem answering (HTTP %d). Try again in a minute.' % error.status
    return str(error)


# ---------------------------------------------------------------- list items

def set_info(li, info):
    if KODI_MAJOR >= 20:
        tag = li.getVideoInfoTag()
        tag.setMediaType(info.get('mediatype', 'video'))
        if info.get('title'):
            tag.setTitle(info['title'])
        if info.get('tvshowtitle'):
            tag.setTvShowTitle(info['tvshowtitle'])
        if info.get('year'):
            tag.setYear(info['year'])
        if info.get('plot'):
            tag.setPlot(info['plot'])
        if info.get('genre'):
            tag.setGenres(list(info['genre']))
        if info.get('rating'):
            tag.setRating(info['rating'], 0, 'imdb', True)
        if info.get('director'):
            tag.setDirectors(list(info['director']))
        if info.get('writer'):
            tag.setWriters(list(info['writer']))
        if info.get('cast'):
            tag.setCast([xbmc.Actor(name) for name in info['cast']])
        if info.get('duration'):
            tag.setDuration(info['duration'])
        if info.get('premiered'):
            tag.setPremiered(info['premiered'])
            tag.setFirstAired(info['premiered'])
        if info.get('country'):
            tag.setCountries(list(info['country']))
        if info.get('season') is not None:
            tag.setSeason(info['season'])
        if info.get('episode') is not None:
            tag.setEpisode(info['episode'])
        if info.get('imdb'):
            tag.setUniqueIDs({'imdb': info['imdb']}, 'imdb')
            tag.setIMDBNumber(info['imdb'])
    else:
        legacy = {k: v for k, v in info.items() if k not in ('imdb', 'cast')}
        legacy['castandrole'] = [(n, '') for n in info.get('cast') or []]
        if info.get('imdb'):
            legacy['imdbnumber'] = info['imdb']
        li.setInfo('video', legacy)


def icon(name):
    """One of the skin's own Default*.png icons, so menus look native on every skin."""
    return {'icon': name, 'thumb': name, 'fanart': FANART}


def badge(service):
    """The service's identity colour as a solid badge: colour on text would vanish on a skin's focus bar."""
    path = os.path.join(MEDIA, '%s.png' % service)
    return {'icon': path, 'thumb': path, 'fanart': FANART}


def item(label, plot='', art=None, label2=''):
    li = xbmcgui.ListItem(label, label2)
    li.setArt(art or {'icon': ICON, 'thumb': ICON, 'fanart': FANART})
    if plot:
        set_info(li, {'mediatype': 'video', 'plot': plot})
    return li


def add_folder(label, plot, target, art=None, label2='', menu=None):
    li = item(label, plot, art, label2)
    if menu:
        li.addContextMenuItems(menu)
    xbmcplugin.addDirectoryItem(HANDLE, target, li, isFolder=True)


def add_action(label, plot, target, art=None):
    """A row that does something rather than open a folder (Kodi runs it like a script)."""
    li = item(label, plot, art)
    li.setProperty('IsPlayable', 'false')
    xbmcplugin.addDirectoryItem(HANDLE, target, li, isFolder=False)


def end(content='', cache=True, sort=False, category=None):
    xbmcplugin.setPluginCategory(HANDLE, category or ADDON.getAddonInfo('name'))
    if content:
        xbmcplugin.setContent(HANDLE, content)
    if sort:
        xbmcplugin.addSortMethod(HANDLE, xbmcplugin.SORT_METHOD_LABEL)
    xbmcplugin.endOfDirectory(HANDLE, cacheToDisc=cache)


def empty_note(label, plot):
    """An empty folder says why, instead of opening blank."""
    add_action(label, plot, url(action='noop'))


def title_menu(m):
    """Context entries for a film or show row: few, and only the ones that can work right now."""
    kind = 'series' if m.get('type') == 'series' else 'movie'
    entries = []
    if kind == 'movie' and accounts():
        entries.append(('Choose source', 'PlayMedia(%s)' % url(action='play', kind='movie', id=m['id'], choose=1)))
        entries.append(('Cast a release from phone', 'RunPlugin(%s)' % url(action='cast', kind='movie', id=m['id'])))
    if sponsor():
        entries.append(('Add to DMM Wanted', 'RunPlugin(%s)' % url(
            action='want', id=m['id'], kind='show' if kind == 'series' else 'movie', title=m.get('name', ''))))
    return entries


def add_title(m):
    li = xbmcgui.ListItem(dmm.title_label(m))
    set_info(li, dmm.info_of(m))
    li.setArt(dmm.art_of(m))
    li.addContextMenuItems(title_menu(m))
    if m.get('type') == 'series':
        xbmcplugin.addDirectoryItem(HANDLE, url(action='show', id=m['id']), li, isFolder=True)
    else:
        li.setProperty('IsPlayable', 'true')
        xbmcplugin.addDirectoryItem(HANDLE, url(action='play', kind='movie', id=m['id']), li, isFolder=False)


# ---------------------------------------------------------------- menus

def home(_):
    linked = accounts()
    if not link():
        add_action('[B]Link this Kodi[/B]',
                   'Connect your Debrid Media Manager account by scanning a code with your phone. '
                   'Playing needs it; browsing and search work without it.',
                   url(action='link'), icon('DefaultAddonService.png'))
    # An action, not a folder: Kodi rolls a folder that returns nothing back over the results we open.
    add_action('Search', 'Find a film or show. The keyboard opens straight away.', url(action='search'),
               icon('DefaultAddonsSearch.png'))
    add_folder('Movies', 'Popular, new and featured films, and films by genre.', url(action='kind', kind='movie'),
               icon('DefaultMovies.png'))
    add_folder('TV Shows', 'Popular, new and featured shows, and shows by genre.', url(action='kind', kind='series'),
               icon('DefaultTVShows.png'))
    if linked:
        add_folder('My casts', 'Films and shows you cast on DMM, ready to play.', url(action='casts'),
                   icon('DefaultFavourites.png'))
        for a in linked:
            add_folder('%s library' % a['name'],
                       'Everything in your %s account, file by file, as DMM sees it.' % a['name'],
                       url(action='library', service=a['service']),
                       badge(a['service']))
    if sponsor():
        add_folder('Wanted', 'Titles your zurg fetches for you. Add from any film or show: '
                             'Context menu → Add to DMM Wanted.', url(action='wanted'), icon('DefaultPlaylist.png'))
    if link():
        add_folder('Account', 'What this Kodi is linked to, link more accounts, or unlink it.',
                   url(action='account'), icon('DefaultUser.png'))
    end(cache=False)


def kind_menu(p):
    kind = p['kind']
    noun = 'films' if kind == 'movie' else 'shows'
    year = str(time.localtime().tm_year)
    add_folder('Popular', 'The %s people are watching now.' % noun, url(action='catalog', kind=kind, cat='top'),
               icon('DefaultRecentlyAddedMovies.png'))
    add_folder('New', 'Popular %s from %s.' % (noun, year), url(action='catalog', kind=kind, cat='year', genre=year),
               icon('DefaultYear.png'))
    add_folder('Featured', 'Highly rated %s.' % noun, url(action='catalog', kind=kind, cat='imdbRating'),
               icon('DefaultMusicTop100.png'))
    add_folder('Genres', 'Popular %s by genre.' % noun, url(action='genres', kind=kind), icon('DefaultGenre.png'))
    end(category='Movies' if kind == 'movie' else 'TV Shows')


def genres_menu(p):
    kind = p['kind']
    try:
        names = dmm.genres(kind)
    except dmm.HttpError as e:
        return fail(e)
    for g in names:
        add_folder(g, '', url(action='catalog', kind=kind, cat='top', genre=g), icon('DefaultGenre.png'))
    if not names:
        empty_note('No genres listed', 'Cinemeta returned no genres. Try Popular instead.')
    end(category='Genres')


def catalog_list(p):
    kind, skip = p['kind'], int(p.get('skip') or 0)
    try:
        metas = dmm.catalog(kind, p['cat'], genre=p.get('genre'), skip=skip)
    except dmm.HttpError as e:
        return fail(e)
    for m in metas:
        m.setdefault('type', kind)
        add_title(m)
    if metas:
        page = skip // max(len(metas), 1) + 2
        add_folder('Next page (%d)' % page, '', url(action='catalog', kind=kind, cat=p['cat'],
                                                  genre=p.get('genre'), skip=skip + len(metas)))
    else:
        empty_note('Nothing here', 'Cinemeta returned no titles for this list.')
    end('movies' if kind == 'movie' else 'tvshows',
        category=p.get('genre') or {'top': 'Popular', 'imdbRating': 'Featured'}.get(p['cat'], p['cat']))


def search_list(p):
    query = p.get('q')
    if not query:
        query = xbmcgui.Dialog().input('Search films and shows', ADDON.getSetting('last_search'))
        if HANDLE >= 0:
            xbmcplugin.endOfDirectory(HANDLE, succeeded=False)
        if query:
            ADDON.setSetting('last_search', query)
            # Results live at their own URL, so Back from a title returns to them instead of the keyboard.
            xbmc.executebuiltin('Container.Update(%s)' % url(action='search', q=query))
        return
    try:
        results = dmm.search(query, origin())
    except dmm.HttpError as e:
        return fail(e)
    for m in results:
        add_title(m)
    if not results:
        empty_note('No films or shows match "%s"' % query, 'Try fewer words, or the original title.')
    end('videos', category='Search: %s' % query)


def show_seasons(p):
    try:
        m = dmm.meta('series', p['id'])
    except dmm.HttpError as e:
        return fail(e)
    art = dmm.art_of(m)
    for season, count in dmm.seasons_of(m):
        label = 'Specials' if season == 0 else 'Season %d' % season
        li = xbmcgui.ListItem(label, '%d episodes' % count)
        info = dmm.info_of(m)
        info.update({'mediatype': 'season', 'season': season, 'tvshowtitle': m.get('name', ''), 'title': label})
        set_info(li, info)
        li.setArt(art)
        xbmcplugin.addDirectoryItem(HANDLE, url(action='season', id=p['id'], season=season), li, isFolder=True)
    if not dmm.seasons_of(m):
        empty_note('No episodes listed yet', 'Cinemeta has no episodes for this show yet.')
    end('seasons', category=m.get('name'))


def season_episodes(p):
    season = int(p['season'])
    try:
        m = dmm.meta('series', p['id'])
    except dmm.HttpError as e:
        return fail(e)
    art = dmm.art_of(m)
    for v in dmm.episodes_of(m, season):
        num = v.get('episode') or v.get('number') or 0
        li = xbmcgui.ListItem(dmm.episode_label(v))
        set_info(li, {
            'mediatype': 'episode', 'title': v.get('name') or v.get('title') or '', 'tvshowtitle': m.get('name', ''),
            'season': season, 'episode': num, 'plot': v.get('overview') or v.get('description') or '',
            'premiered': (v.get('released') or v.get('firstAired') or '')[:10], 'imdb': p['id'],
        })
        li.setArt(dict(art, thumb=v.get('thumbnail') or art.get('poster', '')))
        li.setProperty('IsPlayable', 'true')
        play = dict(action='play', kind='series', id=p['id'], season=season, episode=num)
        menu = []
        if accounts():
            menu.append(('Choose source', 'PlayMedia(%s)' % url(choose=1, **play)))
            menu.append(('Cast a release from phone', 'RunPlugin(%s)' % url(
                action='cast', kind='series', id=p['id'], season=season, episode=num)))
        li.addContextMenuItems(menu)
        xbmcplugin.addDirectoryItem(HANDLE, url(**play), li, isFolder=False)
    if not dmm.episodes_of(m, season):
        empty_note('No episodes listed yet', 'Cinemeta has no episodes for this season yet.')
    end('episodes', category='%s · Season %d' % (m.get('name', ''), season))


def casts_list(_):
    """The member's casts across every linked account, one row per title."""
    pages = dmm.parallel(lambda job: dmm.http_json('%s/catalog/%s/%s.json' % job)[1],
                         [(a['addon'], kind, cat) for a in accounts() for kind, cat in cast_catalogs(a)])
    seen, rows = set(), []
    for page in pages:
        if isinstance(page, Exception):
            continue
        for m in (page or {}).get('metas') or []:
            if str(m.get('id', '')).startswith('tt') and (m.get('type'), m['id']) not in seen:
                seen.add((m.get('type'), m['id']))
                rows.append(m)
    for m in dmm.hydrate(rows):
        add_title(m)
    if not rows:
        failures = [p for p in pages if isinstance(p, Exception)]
        if failures and len(failures) == len(pages):
            return fail(failures[0])
        empty_note('Nothing cast yet', 'Films and shows you cast on DMM show up here. Anything else plays '
                                       'too: open it, and DMM lists the cached releases it knows of.')
    end('videos', category='My casts')


def cast_catalogs(account):
    prefix = '' if account['service'] == 'rd' else account['service'] + '-'
    return [('movie', prefix + 'casted-movies'), ('series', prefix + 'casted-shows')]


def find_account(service):
    return next((a for a in accounts() if a['service'] == service), None)


def library_list(p):
    a = find_account(p['service'])
    if not a:
        return fail('That account is no longer linked to this Kodi.')
    skip = int(p.get('skip') or 0)
    prefix = '' if a['service'] == 'rd' else a['service'] + '-'
    path = '%s/catalog/other/%scasted-other%s.json' % (a['addon'], prefix, '/skip=%d' % skip if skip else '')
    try:
        _, data = dmm.http_json(path)
    except dmm.HttpError as e:
        return fail(e)
    metas = (data or {}).get('metas') or []
    for m in metas:
        if ':notice:' in m.get('id', ''):
            add_action(dmm.strip_emoji(m.get('name', '')), dmm.strip_emoji(m.get('description', '')),
                       url(action='noop'))
            continue
        add_folder(m.get('name') or m['id'], '', url(action='libitem', service=a['service'], id=m['id']))
    if (data or {}).get('hasMore'):
        add_folder('Next page (%d)' % (skip // max(len(metas), 1) + 2), '',
                   url(action='library', service=a['service'], skip=skip + len(metas)))
    if not metas:
        empty_note('Your %s account is empty' % a['name'], 'Anything you add on DMM shows up here.')
    end('files', cache=False, category='%s library' % a['name'])


def library_item(p):
    a = find_account(p['service'])
    if not a:
        return fail('That account is no longer linked to this Kodi.')
    try:
        _, data = dmm.http_json('%s/meta/other/%s.json' % (a['addon'], urllib.parse.quote(p['id'], safe=':')))
    except dmm.HttpError as e:
        return fail(e)
    videos = ((data or {}).get('meta') or {}).get('videos') or []
    for v in videos:
        stream = next((s for s in v.get('streams') or [] if s.get('url')), None)
        if not stream:
            continue
        li = xbmcgui.ListItem(v.get('title') or v.get('id'))
        set_info(li, {'mediatype': 'video', 'title': v.get('title') or ''})
        li.setProperty('IsPlayable', 'true')
        xbmcplugin.addDirectoryItem(HANDLE, url(action='playurl', u=stream['url']), li, isFolder=False)
    if not videos:
        empty_note('No playable files', 'This item has no video files DMM can play.')
    end('files')


def account_menu(_):
    lk = link()
    for a in accounts():
        add_action('%s · linked' % a['name'], 'Plays through your %s account via DMM Cast.' % a['name'],
                   url(action='noop'), badge(a['service']))
    sp = lk.get('sponsor')
    if sp:
        add_action('Sponsor · %s' % sp.get('githubUsername', ''), 'Thank you. Your sponsorship adds the Wanted list.',
                   url(action='noop'), icon('DefaultUser.png'))
    add_action('Link again', 'Run linking again to add accounts you have since signed in to on DMM.',
               url(action='link'), icon('DefaultAddonService.png'))
    add_action('Unlink this Kodi', 'Forget the linked accounts on this Kodi. Your casts stay on DMM.',
               url(action='unlink'), icon('DefaultIconError.png'))
    add_action('Settings', 'Playback and server options.', url(action='settings'), icon('DefaultScript.png'))
    end(cache=False, category='Account')


def fail(error):
    xbmcgui.Dialog().ok(NAME, explain(error))
    xbmcplugin.endOfDirectory(HANDLE, succeeded=False)


# ---------------------------------------------------------------- QR screen (pairing and casting)

class QrScreen(xbmcgui.WindowDialog):
    """A full-screen card with a QR code and a short code, closed by Back. Drawn from code so it
    needs no skin XML and looks the same on every skin."""

    def __init__(self, heading, lines, code, link_url, qr_path):
        super().__init__()
        self.cancelled = False
        w, h = self.getWidth(), self.getHeight()
        dim = os.path.join(MEDIA, 'dim.png')
        self.addControl(xbmcgui.ControlImage(0, 0, w, h, dim))
        self.addControl(xbmcgui.ControlLabel(80, 70, w - 160, 60, '[B]%s[/B]' % heading, font='font_MainMenu',
                                             textColor='FFFFFFFF'))
        size = min(h - 260, 440)
        self.addControl(xbmcgui.ControlImage(w - size - 100, 160, size, size, qr_path))
        text = xbmcgui.ControlTextBox(80, 160, w - size - 260, 200, font='font30', textColor='FFDDDDDD')
        self.addControl(text)
        text.setText('\n'.join(lines))
        if code:
            self.addControl(xbmcgui.ControlLabel(80, 380, w - size - 260, 100, '[B]%s[/B]' % code,
                                                 font='font_MainMenu', textColor='FFFFFFFF'))
        self.status = xbmcgui.ControlLabel(80, h - 150, w - 160, 40, 'Waiting…', font='font13',
                                           textColor='FFAAAAAA')
        self.addControl(self.status)
        self.addControl(xbmcgui.ControlLabel(80, h - 100, w - 160, 40, link_url, font='font13',
                                             textColor='FF888888'))
        # Remote hints on screen, as Loop Guide does: the one thing a remote user needs to know.
        self.addControl(xbmcgui.ControlLabel(80, h - 60, w - 160, 40, 'BACK: cancel', font='font13',
                                             textColor='FF888888'))

    def onAction(self, action):
        if action.getId() in (xbmcgui.ACTION_NAV_BACK, xbmcgui.ACTION_PREVIOUS_MENU, xbmcgui.ACTION_STOP):
            self.cancelled = True
            self.close()


def qr_file(text, tag):
    import pyqrcode  # script.module.pyqrcode, from Kodi's own repository
    os.makedirs(PROFILE, exist_ok=True)
    for old in os.listdir(PROFILE):
        if old.startswith('qr-'):
            try:
                os.remove(os.path.join(PROFILE, old))
            except OSError:
                pass
    # A new name each time: Kodi caches textures by path.
    path = os.path.join(PROFILE, 'qr-%s-%d.png' % (tag, int(time.time())))
    with open(path, 'wb') as f:
        f.write(dmm.qr_png(pyqrcode.create(text, error='M').code))
    return path


def qr_wait(heading, lines, code, link_url, poll, interval, timeout):
    """Show the QR screen and call poll() every `interval` s until it returns something, Back, or timeout."""
    screen = QrScreen(heading, lines, code, link_url, qr_file(link_url, code.replace('-', '') or 'cast'))
    screen.show()
    monitor = xbmc.Monitor()
    deadline = time.time() + timeout
    result = None
    try:
        while not screen.cancelled and time.time() < deadline and not monitor.abortRequested():
            if monitor.waitForAbort(interval) or screen.cancelled:
                break
            try:
                result = poll()
            except dmm.HttpError as e:
                screen.status.setLabel('Still trying: %s' % explain(e))
                continue
            if result:
                break
            left = int(deadline - time.time())
            screen.status.setLabel('Waiting… (%d:%02d left)' % (left // 60, left % 60))
    finally:
        screen.close()
        del screen
    return result


def do_link(_=None):
    try:
        _, start = dmm.http_json(origin() + '/api/kodi/pair', data={})
    except dmm.HttpError as e:
        xbmcgui.Dialog().ok(NAME, explain(e))
        return False

    def poll():
        try:
            status, body = dmm.http_json(origin() + '/api/kodi/poll', data={'deviceCode': start['deviceCode']})
        except dmm.HttpError as e:
            if e.status == 410:
                return {'expired': True}
            raise
        return body if status == 200 else None

    result = qr_wait(
        'Link this Kodi to Debrid Media Manager',
        ['Scan the code with your phone, or open', '[B]%s/kodi[/B]' % origin().replace('https://', ''),
         'on a phone or computer where you are signed in to DMM, and enter:'],
        start['userCode'], start['verifyUrl'], poll, start.get('interval', 3), start.get('expiresIn', 600))
    if not result:
        return False
    if result.get('expired'):
        xbmcgui.Dialog().ok(NAME, 'That code expired. Choose Link this Kodi again for a new one.')
        return False
    save_link({'accounts': result.get('accounts') or [], 'sponsor': result.get('sponsor')})
    names = [a['name'] for a in accounts()] + (['your sponsorship'] if sponsor() else [])
    notify('Linked: %s' % ', '.join(names), 6000)
    xbmc.executebuiltin('Container.Refresh')
    return True


def unlink(_):
    if xbmcgui.Dialog().yesno(NAME, 'Unlink this Kodi? Your casts stay on DMM; you can link again any time.',
                              nolabel='Keep', yeslabel='Unlink'):
        save_link(None)
        xbmc.executebuiltin('Container.Update(%s,replace)' % BASE)


# ---------------------------------------------------------------- playback

def describe(p):
    try:
        m = dmm.meta(p['kind'], p['id'])
    except dmm.HttpError:
        m = {'id': p['id'], 'type': p['kind']}
    if p['kind'] == 'series':
        ep = next((v for v in dmm.episodes_of(m, int(p['season']))
                   if (v.get('episode') or v.get('number')) == int(p['episode'])), {})
        return m, ep, '%s %sx%02d' % (m.get('name', ''), p['season'], int(p['episode']))
    return m, None, dmm.title_label(dict(m, released=None)) if m.get('name') else p['id']


def gather(kind, sid):
    """Every linked account's sources for one title, the cast link, and any notice to show."""
    answers = dmm.parallel(lambda a: (a, dmm.streams(a, kind, sid)), accounts())
    sources, notices, cast_url, errors = [], [], None, []
    for ans in answers:
        if isinstance(ans, Exception):
            errors.append(ans)
            continue
        a, data = ans
        s, n, c = dmm.parse_streams(a['service'], data)
        sources += s
        notices += n
        cast_url = cast_url or c
    return dmm.order_sources(sources), notices, cast_url, errors


def resolve_failed():
    if HANDLE >= 0:
        xbmcplugin.setResolvedUrl(HANDLE, False, xbmcgui.ListItem())


def play(p):
    if not link():
        if not xbmcgui.Dialog().yesno(
                NAME, 'Link this Kodi to play. It plays through your debrid account on DMM, and linking takes '
                      'a minute with your phone.', nolabel='Not now', yeslabel='Link now') or not do_link():
            return resolve_failed()
    if not accounts():  # linked for the Wanted list alone
        xbmcgui.Dialog().ok(NAME, 'This Kodi is linked without a debrid account, so it has nothing to play through. '
                                  'Sign in to one on DMM, then choose Account → Link again.')
        return resolve_failed()
    m, ep, title = describe(p)
    sid = dmm.stream_id(p['kind'], p['id'], p.get('season'), p.get('episode'))
    progress = xbmcgui.DialogProgressBG()
    progress.create(NAME, 'Finding sources for %s' % title)
    try:
        sources, notices, cast_url, errors = gather(p['kind'], sid)
        if not sources and any(getattr(e, 'status', 0) == 429 for e in errors):
            xbmc.sleep(5000)  # DMM allows one stream list per title every 5 s
            sources, notices, cast_url, errors = gather(p['kind'], sid)
    finally:
        progress.close()

    if not sources:
        if notices:
            n = notices[0]
            xbmcgui.Dialog().ok(n['title'] or NAME, '%s%s\nThen choose Account → Link again in this addon.' % (
                n['text'], '\n%s' % n['url'] if n.get('url') else ''))
            return resolve_failed()
        if errors and len(errors) == len(accounts()):
            xbmcgui.Dialog().ok(NAME, explain(errors[0]))
            return resolve_failed()
        if xbmcgui.Dialog().yesno(NAME, 'DMM knows of no cached release of %s yet.\nPick a release on your '
                                        'phone and it plays here as soon as it is ready.' % title,
                                  nolabel='Close', yeslabel='Cast from phone'):
            sources = cast_from_phone(p, title, cast_url)
        if not sources:
            return resolve_failed()

    for n in notices:  # an account that needs fixing, while another still plays
        notify('%s: %s' % (dict((a['service'], a['name']) for a in accounts()).get(n['service'], NAME), n['text']), 8000)
    chosen = sources[0]
    if p.get('choose') == '1' or (ADDON.getSetting('autoplay') != 'true' and len(sources) > 1):
        rows = []
        for s in sources:
            li = xbmcgui.ListItem(dmm.source_label(s), dmm.source_label2(s))
            li.setArt({'icon': os.path.join(MEDIA, '%s.png' % s['service'])})
            rows.append(li)
        picked = xbmcgui.Dialog().select('%s · %d sources' % (title, len(sources)), rows, useDetails=True)
        if picked < 0:
            return resolve_failed()
        chosen = sources[picked]
    play_url(chosen['url'], m, ep, p)


def play_url(stream_url, m=None, ep=None, p=None):
    li = xbmcgui.ListItem(path=stream_url)
    if m:
        info = dmm.info_of(m)
        if ep:
            info.update({'mediatype': 'episode', 'title': ep.get('name') or '', 'tvshowtitle': m.get('name', ''),
                         'season': int(p['season']), 'episode': int(p['episode']),
                         'plot': ep.get('overview') or info['plot']})
        set_info(li, info)
        li.setArt(dmm.art_of(m))
    if HANDLE >= 0:
        xbmcplugin.setResolvedUrl(HANDLE, True, li)
    else:  # started from a context menu, which gives no handle to resolve
        xbmc.Player().play(stream_url, li)


def cast_from_phone(p, title, cast_url=None):
    """QR to DMM's own release picker for this title. Returns the sources once the member's cast shows up,
    their new cast first; with nothing listed before, as soon as anything playable appears."""
    target = cast_url or '%s/%s/%s%s' % (origin(), 'show' if p['kind'] == 'series' else 'movie', p['id'],
                                          '/%s' % p['season'] if p['kind'] == 'series' else '')
    sid = dmm.stream_id(p['kind'], p['id'], p.get('season'), p.get('episode'))
    before = gather(p['kind'], sid)[0] if p.get('again') else None

    def poll():
        sources = gather(p['kind'], sid)[0]
        if before is None:
            return sources
        new = dmm.new_own_casts(before, sources)
        return new and new + [s for s in sources if s not in new]

    return qr_wait('Cast %s from your phone' % title,
                   ['Scan the code with a phone signed in to DMM.',
                    'Pick a release there and press Cast. It plays here as soon as it is ready.'],
                   '', target, poll, 6, 600) or []


def cast_action(p):
    m, ep, title = describe(p)
    sources = cast_from_phone(dict(p, again='1'), title)
    if sources:
        mine = next((s for s in sources if s['yours']), sources[0])
        play_url(mine['url'], m, ep, p)


# ---------------------------------------------------------------- Wanted (sponsors)

def sponsor_headers(refresh=False):
    sp = sponsor()
    if not sp:
        return None
    token, exp = ADDON.getSetting('sponsor_token'), ADDON.getSetting('sponsor_token_exp')
    if refresh or not token or not exp or float(exp) < time.time() + 3600:
        try:
            _, data = dmm.http_json(origin() + '/api/sponsor/link', data={'apiKey': sp['apiKey']})
        except dmm.HttpError as e:
            if e.status in (401, 404):
                return 'lapsed'
            raise
        if not data.get('isSponsor'):
            return 'lapsed'
        token = data['token']
        ADDON.setSetting('sponsor_token', token)
        ADDON.setSetting('sponsor_token_exp', str(time.time() + int(data.get('expiresIn') or 3600)))
    return {'x-dmm-sponsor': token}


def wanted_call(method, path, data=None):
    for attempt in (0, 1):
        headers = sponsor_headers(refresh=attempt == 1)
        if headers == 'lapsed' or headers is None:
            if headers == 'lapsed':  # stop offering Wanted until a renewed sponsorship is linked again
                save_link(dict(link(), sponsor=None))
                xbmc.executebuiltin('Container.Refresh')
            raise dmm.HttpError(401, 'Your DMM sponsorship is no longer active, so the Wanted list is off. '
                                     'Renew it, then choose Link again under Account.')
        try:
            return dmm.http_json(origin() + path, data=data, headers=headers, method=method)[1]
        except dmm.HttpError as e:
            if e.status != 401 or attempt:
                raise


def wanted_list(_):
    try:
        items = (wanted_call('GET', '/api/wanted') or {}).get('items') or []
    except dmm.HttpError as e:
        return fail(e)
    rows = dmm.hydrate([{'id': w['imdbId'], 'type': 'series' if w['kind'] == 'show' else 'movie', 'name': w['title'],
                         'poster': 'https://images.metahub.space/poster/medium/%s/img' % w['imdbId']} for w in items])
    for w, m in zip(items, rows):
        state = 'fetched' if w.get('fulfilledAt') else 'waiting for zurg' if not w.get('lastPolledAt') else 'wanted'
        li = xbmcgui.ListItem('%s · %s' % (dmm.title_label(m), state))
        set_info(li, dmm.info_of(m))
        li.setArt(dmm.art_of(m))
        li.addContextMenuItems([('Remove from DMM Wanted', 'RunPlugin(%s)' % url(action='unwant', id=w['imdbId'],
                                                                                 title=w['title']))])
        if m['type'] == 'series':
            xbmcplugin.addDirectoryItem(HANDLE, url(action='show', id=w['imdbId']), li, isFolder=True)
        else:
            li.setProperty('IsPlayable', 'true')
            xbmcplugin.addDirectoryItem(HANDLE, url(action='play', kind='movie', id=w['imdbId']), li, isFolder=False)
    if not items:
        empty_note('Your Wanted list is empty', 'Add a film or show from its context menu: Add to DMM Wanted. '
                                                'Your zurg fetches it.')
    end('videos', cache=False, category='Wanted')


def want(p):
    try:
        wanted_call('POST', '/api/wanted', {'imdbId': p['id'], 'kind': p['kind'], 'title': p.get('title') or p['id']})
    except dmm.HttpError as e:
        return xbmcgui.Dialog().ok(NAME, explain(e))
    notify('Added to Wanted: %s' % (p.get('title') or p['id']))


def unwant(p):
    try:
        wanted_call('DELETE', '/api/wanted?imdbId=%s' % urllib.parse.quote(p['id']))
    except dmm.HttpError as e:
        return xbmcgui.Dialog().ok(NAME, explain(e))
    notify('Removed from Wanted: %s' % (p.get('title') or p['id']))
    xbmc.executebuiltin('Container.Refresh')


# ---------------------------------------------------------------- router

ROUTES = {
    '': home, 'kind': kind_menu, 'genres': genres_menu, 'catalog': catalog_list, 'search': search_list,
    'show': show_seasons, 'season': season_episodes, 'casts': casts_list, 'library': library_list,
    'libitem': library_item, 'account': account_menu, 'link': do_link, 'unlink': unlink, 'play': play,
    'playurl': lambda p: play_url(p['u']), 'cast': cast_action, 'wanted': wanted_list, 'want': want,
    'unwant': unwant, 'settings': lambda p: ADDON.openSettings(), 'noop': lambda p: None,
}


def run(argv):
    params = dict(urllib.parse.parse_qsl(argv[2][1:] if len(argv) > 2 else ''))
    ROUTES.get(params.get('action', ''), home)(params)
