#!/usr/bin/env python3
"""Rebuild HashPageCount from Scraped/ScrapedTrue.

Reads `key<TAB>json` on stdin (the output of `mysql -B`, so newlines and tabs
inside the JSON arrive backslash-escaped) and writes the reload SQL on stdout.

Why it aggregates here rather than in SQL: the equivalent JSON_TABLE group-by
runs over ~17 GB inside MySQL, on the server that also answers the live site.
Streaming the rows out and counting in memory keeps that off the database - the
read is a single sequential scan.

Usage:
    mysql ... -e 'SELECT `key`, value FROM ScrapedTrue' \
      | python3 refresh-hash-page-count.py '2026-08-16 12:45:00.000' \
      | mysql ...
"""

import collections
import json
import re
import sys

# Same predicate as isUsableHash in services/mediasearch.ts. Counting entries
# dmm will never serve would overstate the fan-out.
USABLE = re.compile(r"^[a-f0-9]{40}$")
DEGENERATE = {"da39a3ee5e6b4b0d3255bfef95601890afd80709", "0" * 40}

# TV keys are `tv:ttNNNNNNN:<season>`, so a complete-series pack legitimately
# appears on every season page of its show - a 38-season show would look like 38
# pages of fan-out when it is one title. Counting shows rather than season pages
# is what separates a real pack from a hash smeared across unrelated titles.
TV_SEASON = re.compile(r"^(tv:[^:]+):\d+$")

BATCH = 2000

if len(sys.argv) < 2:
    sys.exit("usage: refresh-hash-page-count.py '<YYYY-MM-DD HH:MM:SS.mmm>'")
TS = sys.argv[1]
if not re.match(r"^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$", TS):
    sys.exit(f"bad timestamp: {TS!r}")

pages = collections.defaultdict(set)
rows = entries = skipped = 0

for line in sys.stdin:
    line = line.rstrip("\n")
    tab = line.find("\t")
    if tab < 0:
        continue
    key, val = line[:tab], line[tab + 1 :]
    if not (key.startswith("movie:") or key.startswith("tv:")):
        continue
    val = val.replace("\\n", "\n").replace("\\t", "\t").replace("\\\\", "\\")
    try:
        arr = json.loads(val)
    except Exception:
        continue
    if not isinstance(arr, list):
        continue
    rows += 1
    season = TV_SEASON.match(key)
    title_key = season.group(1) if season else key
    for e in arr:
        if not isinstance(e, dict):
            continue
        h = e.get("hash")
        if not isinstance(h, str):
            continue
        if not USABLE.match(h) or h in DEGENERATE:
            skipped += 1
            continue
        pages[h].add(title_key)
        entries += 1

out = sys.stdout
out.write("SET autocommit=0;\nSET unique_checks=0;\nSET foreign_key_checks=0;\n")

# Emit in hash order: random primary-key insertion of millions of rows into
# InnoDB is dramatically slower than ascending.
buf = []
written = 0
for h in sorted(pages):
    buf.append(f"('{h}',{len(pages[h])},'{TS}')")
    if len(buf) >= BATCH:
        out.write(
            "INSERT INTO `HashPageCount` (`hash`,`pageCount`,`updatedAt`) VALUES "
            + ",".join(buf)
            + " ON DUPLICATE KEY UPDATE `pageCount`=VALUES(`pageCount`),`updatedAt`=VALUES(`updatedAt`);\n"
        )
        written += len(buf)
        buf = []
        if written % 200000 == 0:
            out.write("COMMIT;\n")
if buf:
    out.write(
        "INSERT INTO `HashPageCount` (`hash`,`pageCount`,`updatedAt`) VALUES "
        + ",".join(buf)
        + " ON DUPLICATE KEY UPDATE `pageCount`=VALUES(`pageCount`),`updatedAt`=VALUES(`updatedAt`);\n"
    )
    written += len(buf)
out.write("COMMIT;\n")

# ON DUPLICATE KEY UPDATE never deletes, so hashes that disappeared from every
# page would linger with a stale count. Anything not restamped this run is gone.
out.write(f"DELETE FROM `HashPageCount` WHERE `updatedAt` <> '{TS}';\nCOMMIT;\n")

sys.stderr.write(
    f"rows {rows}  entries {entries}  hashes {written}  skipped(unusable) {skipped}\n"
)
