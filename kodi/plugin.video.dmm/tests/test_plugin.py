"""Menu tests for resources/lib/plugin.py, with stand-ins for Kodi's own modules.

    python3 -m unittest discover -s kodi/plugin.video.dmm/tests

kodi-addon-conditions.json is what Kodi 21.2 answered over JSON-RPC (XBMC.GetInfoBooleans) on 2026-11-09 with
script.trakt and script.simkl installed, then with both disabled.
"""
import json
import os
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
# xbmc* exist only inside Kodi; plugin.py reads a few of them when it loads.
for name in ('xbmc', 'xbmcaddon', 'xbmcgui', 'xbmcplugin', 'xbmcvfs'):
    sys.modules.setdefault(name, mock.MagicMock())
sys.modules['xbmcvfs'].translatePath = lambda path: '/nonexistent'
from resources.lib import plugin  # noqa: E402

with open(os.path.join(HERE, 'fixtures', 'kodi-addon-conditions.json'), encoding='utf-8') as f:
    KODI = json.load(f)


class Home(unittest.TestCase):
    def rows(self, answers, linked=True):
        """Labels on Home for a Kodi linked to DMM (or not) and to neither tracker, answering conditions as `answers`."""
        rows = []
        add = lambda label, *args, **kwargs: rows.append(label)  # noqa: E731
        with mock.patch.object(plugin.xbmc, 'getCondVisibility', side_effect=lambda c: answers.get(c, False)), \
                mock.patch.object(plugin, 'link', return_value={'accounts': []} if linked else {}), \
                mock.patch.object(plugin, 'grant', return_value={}), \
                mock.patch.object(plugin, 'add_action', side_effect=add), \
                mock.patch.object(plugin, 'add_folder', side_effect=add), \
                mock.patch.object(plugin, 'end'):
            plugin.home({})
        return rows

    def test_offers_each_tracker_whose_kodi_addon_is_in_use(self):
        rows = self.rows(KODI['enabled'])
        self.assertIn('Link Trakt', rows)
        self.assertIn('Link Simkl', rows)

    def test_a_disabled_tracker_addon_is_not_in_use(self):
        # Kodi still counts a disabled addon as installed (System.HasAddon is true); Account offers linking.
        rows = self.rows(KODI['disabled'])
        self.assertNotIn('Link Trakt', rows)
        self.assertNotIn('Link Simkl', rows)

    def test_account_is_reachable_with_nothing_linked_and_no_tracker_addon(self):
        # Without it such a Kodi had no way to link a tracker: Home hid the rows and the folder alike.
        rows = self.rows(KODI['disabled'], linked=False)
        self.assertIn('Account', rows)
        self.assertEqual(rows[0], '[B]Link this Kodi[/B]')


if __name__ == '__main__':
    unittest.main()
