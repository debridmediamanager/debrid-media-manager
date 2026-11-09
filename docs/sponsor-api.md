# Sponsor API

Endpoints for sponsors' own tools. All take your DMM API key in the
`x-api-key` header and stop working the moment the sponsorship lapses. Identify,
availability and media info allow 2,500 items a minute per address; placement, the
wanted list and shared probes are budgeted per sponsorship. Send full batches.

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

`service` is `rd` (Real-Debrid), `ad` (AllDebrid) or `dl` (Debrid-Link). `imdbId` is optional and
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
size, so match on both. A probe a sponsor's app shared (below) has only the
file's name for its `path`, or an empty one when the app did not know it, so
match those on the size. zurg's own snapshot of a release is answered first.
Hashes nobody has analysed are left out, and so are files inside archives and
Usenet releases, which zurg does not share.

## Share probes

`POST /api/sponsor/probes`, up to 100 probes, 25 calls a minute per sponsorship.

```bash
curl -X POST https://debridmediamanager.com/api/sponsor/probes \
  -H "x-api-key: $DMM_API_KEY" -H 'Content-Type: application/json' \
  -d '{"probes":[{"hash":"<info hash>","bytes":129241752,"name":"Sintel.mp4","MediaInfo":{"streams":[...],"format":{...}}}]}'
```

Send what ffprobe read from single files of torrents, and stored media info
answers it to every sponsor: the next tool to meet that file skips its probe.
`bytes` is the file's exact size and `name` its file name, if you know it.
`MediaInfo` is ffprobe's JSON, at most 256 KB, and its `format.size`, when it has
one, must be `bytes`. The address ffprobe read is dropped.

The first probe of a file (hash and size) is kept. A later one counts in `known`
and changes nothing. The answer is `{"saved": 1, "known": 0}`, with `rejected`
naming each refused probe by its place in the list; the others are kept.

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
top). Send `"parts": true` beside `releases` when your tool reads each file's `part` (below);
without it no file is placed as a part of an episode. Send `imdbId` when you already know the title; an episode's id is read as its show,
and one TMDB cannot use (one it knows nothing by, one whose show it has deleted, or a film's,
for a release whose files name seasons) is set aside for the name. Without one, DMM
identifies the release by its name as `/api/sponsor/identify` does. An anime release (a
fansub's name, or a scene name with Japanese audio or an id TMDB cannot use) is named by the
anime lists' titles when neither names it, when TMDB's Japanese show for the id holds none
of its numbers, and when the id is a film's while the release is a fansub cour of numbered
episodes (`Bleach Sennen Kessen Hen - Kashin Tan - E08`, filed under the Calamity's film).

DMM keeps the releases it could not place, to improve its rules: a release's name, hash,
the paths of its unplaced files and its answer's ids, with how often it was asked. Nothing
says which sponsor asked. A release is dropped once a request places it whole.

```json
{
	"complete": true,
	"releases": [
		{
			"kind": "tv",
			"imdbId": "tt4384306",
			"tmdbId": 62564,
			"title": "Sound! Euphonium",
			"year": 2015,
			"tvdbId": 289884,
			"anime": true,
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
	"rules": "2026-10-26.1"
}
```

The `imdbId` you send is the title unless it places none of the release's numbered files
while DMM's identifier is sure of another title: `The.Magicians.S03` sent as The Ancient
Magus' Bride is answered as The Magicians, and a release whose files read as a title TMDB
cannot number answers that title with its files unplaced. A release with no title of its own
(`Season 3`) is named by its first numbered file. One sent without an id, which the identifier
is unsure of, is named by a title it offers that IMDb or TMDB spells as the name (`KonoSuba` is
one of TMDB's titles for KONOSUBA - God's blessing on this wonderful world!), read as DMM reads it
where the identifier reads on past the title (`Would.I.Lie.to.You-S16E03-Shirley.Ballas…`); where two shows
are named so and both hold the files' numbers (Animaniacs of 1993 and of 2020), by the one
whose episodes the files' titles name, and by neither where no title does. Numbered files nothing
names go to the one show TMDB titles as the name that places the most of them
(`JoJos.Bizarre.Adventure.E25` is the 2012 series, not the 13-episode OVA), or, among several that
place as many, the one TMDB lists as made for the service the name says it was taken from
(`Kingdom.S02E02.1080p.NF…` is Netflix's Korean Kingdom). A film of no numbered
file that neither names is TMDB's one film of the year the name gives titled as it (`The.Bank.1915`
is Chaplin's short), or else titled so before a colon (`Berlin.1927` is Berlin: Symphony of a Great City), and so is one whose id names a show that first aired after that year (the id
sent with `Wings.1927` names the 1990 sitcom). Such a film is TMDB's even where IMDb lists its id as an
episode (`Falsettos.2017` of Live from Lincoln Center). A release whose titled files mostly name
episodes of another show is placed on that show: one TMDB lists under the same name, one the
identifier ranked beside it, or a franchise show holding it as a season (Power Rangers Dino
Charge is TMDB's Power Rangers season 22).

`releases` lines up with the request, and each `files` with its release's. `kind` is
`movie`, `tv` or `null` when DMM cannot tell; `imdbId` and `tmdbId` are the movie's or
the show's, never an episode's, except a film's IMDb id that IMDb lists as an episode, which is
the one TMDB records for the film (`Falsettos.2017`'s tt7140738). `title` and `year` are TMDB's title and first year for that
movie or show, for naming a folder after it (`Sound! Euphonium (2015)`); both are absent where
`tmdbId` is `null` or TMDB gives none. `tvdbId` is a show's TheTVDB id as TMDB records it, which
Plex's show rows carry as `tvdb://<id>`; it is absent for a movie and where TMDB records none, except for a show TVDB files under another series (`how` `tvdbSeries`).
`anime` is `true` for a show that is anime, which zurg files under `__anime__`: TMDB lists it as
Japanese animation (the Animation genre, `original_language` `ja` and `JP` in
`origin_country`, all three), or tags it with the `anime` keyword, which catches Cyberpunk:
Edgerunners (`en`, from Japan, Poland and the US) and One Piece Log: Fish-Man Island Saga
(Action & Adventure, no Animation genre). Any other show is `false` (The Simpsons is Animation
from the US, Alice in Borderland Japanese live action, LINK CLICK Chinese animation). It is
absent for a movie and where `tmdbId` is `null` or TMDB's record of the show could not be read;
read absent as unknown.
A film placed inside a show's release carries its own `title` and `year` beside its ids. `season` and `episode` are TMDB's numbering, so you can
ask TMDB (or `/api/metadata/tmdb:tv:<tmdbId>?season=N`) for that exact episode;
Files placed by `how` `tvdbSeries` carry TVDB's numbering of the series `tvdbId` names instead. With `tmdbId` `null` they are IMDb's numbering of the show `imdbId` names, for a series TMDB cannot use (`how` `imdb`).
`episodeEnd` is the last episode of a multi-episode file (`S04E17E18`). `part`, on every file
of a request that sent `"parts": true`, is the file's part of TMDB's episode, from 1, where it
holds only that part, else `null`: TVDB numbers Lost's season 4 finale as two episodes, E13 and
E14, and TMDB as one 85-minute E13, so `Lost.S04E13` answers S4E13 `part` 1 and `Lost.S04E14`
S4E13 `part` 2, with the same `tmdbEpisodeId`. A file is also a part where its title is one TMDB gives one episode with a part after it (`Star.Wars.Rebels.S02E02.The.Siege.of.Lothal.Part2` is S0E6 "The Siege of Lothal" `part` 2), and where its name says so right
after its episode (`Lost.S01E24.Part.2`, `- pt2`, `cd2`, `disc2`) and another file of the release
is of the same episode, which is then its part 1; `Twin.Peaks.S03E05.Part.5` alone is that
episode's title. Without `"parts": true` a later part is left unplaced, as before, since a tool
that does not read `part` would file it as another copy of the episode. `tmdbEpisodeId` is TMDB's own id for that episode (from TMDB's season list, whichever rule placed the file), which Plex's episode rows carry as `tmdb://<id>`: Plex numbers many shows otherwise than TMDB (Re:ZERO's TMDB S1E84 is Plex's S4E18), so match by it rather than by the numbers. It is `null` where the file is unplaced or placed on IMDb's numbering. A film inside a show's release (`[Movie 02] Heroes Rising` in a My Hero Academia pack, a `Movies` folder, a name with a year in brackets), left unplaced as an episode, is named on its own where DMM can: such a file also carries `kind` `"movie"`, `imdbId` and `tmdbId`, the film's (TMDB's movie id), and no other file carries them. Movies and files
DMM cannot place have `season` and `episode` `null`. A file naming the show's running
number beside its season and episode (`Détective Conan S11E01 - 286`) is placed only where
TMDB's count of the show's episodes reaches that number. `how` says which rule placed a file:

| `how`        | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tmdb`       | The TMDB episode a file's title names, when the release numbers in another order than TMDB (`Firefly.S01E01.Serenity` from a DVD-ordered pack is TMDB's S1E11; packs of shows TMDB lists by segment, `102a-b - The Fast and the Phineas`, a file titled by the segments it holds being the run of episodes they name, with `episodeEnd`, `Hey Arnold! - S01E14 - Tutoring Torvald + Gerald Comes Over` TMDB's S1E26-E27; year-numbered seasons, `MythBusters.S2004E18.Exploding.House`, by a title TMDB gives one episode of that year, the first of the myths a title lists, or a title one of that year's holds alone, `MythBusters.2004x17.Christmas.Special` being "Viewers-Choice/Christmas Special"); a title with the show's name before it on one side only (`Ed, Edd n Eddy (1999) - S00E05 - Big Picture Show` is S0E13 "Ed, Edd n Eddy's Big Picture Show"); a special by its title, where the name gives it no number TMDB lists (`Archer.2009.S03E00.Heart.of.Archness,Pt.1` is S0E3 "Heart of Archness (1)", `To Love-Ru Darkness - OVA - 01 - Prologue - Pollen Plan - Body touch` S0E7, titled by those segments); otherwise the numbers as the name gives them (`S03E04`, `3x04`, a season folder), where TMDB lists them. |
| `anime`      | An anime cour mapped to TMDB: `Hibike Euphonium 3 - 01` is Sound! Euphonium S3E1, a scene `Jujutsu.Kaisen.S03E03` (TVDB's numbering) is TMDB's S1E50.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `imdb`       | IMDb's episode by those numbers, where TMDB has no such episode and files IMDb's under the same show; inside a season TMDB has, only when the file's title agrees, and never where it would put a release's files out of their order. Also every file of a series TMDB cannot use (its find knows nothing by the id, or it has deleted the show) that IMDb lists by season and episode: placed on IMDb's own seasons, `tmdbId` null, by the file's title where it has one (Dragon Ball Z Abridged, `DBZ Abridged - 025 - Nail Is Piccolo, And So Can You!`, is IMDb's S2E15), counted only through a series of one season.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tvdb`       | TVDB's season and episode where TMDB has no such episode, by the show's TVDB Order episode group on TMDB: TMDB numbers One Piece's seasons by absolute episode, so Crunchyroll's `One.Piece.1999.S23E25` is TMDB's S23E1180.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `tvdbSeries` | TVDB's season and episode of the series TVDB files a show under, for a show TMDB lists on its own with no TVDB id, found by each episode's air date (title where two share a date): TMDB's Kitchen Nightmares 2023 numbers `S02E03 Voleos` its S2E3, TVDB and Plex keep the revival as the 2007 series' seasons 7-9, where it is S8E3 (`tvdbId` 80552). Only when every placed file is found on one series at other numbers. A release named as the older series, of a season TMDB's show of it lacks, is answered the same way on TMDB's own show: `The.Amazing.World.of.Gumball.S07E01.The.Burger` is TVDB's S7E1 and TMDB's The Wonderfully Weird World of Gumball (291904) S1E1, found by TMDB's find for the TVDB episode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `aligned`    | TVDB's season and episode, as release groups number them, where TVDB lists the season otherwise than TMDB: the two lists are paired episode by episode, by title first (letters alone, so a week's difference in air dates moves nothing), then by air date within a day, and an episode TMDB lists as long as two of TVDB's is their two parts, as is one TMDB titles by as many segments as TVDB lists that day (TVDB's Freakazoid `S01E02` "Dance of Doom" is part 2 of TMDB's S1E1 "Five Day Forecast / Dance of Doom / Hand Man"; a file of all of them, `S01E14-E15-E16-E17-E18`, is that whole episode). TVDB's `Friends.S06E17` is TMDB's S6E16, since TMDB lists "The One That Could Have Been" as one episode; TVDB's aired order is used, its DVD order for a season the release numbers past both lists (HiQVE's Lost BluRay `S01E25`). A release whose titled files name TMDB's episodes at their own numbers is numbered as TMDB.                                                                                                                                                                                                                                                                                             |
| `dub`        | An English dub's season and episode, for a release named as dubbed, by the show's Dub Order episode group on TMDB: `[Rillant] Medabots S01-03 (English Dubbed)`'s S03E01 is TMDB's S2E1, the dub's third season being TMDB's second.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `group`      | A pack numbered in one of the show's TMDB episode groups rather than as TMDB aired it: the group whose seasons hold exactly as many episodes as the pack's, in more seasons than TMDB's own list, used for the seasons TMDB's list does not match. `Futurama HD PL` numbers seasons 7-10 by 13 as TMDB's "Digital Order" does, so its `s07e01` is TMDB's S6E1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `absolute`   | A number with no season (`One Piece - 1100`), counted through TMDB's seasons; never for a fansub title the anime lists do not know, of a show they map season by season (`Pocket Monsters - Aim to be a Pokémon Master 10` is no tenth episode of Pokémon). A fansub number of a later cour the anime lists know is counted only where it runs past every episode of that cour's season: `[DB]Gintama (2017)_-_317_` is TMDB's S8E1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `airdate`    | A daily show's file named by the day it aired and no episode (`WWE.RAW.2026.10.05`, `WWE Monday Night RAW 2026 10 12`, or the day and month before the year), as the one episode TMDB lists as aired that day: Raw's S34E40. A name with an episode as well is placed by its numbers.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

One Pace (onepace.net), the fan re-edit of One Piece, is a show no TMDB, IMDb or Plex record
numbers, so DMM numbers it by One Pace's own list. A release whose name, or every file's name,
starts `[One Pace]` is answered with `kind`, `imdbId`, `tmdbId` and every file's `season`,
`episode`, `how` and `tmdbEpisodeId` `null`, as a release DMM cannot place, so a tool that does
not read the fields below keeps it unplaced, never on One Piece's episodes. Beside them:

```json
{
	"anime": true,
	"files": [
		{
			"path": "[One Pace][340-342] Water Seven 08 [1080p][6E2DB1B9].mkv",
			"season": null,
			"episode": null,
			"episodeEnd": null,
			"how": null,
			"tmdbEpisodeId": null,
			"series": {
				"season": 16,
				"episode": 8,
				"title": "…",
				"summary": "…",
				"thumb": "https://onepace.net/…"
			}
		}
	],
	"imdbId": null,
	"kind": null,
	"series": {
		"key": "onepace",
		"title": "One Pace",
		"summary": "One Pace is a fan project that recuts the One Piece anime…",
		"poster": "https://onepace.net/_next/static/media/….jpg",
		"art": "https://onepace.net/_next/static/media/….jpg",
		"seasons": [
			{
				"season": 16,
				"title": "Water Seven",
				"summary": "…",
				"poster": "https://onepace.net/…"
			}
		]
	},
	"tmdbId": null
}
```

`series` names the show: `key` is the same for every release of it, so files of different
releases are episodes of one show, and `seasons` describes each season the release's numbered
files are on, an arc of One Pace's. Each main arc is a season in One Pace's order (Romance Dawn
1 to Egghead 33, as One Pace numbers its arcs); its cover-story arcs and specials are season 0,
in the list's order (The Adventures of Buggy's Crew is S00E01). A file's `series` is its episode,
with One Pace's title, summary and still; a file without one is unplaced. A file is matched by
the manga chapters its name covers (`[340-342]`, `Chapter 700-701` in a release named for its
arc), which are unique to an episode, and its arc and number must agree: a file of a cut One
Pace has since re-edited onto other chapters or numbers matches nothing. A release none of whose
files is matched answers without `series` and `anime`. Artwork is onepace.net's own. DMM reads
One Pace's list off onepace.net once a day, keeping the list it has when the page cannot be
read, so a new episode is placed within a day of One Pace publishing it.

`rules` names the placement rules the answer was made by. DMM changes it whenever it places releases differently; an answer you keep from other rules is worth asking about again, which is how zurg picks up DMM's fixes for releases it has already placed.

`complete: false` means some releases could not be answered in this call: they ran past
its time budget, or needed the identifier or TMDB while either was unreachable. Each such
release comes back in its slot with `kind`, `imdbId` and `tmdbId` `null` and every file's
`season`, `episode` and `episodeEnd` `null`, in the request's order, and `"skipped": true`;
send it again later. A release DMM looked at and could not identify still answers what it
knows, such as the `imdbId` you sent (an episode's as its show's), so only one DMM knows
nothing about at all has the skipped shape without being skipped.

## Wanted list

The titles you added to your wanted list on DMM, for a tool that fetches them; zurg's
acquisition reads it. Both calls share 30 a minute per sponsorship.

`GET /api/sponsor/wanted`

```json
{
	"items": [
		{
			"id": "0b7c2f8e-…",
			"kind": "movie",
			"title": "The Matrix",
			"imdb": "tt0133093",
			"year": 1999,
			"tmdb": 603,
			"titles": ["The Matrix", "Matrix", "Матрица"],
			"released": "1999-09-21",
			"runtime": 136,
			"upgrade": { "grab": "<info hash>", "resolution": "1080p", "to": "2160p" }
		},
		{
			"id": "5d1e…",
			"kind": "show",
			"title": "3rd Rock from the Sun",
			"imdb": "tt0115082",
			"year": 1996,
			"tmdb": 155,
			"seasons": [{ "season": 1, "episodes": [1, 2, 3] }]
		}
	]
}
```

`seasons` lists, for each season wanted, the episodes aired so far, numbered as TMDB
numbers them; specials are never listed. An airing season grows as episodes air and
carries `"airing": true` while TMDB lists episodes still to come. `aired` is the day
the season's last listed episode aired, as `2006-01-02`, when it is the newest episode
the show has aired: a fetcher can search for it often in the hours after.
`runtime` is a film's length in minutes, as TMDB has it, and absent when TMDB has none.
`released` is the first day a film could be had at home, as `2006-01-02`: its earliest
digital, physical or TV release in any country TMDB lists. It is never a cinema date,
and is absent when TMDB knows none, as it often does not for a film still in cinemas or
long out.
`titles` lists every title TMDB knows a film by, its original title, alternatives and
translations, so a fetcher can refuse a release filed under the film's IMDb id that
names another film; it is absent when TMDB could not be asked.
`seasons` is absent when TMDB could not be asked this time, which means ask again
later, not that nothing aired. `year`, `tmdb` and `tvdb` are absent where TMDB does
not know the title.
`upgrade` is on a film fetched already whose fetcher wants a better release: `grab` and
`resolution` are what it said it holds, `to` the resolution it wants. DMM only echoes
what the last acknowledgement said.

`GET /api/sponsor/wanted?bands=1080p,2160p` is for a fetcher that keeps a copy of each
film at several resolutions. A film then stays on the list until every band named holds
a copy its fetcher wants no better than, and carries `bands` in place of `upgrade`:

```json
"bands": {
	"1080p": { "grab": "<info hash>", "resolution": "1080p" },
	"2160p": { "grab": "<info hash>", "resolution": "1080p", "to": "2160p" }
}
```

A band missing from `bands` has no copy yet. A band with `to` holds one its fetcher wants
bettered. `bands` takes `720p`, `1080p` and `2160p`, separated by commas.

`pins` lists the releases you picked with **Send to zurg** on a title's Easynews results,
for a fetcher to take as they are instead of searching. It is absent when there are none:

```json
"pins": [
	{
		"id": "9e26b9f3327b7175604928437b0766cf04ea695054e26",
		"release": "Show.S02E05.1080p.WEB.H264-GRP.mkv",
		"nzb": "https://debridmediamanager.com/api/newznab/api?t=get&id=<token>&apikey=<your DMM API key>",
		"size": 3221225472,
		"season": 2,
		"episode": 5
	}
]
```

`id` (up to 64 characters) stays the same for the same release, `release` is its file
name with the extension, `nzb` is its NZB from DMM's Newznab endpoint, carrying the key
the list was read with, and `size` is in bytes, `0` when unknown. A film holds at most
one pin; a new pick replaces it and starts the film over. A show holds one per episode,
with `season` and `episode` (a multi-episode file's first); a show on the list only for
its pins follows no season, so its `seasons` is empty. A film with a pin leaves the list
once acknowledged, `bands` or not.

`POST /api/sponsor/wanted/complete` says the title was fetched:

```json
{
	"grab": "<info hash>",
	"id": "0b7c2f8e-…",
	"release": "The.Matrix.1999.1080p.BluRay.x264-GRP",
	"resolution": "1080p",
	"torrent": true,
	"upgrade_to": "2160p"
}
```

Only `id` is required. `release` (up to 512 characters) is the release taken, `grab` (up
to 64) the fetcher's id of it, such as an info hash or NZB id, and `resolution` one of
`""`, `480p`, `720p`, `1080p` and `2160p`. `upgrade_to`, one of `720p`, `1080p` and
`2160p`, needs a `resolution`, and keeps a film on the list, with `upgrade`, until an
acknowledgement without `upgrade_to`. Each acknowledgement replaces the last one's
fields; the first date stands, so repeating it is harmless. A film without `upgrade_to`
then leaves the list; a show stays on it so new episodes are fetched. 400 names a
malformed field; 404 means the item is no longer on the list.

`band`, one of `720p`, `1080p` and `2160p`, is the resolution this copy is kept at, for
a fetcher that asked for `?bands=`. The acknowledgement then replaces only that band's
record and leaves the others alone.

## Seerr, Overseerr and Jellyseerr

DMM answers as a Radarr and a Sonarr, so requests approved in Seerr land on your wanted
list. In Seerr, Settings → Services, add a Radarr server and a Sonarr server with:

| Field                         | Radarr                   | Sonarr                   |
| ----------------------------- | ------------------------ | ------------------------ |
| Hostname or IP                | `debridmediamanager.com` | `debridmediamanager.com` |
| Port                          | `443`                    | `443`                    |
| Use SSL                       | on                       | on                       |
| API Key                       | your DMM API key         | your DMM API key         |
| URL Base                      | `/api/arr/radarr`        | `/api/arr/sonarr`        |
| Quality Profile / Root Folder | `Any` / `/dmm`           | `Any` / `/dmm`           |

Tick Default Server and Enable Scan. A film request adds the film; a show request adds the
seasons asked for, and once every season is asked for the show is followed whole, new seasons
included. Deleting a title in Seerr with its file removes it from the list. Seerr's Radarr scan
shows a film as available once zurg has fetched it; shows stay "processing" until Seerr's
Plex or Jellyfin scan finds the episodes. Calls share 120 a minute per sponsorship.
