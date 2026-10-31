"""Logic tests for resources/lib/dmm.py, driven by responses captured from DMM and Cinemeta.

    python3 -m unittest discover -s kodi/plugin.video.dmm/tests
"""
import datetime
import json
import os
import struct
import sys
import unittest
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from resources.lib import dmm  # noqa: E402


def fixture(name):
    with open(os.path.join(HERE, 'fixtures', name), encoding='utf-8') as f:
        return json.load(f)


class Streams(unittest.TestCase):
    def setUp(self):
        self.sources, self.notices, self.cast_url = dmm.parse_streams('pm', fixture('pm-streams-tt12042730.json'))

    def test_splits_sources_from_the_cast_link(self):
        self.assertEqual(len(self.sources), 6)
        self.assertEqual(self.notices, [])
        self.assertEqual(self.cast_url, 'https://debridmediamanager.com/movie/tt12042730')

    def test_marks_the_members_own_cast(self):
        self.assertEqual([s['yours'] for s in self.sources], [True] + [False] * 5)

    def test_joins_filenames_dmm_split_in_half(self):
        names = [s['filename'] for s in self.sources]
        self.assertIn('Project Hail Mary 2026 2160p USA UHD Blu-ray DV HDR HEVC TrueHD 7 1 Atmos-TMT', names)
        self.assertIn('Project.Hail.Mary.2026.2160p.USA.UHD.DV.HDR.BDRemux.TeamHD.mkv', names)
        self.assertIn('Project.Hail.Mary.2026.Hybrid.2160p.UHD.Bluray.Remux.DV.HDR10+.HEVC.DDP.5.1.CZ.TrueHD.'
                      'Atmos.7.1.EN-JOsHUA', names)

    def test_leaves_no_emoji_kodi_would_draw_as_boxes(self):
        text = ''.join(dmm.source_label(s) + dmm.source_label2(s) for s in self.sources)
        self.assertFalse([c for c in text if ord(c) > 0x2000 and c not in '·–'], text)
        self.assertEqual(self.sources[2]['details'], 'DD 5.1 • RU UA GB')

    def test_labels_name_the_service_and_quality(self):
        self.assertEqual(dmm.source_label(self.sources[0]),
                         '[B]PM[/B]  720p · H264 · 18.68 GB · your cast')
        self.assertEqual(dmm.source_label2(self.sources[0]),
                         'Project.Hail.Mary.2026.1080p.WEB-DL.AAC.2.0.H264-EaZy.mkv · AAC 2.0 · GB IN IN IN')

    def test_a_dead_install_is_a_notice_not_a_source(self):
        sources, notices, cast_url = dmm.parse_streams('rd', fixture('rd-notice-not-connected.json'))
        self.assertEqual((sources, cast_url), ([], None))
        self.assertEqual(notices[0]['text'], 'Set up DMM Cast for Real-Debrid again')
        self.assertEqual(notices[0]['url'], 'https://debridmediamanager.com/stremio')

    def test_own_casts_lead_across_accounts(self):
        other = dict(self.sources[1], service='rd')
        mine = dict(self.sources[0], service='rd')
        ordered = dmm.order_sources([other, self.sources[2], mine])
        self.assertEqual([s['yours'] for s in ordered], [True, False, False])
        self.assertIs(ordered[1], other)

    def test_unwrap_leaves_short_lines_alone(self):
        self.assertEqual(dmm.unwrap_filename(['Some-', 'thing']), ['Some-', 'thing'])


class Cinemeta(unittest.TestCase):
    def test_search_finds_titles_cinemeta_search_misses(self):
        # Cinemeta's search answers nothing for Sintel (captured), though its meta has it; DMM's
        # title search, over every IMDb title, finds it.
        served = {
            'https://dmm.test/api/search/title?keyword=sintel': fixture('dmm-search-sintel.json'),
            dmm.CINEMETA + '/catalog/movie/top/search=sintel.json': fixture('cinemeta-search-movie-sintel.json'),
            dmm.CINEMETA + '/catalog/series/top/search=sintel.json': {'metas': []},
        }
        real = dmm.http_json
        dmm.http_json = lambda url, **kw: (200, served[url]) if url in served else (200, {'meta': {}})
        try:
            results = dmm.search('sintel', 'https://dmm.test')
        finally:
            dmm.http_json = real
        self.assertEqual([(m['id'], m['type'], m['name']) for m in results], [('tt1727587', 'movie', 'Sintel')])
        self.assertEqual(dmm.title_label(results[0]), 'Sintel (2010)')
        self.assertIn('/poster/medium/tt1727587/', dmm.art_of(results[0])['poster'])

    def test_search_keeps_dmm_order_and_maps_shows_to_series(self):
        served = {'https://dmm.test/api/search/title?keyword=x': {'results': [
            {'id': 'tt0903747', 'type': 'show', 'year': 2008, 'title': 'Breaking Bad'},
            {'id': 'tt4669580', 'type': 'movie', 'year': 2015, 'title': 'Breaking Bad Movie Deal Gone Bad'}]}}
        real = dmm.http_json
        dmm.http_json = lambda url, **kw: (200, served[url]) if url in served else (200, {'meta': {}})
        try:
            results = dmm.search('x', 'https://dmm.test')
        finally:
            dmm.http_json = real
        self.assertEqual([(m['id'], m['type']) for m in results], [('tt0903747', 'series'), ('tt4669580', 'movie')])

    def test_labels_carry_the_year_and_say_when_unreleased(self):
        today = datetime.date(2026, 10, 31)
        self.assertEqual(dmm.title_label({'name': 'Dune', 'year': '2021', 'type': 'movie'}, today), 'Dune (2021)')
        self.assertEqual(dmm.title_label({'name': 'Dune: Prophecy', 'releaseInfo': '2024-', 'type': 'series'}, today),
                         'Dune: Prophecy (2024–)')
        self.assertEqual(dmm.title_label({'name': 'X', 'year': '2026', 'type': 'movie',
                                          'released': '2026-12-18T00:00:00.000Z'}, today),
                         '[COLOR grey][I]X (2026) · out 2026-12-18[/I][/COLOR]')

    def test_seasons_put_specials_last_and_episodes_in_order(self):
        m = fixture('cinemeta-meta-breakingbad-s0-2.json')['meta']
        seasons = dmm.seasons_of(m)
        self.assertEqual([s for s, _ in seasons], [1, 2, 0])
        self.assertEqual(dict(seasons)[1], 7)
        eps = dmm.episodes_of(m, 1)
        self.assertEqual(dmm.episode_label(eps[0]), '1x01. Pilot')
        self.assertEqual([e['episode'] for e in eps], list(range(1, 8)))

    def test_info_and_art(self):
        m = fixture('cinemeta-meta-breakingbad-s0-2.json')['meta']
        info = dmm.info_of(m)
        self.assertEqual(info['mediatype'], 'tvshow')
        self.assertEqual(info['imdb'], m['id'])
        self.assertTrue(info['plot'])
        self.assertIn('/medium/', dmm.art_of(m)['poster'])
        self.assertEqual(dmm.runtime_seconds('107 min'), 6420)
        self.assertEqual(dmm.stream_id('series', 'tt1', '2', '5'), 'tt1:2:5')

    def test_hydrate_fills_sparse_rows_and_keeps_failures(self):
        calls = []
        real = dmm.meta

        def fake_meta(kind, imdb_id):
            calls.append((kind, imdb_id))
            if imdb_id == 'tt2':
                raise dmm.HttpError(0, 'offline')
            return {'id': imdb_id, 'name': 'Full', 'description': 'Plot', 'type': kind}
        dmm.meta = fake_meta
        try:
            out = dmm.hydrate([{'id': 'tt1', 'type': 'series', 'name': 'Sparse', 'poster': 'p'},
                               {'id': 'tt2', 'type': 'movie', 'name': 'Broken'},
                               {'id': 'tt3', 'name': 'Has', 'description': 'already'}])
        finally:
            dmm.meta = real
        self.assertEqual(out[0]['description'], 'Plot')
        self.assertEqual((out[0]['type'], out[0]['poster']), ('series', 'p'))
        self.assertEqual(out[1]['name'], 'Broken')
        self.assertEqual(out[2]['description'], 'already')
        self.assertEqual(sorted(calls), [('movie', 'tt2'), ('series', 'tt1')])


class QrPng(unittest.TestCase):
    def test_draws_modules_black_on_white_with_a_quiet_zone(self):
        png = dmm.qr_png([[1, 0], [0, 1]], scale=2, border=1)
        self.assertEqual(png[:8], b'\x89PNG\r\n\x1a\n')
        width, height = struct.unpack('>II', png[16:24])
        self.assertEqual((width, height), (8, 8))
        idat = png[png.index(b'IDAT') + 4:png.index(b'IEND') - 8]
        rows = zlib.decompress(idat)
        stride = width + 1
        pixel = lambda x, y: rows[y * stride + 1 + x]  # noqa: E731
        self.assertEqual(pixel(0, 0), 255)   # quiet zone
        self.assertEqual(pixel(2, 2), 0)     # module (0,0)
        self.assertEqual(pixel(4, 2), 255)   # module (1,0)
        self.assertEqual(pixel(5, 5), 0)     # module (1,1)


if __name__ == '__main__':
    unittest.main()
