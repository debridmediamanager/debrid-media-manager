# Sponsor API

Three endpoints for sponsors' own tools. All take your DMM API key in the
`x-api-key` header and stop working the moment the sponsorship lapses. Each allows
2,500 items a minute, so send full batches.

## Identify releases by filename

`POST /api/sponsor/identify`, up to 500 items, 5 calls a minute per address.

```bash
curl -X POST https://debridmediamanager.com/api/sponsor/identify \
  -H "x-api-key: $DMM_API_KEY" -H 'Content-Type: application/json' \
  -d '{"items":[{"filename":"The.Matrix.1999.1080p.BluRay.x264","hash":"<info hash>"}]}'
```

`results` lines up with `items`. Each entry is `{imdbId, title, year, kind}` with
`kind` either `movie` or `tv`, or `null` when DMM is not sure enough to name it.
The hash is optional. With it, answers are cached and DMM's own hash map can
confirm a title. `complete: false` means the identifier was unreachable, so ask
again later for the `null` rows.

To look up what DMM already has on record for a hash, without a filename, use
`POST /api/torrents/identify` with `{"hashes":[...]}` instead, up to 500 hashes,
5 calls a minute per address. It answers only for hashes DMM has seen and leaves
the rest out.

## Cached availability DMM has seen

`POST /api/sponsor/availability`, up to 100 hashes, 25 calls a minute per address.

```bash
curl -X POST https://debridmediamanager.com/api/sponsor/availability \
  -H "x-api-key: $DMM_API_KEY" -H 'Content-Type: application/json' \
  -d '{"service":"rd","imdbId":"tt0133093","hashes":["<info hash>"]}'
```

`service` is `rd` (Real-Debrid) or `ad` (AllDebrid). `imdbId` is optional and
limits the answer to that title. `available` lists the hashes DMM users have found
cached, with their files. A hash missing from it has not been seen cached, which
does not mean it is not.

## Stored media info

`POST /api/sponsor/mediainfo`, up to 100 hashes, 25 calls a minute per address.

```bash
curl -X POST https://debridmediamanager.com/api/sponsor/mediainfo \
  -H "x-api-key: $DMM_API_KEY" -H 'Content-Type: application/json' \
  -d '{"hashes":["<info hash>"]}'
```

zurg shares what ffprobe reads from each file it analyses: streams, codecs,
languages, HDR and duration. This answers that for each hash, so your tools do not
have to download anything to learn it:

```json
{"releases":{"<info hash>":{"files":{"<file>":{"path":"/The.Matrix.1999.mkv","bytes":15237850498,"MediaInfo":{"streams":[...],"format":{...}}}}}}}
```

`MediaInfo` is ffprobe's own JSON (`-show_format -show_streams`), without the
address it was read from. A probe describes the file at `path` with that exact
size, so match on both. Hashes nobody has analysed are left out, and so are
files inside archives and Usenet releases, which zurg does not share.
