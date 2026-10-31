#!/usr/bin/env python3
"""Build the Kodi repository DMM serves at /repo/ from the addons under kodi/.

    python3 scripts/build-kodi-repo.py          # rebuild public/repo/
    python3 scripts/build-kodi-repo.py --check  # fail if public/repo/ is not what the sources build

Writes public/repo/: addons.xml (+ .md5), <id>/<id>-<version>.zip with the addon's icon and
fanart beside it, the repository zip again at the top for Kodi's "Install from zip file", and an
index.html Kodi can browse as a file source (it keeps a link only when href equals its text).
Zips are byte-for-byte reproducible, so rebuilding unchanged addons leaves git clean. Bump an
addon's version in its addon.xml for Kodi to offer the update.
"""
import hashlib
import os
import re
import shutil
import filecmp
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'kodi')
OUT = os.path.join(ROOT, 'public', 'repo')
SKIP_DIRS = {'tests', '__pycache__'}


def version_of(xml):
    return re.search(r'<addon\b[^>]*\bversion="([^"]+)"', xml).group(1)


def zip_addon(addon_id, path, dest):
    with zipfile.ZipFile(dest, 'w', zipfile.ZIP_DEFLATED) as z:
        for base, dirs, files in os.walk(path):
            dirs[:] = sorted(d for d in dirs if d not in SKIP_DIRS and not d.startswith('.'))
            for name in sorted(files):
                if name.endswith('.pyc') or name.startswith('.'):
                    continue
                full = os.path.join(base, name)
                info = zipfile.ZipInfo(os.path.join(addon_id, os.path.relpath(full, path)), (2026, 1, 1, 0, 0, 0))
                info.external_attr = 0o644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                with open(full, 'rb') as f:
                    z.writestr(info, f.read())


def build(out):
    shutil.rmtree(out, ignore_errors=True)
    os.makedirs(out)
    bodies, top = [], []
    for addon_id in sorted(os.listdir(SRC)):
        path = os.path.join(SRC, addon_id)
        manifest = os.path.join(path, 'addon.xml')
        if not os.path.isfile(manifest):
            continue
        xml = open(manifest, encoding='utf-8').read()
        version = version_of(xml)
        os.makedirs(os.path.join(out, addon_id))
        name = '%s-%s.zip' % (addon_id, version)
        zip_addon(addon_id, path, os.path.join(out, addon_id, name))
        for asset in ('icon.png', 'fanart.jpg'):
            if os.path.exists(os.path.join(path, asset)):
                shutil.copy(os.path.join(path, asset), os.path.join(out, addon_id, asset))
        if addon_id.startswith('repository.'):
            shutil.copy(os.path.join(out, addon_id, name), os.path.join(out, name))
            top.append(name)
        bodies.append(re.sub(r'^<\?xml[^>]*\?>\s*', '', xml).strip())
        print('%s %s' % (addon_id, version))

    addons_xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<addons>\n%s\n</addons>\n' % '\n'.join(bodies)
    with open(os.path.join(out, 'addons.xml'), 'w', encoding='utf-8') as f:
        f.write(addons_xml)
    with open(os.path.join(out, 'addons.xml.md5'), 'w') as f:
        f.write(hashlib.md5(addons_xml.encode('utf-8')).hexdigest())
    links = '\n'.join('<a href="%s">%s</a><br>' % (n, n) for n in top)
    with open(os.path.join(out, 'index.html'), 'w') as f:
        f.write('<!doctype html>\n<html><head><meta charset="utf-8"><title>DMM Kodi repository</title>'
                '<meta name="robots" content="noindex, nofollow"></head>\n<body>\n%s\n</body></html>\n' % links)


def same_tree(a, b):
    cmp = filecmp.dircmp(a, b)
    return (not cmp.left_only and not cmp.right_only and not cmp.diff_files and not cmp.funny_files
            and all(same_tree(os.path.join(a, d), os.path.join(b, d)) for d in cmp.common_dirs))


def main():
    if '--check' not in sys.argv:
        build(OUT)
        return 0
    with tempfile.TemporaryDirectory() as tmp:
        build(os.path.join(tmp, 'repo'))
        if not same_tree(os.path.join(tmp, 'repo'), OUT):
            print('public/repo/ is stale: run python3 scripts/build-kodi-repo.py and commit it', file=sys.stderr)
            return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
