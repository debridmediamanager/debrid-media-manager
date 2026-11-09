"""Logic tests for resources/lib/trackers.py: the member's Trakt and Simkl history as watched marks.

    python3 -m unittest discover -s kodi/plugin.video.dmm/tests

The trakt-* and simkl-* fixtures are live answers of 2026-11-09 cut to three rows per list (record_trackers.py,
fixtures/README.md); the two accounts hold the same person's history, so most titles are on both.
"""
import datetime
import json
import os
import re
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from resources.lib import dmm, trackers  # noqa: E402


def fixture(name):
    with open(os.path.join(HERE, 'fixtures', name), encoding='utf-8') as f:
        return json.load(f)


def page_of(service, name, page):
    """One page of an answer as recorded, [] past the last."""
    path = '%s-%s%s.json' % (service, name, '-%d' % page if page > 1 else '')
    return fixture(path) if os.path.exists(os.path.join(HERE, 'fixtures', path)) else []


def answer(service, name):
    """The whole answer, Trakt's pages joined as the addon joins them."""
    data, page = page_of(service, name, 1), 2
    while service == 'trakt' and page_of(service, name, page):
        data, page = data + page_of(service, name, page), page + 1
    return data


def history(service):
    return trackers.parse(service, answer(service, 'movies'), answer(service, 'shows'))


GRANT = {'accessToken': 'access', 'refreshToken': 'refresh', 'expiresAt': '2026-11-10T12:00:00.000Z',
         'user': {'name': 'Ben', 'slug': 'ben'}}
EXPIRES = trackers.seconds(GRANT['expiresAt'])
BLUEY, OFFICE, QUEEN_OF_TEARS, HEIMSENDIR = 'tt7678620', 'tt0386676', 'tt27668559', 'tt2354851'
WRECK_IT_RALPH, DARK_KNIGHT, ALITA = 'tt1772341', 'tt0468569', 'tt0437086'


def tracker(service, calls, fail=None, answers=None, paged=True):
    """dmm.http_json answering the tracker's requests from its fixtures, page by page with Trakt's recorded
    pagination headers (none when not `paged`), recording each request; `fail` maps a request's name in
    trackers.PATHS to the error it raises, `answers` to another first page."""
    def http_json(url, data=None, headers=None, response_headers=None, **_):
        calls.append((url, headers))
        for name, path in trackers.PATHS[service].items():
            if url.startswith(trackers.API[service] + path):
                if name in (fail or {}):
                    raise fail[name]
                page = int((re.search(r'[?&]page=(\d+)', url) or [0, 1])[1])
                if paged and response_headers is not None and service == 'trakt' and name != 'activity':
                    response_headers.update(fixture('trakt-pages.json')[name][page - 1])
                if page == 1 and name in (answers or {}):
                    return 200, answers[name]
                return 200, page_of(service, name, page)
        raise AssertionError('unexpected request %s' % url)
    return http_json


class Parse(unittest.TestCase):
    def test_trakt_films_from_every_page_by_imdb_id(self):
        movies = history('trakt')['movies']
        self.assertEqual(len(movies), 6)
        self.assertEqual(movies[ALITA], '2025-04-13T12:20:00.000Z')  # page 1
        self.assertEqual(movies[WRECK_IT_RALPH], '2022-02-12T23:18:00.000Z')  # page 2

    def test_trakt_shows_with_their_aired_count_and_each_watched_episode(self):
        shows = history('trakt')['shows']
        self.assertEqual((shows[BLUEY]['aired'], len(shows[BLUEY]['episodes'])), (153, 54))
        self.assertEqual(shows[BLUEY]['episodes']['0:27'], '2024-04-20T11:31:00.000Z')  # a special
        self.assertEqual(shows[OFFICE]['episodes']['4:14'], '2023-04-09T08:50:00.000Z')
        self.assertEqual((shows[QUEEN_OF_TEARS]['aired'], len(shows[QUEEN_OF_TEARS]['episodes'])), (16, 16))

    def test_simkl_counts_aired_episodes_and_skips_a_film_without_an_imdb_id(self):
        h = history('simkl')
        self.assertEqual(h['movies'], {DARK_KNIGHT: '2023-10-26T02:04:16Z', WRECK_IT_RALPH: '2022-02-12T23:18:27Z'})
        self.assertEqual([m['movie']['title'] for m in answer('simkl', 'movies')['movies']
                          if not m['movie']['ids'].get('imdb')], ['Episode 1'])
        self.assertEqual({imdb: (s['aired'], len(s['episodes'])) for imdb, s in h['shows'].items()},
                         {OFFICE: (195, 21), HEIMSENDIR: (9, 9), BLUEY: (154, 53)})

    def test_trakt_activity_moves_with_a_watched_film_or_episode(self):
        data = fixture('trakt-activity.json')
        token = trackers.activity('trakt', data)
        self.assertEqual(token, '2025-04-13T12:20:43.000Z|2026-10-26T15:55:28.000Z')
        data['movies']['paused_at'] = data['all'] = '2026-11-09T00:00:00.000Z'
        self.assertEqual(trackers.activity('trakt', data), token)
        data['episodes']['watched_at'] = '2026-11-09T00:00:00.000Z'
        self.assertNotEqual(trackers.activity('trakt', data), token)

    def test_simkl_activity_ignores_ratings_playback_and_settings(self):
        data = fixture('simkl-activity.json')
        token = trackers.activity('simkl', data)
        data['all'] = data['settings']['all'] = data['tv_shows']['playback'] = data['movies']['rated_at'] = 'later'
        self.assertEqual(trackers.activity('simkl', data), token)
        for bucket, key in (('tv_shows', 'watching'), ('tv_shows', 'removed_from_list'), ('movies', 'completed')):
            moved = fixture('simkl-activity.json')
            moved[bucket][key] = 'later'
            self.assertNotEqual(trackers.activity('simkl', moved), token, key)


class Marks(unittest.TestCase):
    """What the lists show, with Trakt and Simkl both linked."""

    def setUp(self):
        self.watched = trackers.union([history('trakt'), history('simkl')])

    def marks(self, videos=None, today=None, **info):
        return trackers.marks(self.watched, info, videos, today)

    def test_a_film_watched_on_either_tracker_is_ticked_with_the_latest_date(self):
        self.assertEqual(self.marks(mediatype='movie', imdb=ALITA),
                         {'playcount': 1, 'lastplayed': '2025-04-13 12:20:00'})  # Trakt only
        self.assertEqual(self.marks(mediatype='movie', imdb=DARK_KNIGHT)['playcount'], 1)  # Simkl only
        self.assertEqual(self.marks(mediatype='movie', imdb=WRECK_IT_RALPH)['lastplayed'], '2022-02-12 23:18:27')

    def test_anything_unwatched_is_left_to_kodi(self):
        # Never playcount 0: it would hide what Kodi itself recorded as played on this TV.
        self.assertEqual(self.marks(mediatype='movie', imdb='tt0903747'), {})
        self.assertEqual(self.marks(mediatype='tvshow', imdb='tt0903747'), {})
        self.assertEqual(self.marks(mediatype='episode', imdb=BLUEY, season=3, episode=18), {})
        self.assertEqual(self.marks(mediatype='video', imdb=''), {})
        self.assertEqual(trackers.marks(trackers.union([]), {'mediatype': 'movie', 'imdb': ALITA}), {})

    def test_episodes_watched_on_either_tracker(self):
        self.assertEqual(self.marks(mediatype='episode', imdb=OFFICE, season=4, episode=14),
                         {'playcount': 1, 'lastplayed': '2023-04-09 08:50:16'})  # both: the later, Simkl's
        self.assertEqual(self.marks(mediatype='episode', imdb=HEIMSENDIR, season=1, episode=1)['playcount'], 1)

    def test_a_part_watched_show_counts_its_regular_episodes_against_the_most_aired(self):
        # Trakt counts 153 aired and has a special watched; Simkl counts 154. The special stays out.
        self.assertEqual(self.marks(mediatype='tvshow', imdb=BLUEY), {'episodes': (53, 154)})
        self.assertEqual(self.marks(mediatype='tvshow', imdb=OFFICE), {'episodes': (21, 195)})

    def test_a_show_with_every_aired_episode_watched_is_ticked(self):
        self.assertEqual(self.marks(mediatype='tvshow', imdb=QUEEN_OF_TEARS), {'playcount': 1})  # Trakt
        self.assertEqual(self.marks(mediatype='tvshow', imdb=HEIMSENDIR), {'playcount': 1})  # Simkl, completed

    def test_seasons_count_cinemetas_episodes(self):
        # Cinemeta dates every episode of The Office 2001-01-31, so both seasons count as aired.
        office = fixture('cinemeta-meta-theoffice-s1-2.json')['meta']['videos']
        self.assertEqual(self.marks(office, mediatype='season', imdb=OFFICE, season=1), {'playcount': 1})
        self.assertEqual(self.marks(office, mediatype='season', imdb=OFFICE, season=2), {'episodes': (8, 22)})
        bluey = fixture('cinemeta-meta-bluey-s3.json')['meta']['videos']
        self.assertEqual(self.marks(bluey, mediatype='season', imdb=BLUEY, season=3), {'episodes': (35, 50)})

    def test_a_season_still_airing_counts_only_its_aired_episodes(self):
        # Bluey's third season aired a day at a time from late November 2021; 3x18 is the first one not watched.
        bluey = fixture('cinemeta-meta-bluey-s3.json')['meta']['videos']
        self.assertEqual(self.marks(bluey, datetime.date(2021, 12, 7), mediatype='season', imdb=BLUEY, season=3),
                         {'playcount': 1})
        self.assertEqual(self.marks(bluey, datetime.date(2021, 12, 10), mediatype='season', imdb=BLUEY, season=3),
                         {'episodes': (19, 20)})


class Grants(unittest.TestCase):
    def test_a_grant_far_from_expiry_is_used_as_it_is(self):
        with mock.patch.object(dmm, 'http_json', side_effect=AssertionError('no request')):
            self.assertIs(trackers.fresh_grant('trakt', GRANT, 'https://dmm.test', EXPIRES - 7200), GRANT)

    def test_renews_through_dmm_within_the_hour(self):
        answer = {'accessToken': 'access2', 'refreshToken': 'refresh2', 'expiresAt': '2026-11-11T11:50:00.000Z'}
        with mock.patch.object(dmm, 'http_json', return_value=(200, answer)) as http:
            grant = trackers.fresh_grant('trakt', dict(GRANT, clientId='other'), 'https://dmm.test', EXPIRES - 600)
        http.assert_called_once_with('https://dmm.test/api/kodi/tracker/refresh',
                                     data={'service': 'trakt', 'refreshToken': 'refresh'})
        self.assertEqual(grant, dict(GRANT, clientId='other', **answer))
        with mock.patch.object(dmm, 'http_json', return_value=(200, answer)):
            self.assertEqual(trackers.fresh_grant('simkl', GRANT, 'https://dmm.test', EXPIRES + 60)['accessToken'],
                             'access2')  # already expired

    def test_a_refused_refresh_means_link_again(self):
        with mock.patch.object(dmm, 'http_json', side_effect=dmm.HttpError(401, 'relink', {'error': 'relink'})):
            self.assertIsNone(trackers.fresh_grant('trakt', GRANT, 'https://dmm.test', EXPIRES - 600))

    def test_an_unreachable_dmm_keeps_the_grant(self):
        for status in (0, 503, 429):
            with mock.patch.object(dmm, 'http_json', side_effect=dmm.HttpError(status, 'down')):
                self.assertIs(trackers.fresh_grant('trakt', GRANT, 'https://dmm.test', EXPIRES - 600), GRANT)


class History(unittest.TestCase):
    NOW = 1_800_000_000
    TRAKT = ['https://api.trakt.tv/sync/last_activities',
             'https://api.trakt.tv/sync/watched/movies?page=1&limit=250',
             'https://api.trakt.tv/sync/watched/movies?page=2&limit=250',
             'https://api.trakt.tv/sync/watched/shows?extended=progress&page=1&limit=250']

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.path = os.path.join(self.dir.name, 'watched-trakt.json')
        self.logged = []

    def tearDown(self):
        self.dir.cleanup()

    def read(self, now, service='trakt', grant=GRANT, **served):
        calls = []
        with mock.patch.object(dmm, 'http_json', tracker(service, calls, **served)):
            got = trackers.history(service, grant, self.path, now, self.logged.append)
        return got, [url for url, _ in calls], calls

    def test_the_first_read_pulls_every_page_and_keeps_it(self):
        got, urls, calls = self.read(self.NOW)
        self.assertEqual(urls, self.TRAKT)
        self.assertEqual(calls[0][1], {'Authorization': 'Bearer access', 'Content-Type': 'application/json',
                                       'trakt-api-version': '2', 'trakt-api-key': trackers.TRAKT_CLIENT_ID})
        self.assertEqual(got, dict(history('trakt'), checked=self.NOW,
                                   activity='2025-04-13T12:20:43.000Z|2026-10-26T15:55:28.000Z'))
        with open(self.path, encoding='utf-8') as f:
            self.assertEqual(json.load(f), got)
        self.assertEqual(self.logged, [])

    def test_trakt_pages_end_at_an_empty_page_when_the_count_is_missing(self):
        # Trakt (trakt/trakt-api#775) asks apps to stop at [] too; the recorded films span two pages.
        got, urls, _ = self.read(self.NOW, paged=False)
        self.assertEqual([u for u in urls if '/movies' in u], self.TRAKT[1:3] + [
            'https://api.trakt.tv/sync/watched/movies?page=3&limit=250'])
        self.assertIn(WRECK_IT_RALPH, got['movies'])

    def test_asks_nothing_for_five_minutes_then_only_whether_anything_moved(self):
        first = self.read(self.NOW)[0]
        got, urls, _ = self.read(self.NOW + 299)
        self.assertEqual((got, urls), (first, []))
        got, urls, _ = self.read(self.NOW + 301)
        self.assertEqual(urls, self.TRAKT[:1])
        self.assertEqual(got, dict(first, checked=self.NOW + 301))

    def test_pulls_again_once_the_activity_moved(self):
        self.read(self.NOW)
        moved = fixture('trakt-activity.json')
        moved['episodes']['watched_at'] = '2026-11-09T20:00:00.000Z'
        shows = fixture('trakt-shows.json')
        office = next(s for s in shows if s['show']['ids']['imdb'] == OFFICE)
        office['seasons'][-1]['episodes'].append({'number': 15, 'plays': 1,
                                                  'last_watched_at': '2026-11-09T20:00:00.000Z'})
        got, urls, _ = self.read(self.NOW + 301, answers={'activity': moved, 'shows': shows})
        self.assertEqual(urls, self.TRAKT)
        self.assertEqual(got['shows'][OFFICE]['episodes']['4:15'], '2026-11-09T20:00:00.000Z')
        self.assertTrue(got['activity'].endswith('2026-11-09T20:00:00.000Z'))

    def test_a_failed_pull_keeps_the_old_history_and_tries_again_later(self):
        before = self.read(self.NOW)[0]
        moved = fixture('trakt-activity.json')
        moved['movies']['watched_at'] = '2026-11-09T20:00:00.000Z'
        got, _, _ = self.read(self.NOW + 301, answers={'activity': moved},
                              fail={'shows': dmm.HttpError(502, 'HTTP 502')})
        self.assertEqual(got, dict(before, checked=self.NOW + 301))  # the old activity too, so it pulls again
        self.assertEqual(self.logged, ['DMM: Trakt history not read: HTTP 502'])
        self.assertEqual(self.read(self.NOW + 400)[1], [])
        got, urls, _ = self.read(self.NOW + 602, answers={'activity': moved})
        self.assertEqual((len(urls), got['activity'][:24]), (4, '2026-11-09T20:00:00.000Z'))

    def test_an_unreachable_tracker_on_the_first_read_leaves_no_marks(self):
        got, _, _ = self.read(self.NOW, fail={'activity': dmm.HttpError(429, 'HTTP 429')})
        self.assertEqual(got, {'checked': self.NOW})
        self.assertEqual(trackers.marks(trackers.union([got]), {'mediatype': 'movie', 'imdb': ALITA}), {})

    def test_simkl_is_asked_with_the_app_identity_its_api_requires(self):
        grant = dict(GRANT, clientId='simkl-client')
        with mock.patch.object(dmm, 'USER_AGENT', 'DMM-Kodi/1.3.0'):
            got, urls, calls = self.read(self.NOW, 'simkl', grant)
        self.assertEqual(urls[0], 'https://api.simkl.com/sync/activities?client_id=simkl-client&app-name=DMM+Kodi'
                                  '&app-version=1.3.0')
        self.assertEqual(urls[1], 'https://api.simkl.com/sync/all-items/movies/completed?client_id=simkl-client'
                                  '&app-name=DMM+Kodi&app-version=1.3.0')
        self.assertTrue(urls[2].startswith('https://api.simkl.com/sync/all-items/shows?extended=full&'
                                           'include_all_episodes=yes&episode_watched_at=yes&client_id=simkl-client'))
        self.assertEqual(len(urls), 3)  # not paged
        self.assertEqual(calls[0][1], {'Authorization': 'Bearer access'})
        self.assertEqual(got, dict(history('simkl'), checked=self.NOW, activity=trackers.activity(
            'simkl', fixture('simkl-activity.json'))))

    def test_simkl_without_a_client_id_is_logged_not_asked(self):
        got, urls, _ = self.read(self.NOW, 'simkl')
        self.assertEqual((got, urls), ({'checked': self.NOW}, []))
        self.assertIn('simkl_client_id', self.logged[0])


if __name__ == '__main__':
    unittest.main()
