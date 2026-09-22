#!/usr/bin/env python3
"""Post a built zurg Emby plugin to DMM's sponsor-gated Emby catalog.

Vendored into each *-zurg-for-emby repository as scripts/publish-to-dmm.py and
run by the release job after ./build.sh:

    python3 scripts/publish-to-dmm.py            # the repository this script sits in
    python3 publish-emby-plugin.py <repo dir>    # any other checkout

It reads what build.sh left behind and sends only that: the version from the
csproj (or $VERSION, as build.sh honours), the DLL and its .sha256 from
artifacts/<slug>_<version>/, the plugin id, name and description from
Plugin.cs, and the version's CHANGELOG.md section when there is one. DMM checks
the sha256 against the bytes it received, computes its own digests, and merges
the entry on the plugin id, leaving the other plugins alone. Standard library
only, because a release runner should not need to install anything.

  DMM_PUBLISH_TOKEN  required, the publisher credential (PLUGIN_PUBLISH_SECRET)
  DMM_PUBLISH_URL    optional, for pointing at something other than production
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

DEFAULT_URL = 'https://debridmediamanager.com'
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')


def fail(message: str) -> int:
    print(message, file=sys.stderr)
    return 1


def csharp_string(source: str, pattern: str) -> str | None:
    """The literal a C# member is initialised with, e.g. PluginName = "RD zurg"."""
    match = re.search(pattern + r'\s*"((?:[^"\\]|\\.)*)"', source)
    return match.group(1).replace('\\"', '"').replace('\\\\', '\\') if match else None


def changelog_section(changelog: pathlib.Path, version: str) -> str:
    """The body under `## <version>`, or nothing when the changelog has no such heading."""
    if not changelog.exists():
        return ''
    lines = changelog.read_text(encoding='utf-8').splitlines()
    body: list[str] = []
    taking = False
    for line in lines:
        if line.startswith('## '):
            if taking:
                break
            taking = line[3:].strip().split()[0:1] == [version]
            continue
        if taking:
            body.append(line)
    return '\n'.join(body).strip()


def main() -> int:
    if len(sys.argv) > 2:
        print('Usage: publish-to-dmm.py [repository directory]', file=sys.stderr)
        return 2
    root = (
        pathlib.Path(sys.argv[1]).resolve()
        if len(sys.argv) == 2
        else pathlib.Path(__file__).resolve().parent.parent
    )

    projects = sorted(root.glob('src/Emby.Plugin.*/Emby.Plugin.*.csproj'))
    projects = [p for p in projects if p.stem == p.parent.name]
    if len(projects) != 1:
        return fail(f'Expected one src/Emby.Plugin.<Name>/<same>.csproj under {root}, found {len(projects)}')
    project = projects[0]
    assembly = project.stem + '.dll'

    version = os.environ.get('VERSION') or ET.parse(project).findtext('.//Version') or ''
    if not VERSION.fullmatch(version):
        return fail(f'{project.name} has no four-part <Version> (got {version!r})')

    packages = sorted(p for p in root.glob(f'artifacts/*_{version}') if (p / assembly).is_file())
    if len(packages) != 1:
        return fail(f'Expected one artifacts/<slug>_{version}/{assembly}; run ./build.sh first')
    package = packages[0]

    dll = (package / assembly).read_bytes()
    digest = hashlib.sha256(dll).hexdigest()
    try:
        recorded = (package / (assembly + '.sha256')).read_text().split()[0].lower()
    except (OSError, IndexError):
        return fail(f'{package.name} has no {assembly}.sha256 beside the DLL')
    if recorded != digest:
        return fail(f'{assembly} does not match the sha256 build.sh recorded')

    source = (project.parent / 'Plugin.cs').read_text(encoding='utf-8')
    guid = csharp_string(source, r'Guid\s+Id\s*=>\s*new\s*\(')
    name = csharp_string(source, r'const\s+string\s+PluginName\s*=')
    description = csharp_string(source, r'string\s+Description\s*=>')
    if not (guid and name and description):
        return fail('Could not read the plugin Id, PluginName and Description from Plugin.cs')

    payload = {
        'file': assembly,
        'dll': base64.b64encode(dll).decode('ascii'),
        'sha256': digest,
        'meta': {
            'guid': guid,
            'name': name,
            'description': description,
            'version': version,
            'changelog': changelog_section(root / 'CHANGELOG.md', version),
        },
    }
    print(f'{name} {version}  {assembly}  {len(dll)} bytes  sha256 {digest}')

    token = os.environ.get('DMM_PUBLISH_TOKEN')
    if not token:
        return fail('DMM_PUBLISH_TOKEN is not set')

    base = os.environ.get('DMM_PUBLISH_URL', DEFAULT_URL).rstrip('/')
    request = urllib.request.Request(
        base + '/api/emby-plugins/publish',
        data=json.dumps(payload).encode('utf-8'),
        headers={'Content-Type': 'application/json', 'x-publish-token': token},
        method='POST',
    )

    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            answer = response.read().decode('utf-8')
            print(f'{response.status} {answer[:600]}')
    except urllib.error.HTTPError as error:
        # The body says which check failed; the token is never echoed back.
        return fail(f'HTTP {error.code}: {error.read().decode("utf-8")[:600]}')
    except urllib.error.URLError as error:
        return fail(f'Could not reach {base}: {error.reason}')

    # A 200 is only as good as what the server stored, so hold it to the build's digest.
    try:
        stored = json.loads(answer).get('sha256')
    except ValueError:
        stored = None
    if stored != digest:
        return fail(f'DMM answered sha256 {stored}, expected {digest}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
