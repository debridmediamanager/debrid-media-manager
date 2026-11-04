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
                         'AAC 2.0 · GB IN IN IN · Project.Hail.Mary.2026.1080p.WEB-DL.AAC.2.0.H264-EaZy.mkv')

    def test_a_dead_install_is_a_notice_not_a_source(self):
        sources, notices, cast_url = dmm.parse_streams('rd', fixture('rd-notice-not-connected.json'))
        self.assertEqual((sources, cast_url), ([], None))
        self.assertEqual(notices[0]['text'], 'Set up DMM Cast for Real-Debrid again')
        self.assertEqual(notices[0]['url'], 'https://debridmediamanager.com/stremio')

    def test_own_casts_lead_across_accounts(self):
        other = dict(self.sources[1], service='rd')
        mine = dict(self.sources[0], service='rd')
        ordered, _ = dmm.order_sources([other, self.sources[2], mine])
        self.assertEqual([s['yours'] for s in ordered], [True, False, False])
        self.assertIs(ordered[1], other)

    def test_a_cast_of_a_listed_cached_release_counts_as_new(self):
        # Before: the member's release was already offered as a cached one (not theirs). After they cast
        # it on their phone it is theirs, at the same URL; waiting for an unseen URL would never end.
        after = self.sources
        before = [dict(s, yours=False) for s in after]
        new = dmm.new_own_casts(before, after)
        self.assertEqual([s['filename'] for s in new], ['Project.Hail.Mary.2026.1080p.WEB-DL.AAC.2.0.H264-EaZy.mkv'])
        self.assertEqual(dmm.new_own_casts(after, after), [])

    def test_unwrap_leaves_short_lines_alone(self):
        self.assertEqual(dmm.unwrap_filename(['Some-', 'thing']), ['Some-', 'thing'])


# What Kodi 21.2's xbmc.convertLanguage named these codes on the lab Kodi, through the two-letter code as
# plugin.language_name asks; 'xyz' named nothing.
NAMES = {'eng': 'English', 'hin': 'Hindi', 'tam': 'Tamil', 'tel': 'Telugu', 'rus': 'Russian', 'ukr': 'Ukrainian',
         'spa': 'Spanish', 'fre': 'French', 'fra': 'French', 'ger': 'German', 'deu': 'German', 'ita': 'Italian'}.get


class AudioLanguages(unittest.TestCase):
    # The same title recorded from production on 2026-11-04, once it served audioLanguages; d033… and eae9…
    # have no probe, so no codes.
    def setUp(self):
        self.sources = dmm.parse_streams('pm', fixture('pm-streams-tt12042730-languages.json'))[0]
        self.mine, self.tmt, self.teamhd, self.dayluv, self.btm, self.joshua = self.sources

    def order(self, wanted, hide=False, sources=None):
        return dmm.order_sources(self.sources if sources is None else sources, wanted, NAMES, hide)

    def test_keeps_the_codes_and_none_where_unknown(self):
        self.assertEqual(self.mine['codes'], ['eng', 'hin', 'tam', 'tel'])
        self.assertEqual(self.tmt['codes'], [])
        old = dmm.parse_streams('pm', fixture('pm-streams-tt12042730.json'))[0]
        self.assertEqual([s['codes'] for s in old], [[]] * 6)

    def test_names_b_and_t_codes_once_and_drops_unknown_ones(self):
        self.assertEqual(dmm.audio_names(self.dayluv, NAMES), ['English', 'French', 'Spanish'])  # fra
        self.assertEqual(dmm.audio_names(self.btm, NAMES),
                         ['English', 'Spanish', 'French', 'German', 'Italian', 'Hindi', 'Russian'])  # fre, ger
        self.assertEqual(dmm.audio_names({'codes': ['fre', 'xyz', 'fra', 'deu']}, NAMES), ['French', 'German'])

    def test_wanted_first_then_unknown_then_the_rest_with_own_casts_ahead(self):
        sources, unhidden = self.order('French')
        self.assertEqual(sources, [self.mine, self.dayluv, self.btm, self.tmt, self.joshua, self.teamhd])
        self.assertFalse(unhidden)
        self.assertEqual(self.order('Tamil')[0],
                         [self.mine, self.tmt, self.joshua, self.teamhd, self.dayluv, self.btm])

    def test_hiding_drops_only_releases_known_to_lack_it(self):
        self.assertEqual(self.order('French', hide=True),
                         ([self.mine, self.dayluv, self.btm, self.tmt, self.joshua], False))
        # Your own cast stays though it has no Thai, and so do releases nobody has probed.
        self.assertEqual(self.order('Thai', hide=True), ([self.mine, self.tmt, self.joshua], False))

    def test_hiding_everything_falls_back_to_the_whole_list(self):
        known = [self.teamhd, self.dayluv]
        self.assertEqual(self.order('Thai', hide=True, sources=known), (known, True))
        self.assertEqual(self.order('Thai', hide=True, sources=[]), ([], False))

    def test_off_and_kodis_no_language_choices_change_nothing(self):
        kodi = lambda value: lambda: value  # noqa: E731
        self.assertEqual(dmm.wanted_language('Off', kodi('German')), '')
        for value in ('original', 'mediadefault', 'default', '', None):
            self.assertEqual(dmm.wanted_language(dmm.KODI_LANGUAGE, kodi(value)), '')
        self.assertEqual(dmm.wanted_language(dmm.KODI_LANGUAGE, kodi('German')), 'German')
        self.assertEqual(dmm.wanted_language('', kodi('German')), 'German')  # setting not saved yet
        self.assertEqual(dmm.wanted_language('Tamil', kodi('German')), 'Tamil')
        self.assertEqual(self.order(''), ([self.mine] + self.sources[1:], False))
        self.assertEqual(self.order('', hide=True), ([self.mine] + self.sources[1:], False))

    def test_picker_names_the_languages_before_the_filename_estuary_cuts_short(self):
        self.assertEqual(dmm.source_label2(self.mine, NAMES), 'English, Hindi, Tamil, Telugu · AAC 2.0 · '
                         'Project.Hail.Mary.2026.1080p.WEB-DL.AAC.2.0.H264-EaZy.mkv')
        self.assertTrue(dmm.source_label2(self.dayluv, NAMES).startswith('English, French, Spanish · TrueHD 7.1 · '
                                                                         'Project Hail Mary 2026 2160p IMAX'))
        self.assertTrue(dmm.source_label2(self.btm, NAMES).startswith('English, Spanish, French, German, Italian, '
                                                                      'Hindi, Russian · TrueHD 7.1 · Project'))
        self.assertEqual(dmm.source_label2(self.tmt, NAMES), dmm.source_label2(self.tmt))
        self.assertTrue(dmm.source_label2(self.teamhd).startswith('DD 5.1 · RU UA GB · Project'))


class Trakt(unittest.TestCase):
    # script.trakt (trakt/script.trakt, kodiUtilities.getInfoLabelDetails) reads these as the movie's ids,
    # or as the show's for an episode; without them it guesses from the title.
    def test_names_the_imdb_id_script_trakt_scrobbles_by(self):
        self.assertEqual(json.loads(dmm.trakt_ids('tt0903747')), {'imdb': 'tt0903747'})

    def test_gives_nothing_for_an_id_that_is_not_imdb(self):
        for not_imdb in (None, '', 'kitsu:46474:5', 'tt'):
            self.assertEqual(dmm.trakt_ids(not_imdb), '')


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
