"""Logic tests for resources/lib/trackers.py: the member's Trakt and Simkl history as watched marks.

    python3 -m unittest discover -s kodi/plugin.video.dmm/tests

The trakt-* and simkl-* fixtures follow the trackers' documented answers until record_trackers.py captures real
ones (fixtures/README.md).
"""
import datetime
import json
import os
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


def history(service):
    return trackers.parse(service, fixture('%s-movies.json' % service), fixture('%s-shows.json' % service))


GRANT = {'accessToken': 'access', 'refreshToken': 'refresh', 'expiresAt': '2026-11-10T12:00:00.000Z',
         'user': {'name': 'Ben', 'slug': 'ben'}}
EXPIRES = trackers.seconds(GRANT['expiresAt'])


def tracker(service, calls, fail=None, answers=None):
    """dmm.http_json answering the tracker's requests from its fixtures, recording each; `fail` maps a request's
    name in trackers.PATHS to the error it raises, `answers` to another answer."""
    def http_json(url, data=None, headers=None, **_):
        calls.append((url, headers))
        for name, path in trackers.PATHS[service].items():
            if url.startswith(trackers.API[service] + path):
                if name in (fail or {}):
                    raise fail[name]
                return 200, (answers or {}).get(name) or fixture('%s-%s.json' % (service, name))
        raise AssertionError('unexpected request %s' % url)
    return http_json


class Parse(unittest.TestCase):
    def test_trakt_films_by_imdb_id_with_when_last_watched(self):
        movies = history('trakt')['movies']
        self.assertEqual(movies, {'tt0468569': '2026-11-07T20:41:13.000Z', 'tt0372784': '2014-10-11T17:00:54.000Z'})

    def test_trakt_shows_with_their_aired_count_and_each_watched_episode(self):
        shows = history('trakt')['shows']
        bb = shows['tt0903747']
        self.assertEqual(bb['aired'], 62)
        self.assertEqual(sorted(bb['episodes']), ['0:1'] + ['1:%d' % e for e in range(1, 8)] + ['2:1', '2:2'])
        self.assertEqual(bb['episodes']['2:2'], '2026-11-08T19:02:55.000Z')
        self.assertEqual(shows['tt7366338']['aired'], 5)

    def test_simkl_counts_aired_episodes_without_those_yet_to_air(self):
        shows = history('simkl')['shows']
        self.assertEqual(shows['tt0149460']['aired'], 165 - 11)
        self.assertEqual(shows['tt0149460']['episodes'], {'8:1': '2026-05-04T19:40:59Z', '8:2': '2026-05-04T19:40:59Z'})
        self.assertEqual(history('simkl')['movies'], {'tt0068646': '1994-09-01T16:00:00Z',
                                                      'tt0372784': '2026-05-14T06:43:15Z'})

    def test_trakt_activity_moves_with_a_watched_film_or_episode(self):
        data = fixture('trakt-activity.json')
        token = trackers.activity('trakt', data)
        self.assertEqual(token, '2026-11-07T20:41:13.000Z|2026-11-08T19:02:55.000Z')
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
        self.bb = fixture('cinemeta-meta-breakingbad-s0-2.json')['meta']

    def marks(self, **info):
        return trackers.marks(self.watched, info, self.bb['videos'], info.pop('today', None))

    def test_a_film_watched_on_either_tracker_is_ticked_with_the_latest_date(self):
        self.assertEqual(self.marks(mediatype='movie', imdb='tt0468569'),
                         {'playcount': 1, 'lastplayed': '2026-11-07 20:41:13'})  # Trakt only
        self.assertEqual(self.marks(mediatype='movie', imdb='tt0068646')['playcount'], 1)  # Simkl only
        self.assertEqual(self.marks(mediatype='movie', imdb='tt0372784')['lastplayed'], '2026-05-14 06:43:15')

    def test_anything_unwatched_is_left_to_kodi(self):
        # Never playcount 0: it would hide what Kodi itself recorded as played on this TV.
        self.assertEqual(self.marks(mediatype='movie', imdb='tt9999999'), {})
        self.assertEqual(self.marks(mediatype='tvshow', imdb='tt9999999'), {})
        self.assertEqual(self.marks(mediatype='episode', imdb='tt0903747', season=2, episode=5), {})
        self.assertEqual(self.marks(mediatype='video', imdb=''), {})
        self.assertEqual(trackers.marks(trackers.union([]), {'mediatype': 'movie', 'imdb': 'tt0468569'}), {})

    def test_episodes_watched_on_either_tracker(self):
        self.assertEqual(self.marks(mediatype='episode', imdb='tt0903747', season=2, episode=3),
                         {'playcount': 1, 'lastplayed': '2026-05-04 19:40:58'})  # Simkl
        self.assertEqual(self.marks(mediatype='episode', imdb='tt0903747', season=1, episode=1)['lastplayed'],
                         '2026-05-01 20:00:00')  # both: the later

    def test_a_part_watched_show_counts_its_regular_episodes_against_those_aired(self):
        # Trakt: 1x01-1x07, 2x01-2x02 and a special; Simkl adds 2x03.
        self.assertEqual(self.marks(mediatype='tvshow', imdb='tt0903747'), {'episodes': (10, 62)})
        self.assertEqual(self.marks(mediatype='tvshow', imdb='tt0149460'), {'episodes': (2, 154)})

    def test_a_show_with_every_aired_episode_watched_is_ticked(self):
        self.assertEqual(self.marks(mediatype='tvshow', imdb='tt7366338'), {'playcount': 1})

    def test_seasons_count_cinemetas_episodes(self):
        self.assertEqual(self.marks(mediatype='season', imdb='tt0903747', season=1), {'playcount': 1})
        self.assertEqual(self.marks(mediatype='season', imdb='tt0903747', season=2), {'episodes': (3, 13)})
        self.assertEqual(self.marks(mediatype='season', imdb='tt0903747', season=0), {'episodes': (1, 5)})

    def test_a_season_still_airing_counts_only_its_aired_episodes(self):
        # On 2009-03-31 Cinemeta lists all 13 of season 2, four of them aired; 2x01-2x03 are watched.
        today = datetime.date(2009, 3, 31)
        self.assertEqual(self.marks(mediatype='season', imdb='tt0903747', season=2, today=today), {'episodes': (3, 4)})
        today = datetime.date(2009, 3, 24)
        self.assertEqual(self.marks(mediatype='season', imdb='tt0903747', season=2, today=today), {'playcount': 1})


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

    def test_the_first_read_pulls_everything_and_keeps_it(self):
        got, urls, calls = self.read(self.NOW)
        self.assertEqual(urls, ['https://api.trakt.tv/sync/last_activities', 'https://api.trakt.tv/sync/watched/movies',
                                'https://api.trakt.tv/sync/watched/shows?extended=full'])
        self.assertEqual(calls[0][1], {'Authorization': 'Bearer access', 'Content-Type': 'application/json',
                                       'trakt-api-version': '2', 'trakt-api-key': trackers.TRAKT_CLIENT_ID})
        self.assertEqual(got, dict(history('trakt'), checked=self.NOW,
                                   activity='2026-11-07T20:41:13.000Z|2026-11-08T19:02:55.000Z'))
        with open(self.path, encoding='utf-8') as f:
            self.assertEqual(json.load(f), got)
        self.assertEqual(self.logged, [])

    def test_asks_nothing_for_five_minutes_then_only_whether_anything_moved(self):
        first = self.read(self.NOW)[0]
        got, urls, _ = self.read(self.NOW + 299)
        self.assertEqual((got, urls), (first, []))
        got, urls, _ = self.read(self.NOW + 301)
        self.assertEqual(urls, ['https://api.trakt.tv/sync/last_activities'])
        self.assertEqual(got, dict(first, checked=self.NOW + 301))

    def test_pulls_again_once_the_activity_moved(self):
        self.read(self.NOW)
        moved = fixture('trakt-activity.json')
        moved['episodes']['watched_at'] = '2026-11-09T20:00:00.000Z'
        shows = fixture('trakt-shows.json')
        shows[0]['seasons'][2]['episodes'].append({'number': 3, 'plays': 1,
                                                   'last_watched_at': '2026-11-09T20:00:00.000Z'})
        got, urls, _ = self.read(self.NOW + 301, answers={'activity': moved, 'shows': shows})
        self.assertEqual(len(urls), 3)
        self.assertEqual(got['shows']['tt0903747']['episodes']['2:3'], '2026-11-09T20:00:00.000Z')
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
        self.assertEqual((len(urls), got['activity'][:24]), (3, '2026-11-09T20:00:00.000Z'))

    def test_an_unreachable_tracker_on_the_first_read_leaves_no_marks(self):
        got, _, _ = self.read(self.NOW, fail={'activity': dmm.HttpError(0, 'timed out')})
        self.assertEqual(got, {'checked': self.NOW})
        self.assertEqual(trackers.marks(trackers.union([got]), {'mediatype': 'movie', 'imdb': 'tt0468569'}), {})

    def test_simkl_is_asked_with_the_app_identity_its_api_requires(self):
        grant = dict(GRANT, clientId='simkl-client')
        with mock.patch.object(dmm, 'USER_AGENT', 'DMM-Kodi/1.3.0'):
            got, urls, calls = self.read(self.NOW, 'simkl', grant)
        self.assertEqual(urls[0], 'https://api.simkl.com/sync/activities?client_id=simkl-client&app-name=DMM+Kodi'
                                  '&app-version=1.3.0')
        self.assertTrue(urls[2].startswith('https://api.simkl.com/sync/all-items/shows?extended=full&'
                                           'include_all_episodes=yes&episode_watched_at=yes&client_id=simkl-client'))
        self.assertEqual(calls[0][1], {'Authorization': 'Bearer access'})
        self.assertEqual(got['movies'], history('simkl')['movies'])

    def test_simkl_without_a_client_id_is_logged_not_asked(self):
        got, urls, _ = self.read(self.NOW, 'simkl')
        self.assertEqual((got, urls), ({'checked': self.NOW}, []))
        self.assertIn('simkl_client_id', self.logged[0])


if __name__ == '__main__':
    unittest.main()
