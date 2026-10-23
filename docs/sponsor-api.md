# Sponsor API

Four endpoints for sponsors' own tools. All take your DMM API key in the
`x-api-key` header and stop working the moment the sponsorship lapses. The first three
allow 2,500 items a minute per address; placement is budgeted per sponsorship. Send
full batches.

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
confirm a title. A file whose episode another file of the same release is titled as, and whose own title names
nothing TMDB lists, is left unplaced rather than given that episode.

`complete: false` means the identifier was unreachable, so ask
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

## Place releases on TMDB

`POST /api/sponsor/place`, up to 100 releases and 2,000 files a call, 60 calls a minute
per sponsorship wherever your servers run.

```bash
curl -X POST https://debridmediamanager.com/api/sponsor/place \
  -H "x-api-key: $DMM_API_KEY" -H 'Content-Type: application/json' \
  -d '{"releases":[{"name":"[Erai-raws] Hibike Euphonium 3 - 01 [1080p][Multiple Subtitle][F15A9CDD].mkv","files":[{"path":"[Erai-raws] Hibike Euphonium 3 - 01 [1080p][Multiple Subtitle][F15A9CDD].mkv","folder":""}]}]}'
```

Each release is `{name, hash?, imdbId?, files: [{path, folder}]}`: `path` is the file's
name and `folder` the folder the provider lists it in inside the release (`""` at the
top). Send `imdbId` when you already know the title; an episode's id is read as its show,
and one TMDB cannot use (one it knows nothing by, one whose show it has deleted, or a film's,
for a release whose files name seasons) is set aside for the name. Without one, DMM
identifies the release by its name as `/api/sponsor/identify` does. An anime release (a
fansub's name, or a scene name with Japanese audio or an id TMDB cannot use) is named by the
anime lists' titles when neither names it, when TMDB's Japanese show for the id holds none
of its numbers, and when the id is a film's while the release is a fansub cour of numbered
episodes (`Bleach Sennen Kessen Hen - Kashin Tan - E08`, filed under the Calamity's film).

```json
{
	"complete": true,
	"releases": [
		{
			"kind": "tv",
			"imdbId": "tt4384306",
			"tmdbId": 62564,
			"files": [
				{
					"path": "[Erai-raws] Hibike Euphonium 3 - 01 [1080p][Multiple Subtitle][F15A9CDD].mkv",
					"season": 3,
					"episode": 1,
					"episodeEnd": null,
					"how": "anime",
					"tmdbEpisodeId": 4703269
				}
			]
		}
	],
	"rules": "2026-10-23.2"
}
```

The `imdbId` you send is the title unless it places none of the release's numbered files
while DMM's identifier is sure of another title: `The.Magicians.S03` sent as The Ancient
Magus' Bride is answered as The Magicians, and a release whose files read as a title TMDB
cannot number answers that title with its files unplaced. A release with no title of its own
(`Season 3`) is named by its first numbered file. A release whose titled files mostly name
episodes of another show is placed on that show: one TMDB lists under the same name, one the
identifier ranked beside it, or a franchise show holding it as a season (Power Rangers Dino
Charge is TMDB's Power Rangers season 22).

`releases` lines up with the request, and each `files` with its release's. `kind` is
`movie`, `tv` or `null` when DMM cannot tell; `imdbId` and `tmdbId` are the movie's or
the show's, never an episode's. `season` and `episode` are TMDB's numbering, so you can
ask TMDB (or `/api/metadata/tmdb:tv:<tmdbId>?season=N`) for that exact episode;
With `tmdbId` `null` they are IMDb's numbering of the show `imdbId` names, for a series TMDB cannot use (`how` `imdb`).
`episodeEnd` is the last episode of a multi-episode file (`S04E17E18`). `tmdbEpisodeId` is TMDB's own id for that episode (from TMDB's season list, whichever rule placed the file), which Plex's episode rows carry as `tmdb://<id>`: Plex numbers many shows otherwise than TMDB (Re:ZERO's TMDB S1E84 is Plex's S4E18), so match by it rather than by the numbers. It is `null` where the file is unplaced or placed on IMDb's numbering. Movies and files
DMM cannot place have `season` and `episode` `null`. A file naming the show's running
number beside its season and episode (`Détective Conan S11E01 - 286`) is placed only where
TMDB's count of the show's episodes reaches that number. `how` says which rule placed a file:

| `how`      | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb`     | The TMDB episode a file's title names, when the release numbers in another order than TMDB (`Firefly.S01E01.Serenity` from a DVD-ordered pack is TMDB's S1E11; packs of shows TMDB lists by segment, `102a-b - The Fast and the Phineas`; year-numbered seasons, `MythBusters.S2004E18.Exploding.House`); otherwise the numbers as the name gives them (`S03E04`, `3x04`, a season folder), where TMDB lists them.                                                                                                                                                                                                         |
| `anime`    | An anime cour mapped to TMDB: `Hibike Euphonium 3 - 01` is Sound! Euphonium S3E1, a scene `Jujutsu.Kaisen.S03E03` (TVDB's numbering) is TMDB's S1E50.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `imdb`     | IMDb's episode by those numbers, where TMDB has no such episode and files IMDb's under the same show; inside a season TMDB has, only when the file's title agrees, and never where it would put a release's files out of their order. Also every file of a series TMDB cannot use (its find knows nothing by the id, or it has deleted the show) that IMDb lists by season and episode: placed on IMDb's own seasons, `tmdbId` null, by the file's title where it has one (Dragon Ball Z Abridged, `DBZ Abridged - 025 - Nail Is Piccolo, And So Can You!`, is IMDb's S2E15), counted only through a series of one season. |
| `tvdb`     | TVDB's season and episode where TMDB has no such episode, by the show's TVDB Order episode group on TMDB: TMDB numbers One Piece's seasons by absolute episode, so Crunchyroll's `One.Piece.1999.S23E25` is TMDB's S23E1180.                                                                                                                                                                                                                                                                                                                                                                                               |
| `dub`      | An English dub's season and episode, for a release named as dubbed, by the show's Dub Order episode group on TMDB: `[Rillant] Medabots S01-03 (English Dubbed)`'s S03E01 is TMDB's S2E1, the dub's third season being TMDB's second.                                                                                                                                                                                                                                                                                                                                                                                       |
| `absolute` | A number with no season (`One Piece - 1100`), counted through TMDB's seasons; never for a fansub title the anime lists do not know, of a show they map season by season (`Pocket Monsters - Aim to be a Pokémon Master 10` is no tenth episode of Pokémon).                                                                                                                                                                                                                                                                                                                                                                |

`rules` names the placement rules the answer was made by. DMM changes it whenever it places releases differently; an answer you keep from other rules is worth asking about again, which is how zurg picks up DMM's fixes for releases it has already placed.

`complete: false` means some releases could not be answered in this call: they ran past
its time budget, or needed the identifier or TMDB while either was unreachable. Each such
release comes back in its slot with `kind`, `imdbId` and `tmdbId` `null` and every file's
`season`, `episode` and `episodeEnd` `null`, in the request's order, and `"skipped": true`;
send it again later. A release DMM looked at and could not identify still answers what it
knows, such as the `imdbId` you sent (an episode's as its show's), so only one DMM knows
nothing about at all has the skipped shape without being skipped.
