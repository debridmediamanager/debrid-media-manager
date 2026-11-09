<p align="center"><img src="dmm-logo.svg" width="72" alt="Debrid Media Manager logo"></p>

<h1 align="center">Debrid Media Manager</h1>

<p align="center"><b>Build your movie and TV show library with truly unlimited storage.</b></p>

<p align="center">
  <a href="https://debridmediamanager.com/">Website</a> ·
  <a href="https://notes.debridmediamanager.com/dmm/">Docs</a> ·
  <a href="https://discord.com/invite/7u4YjMThXP">Discord</a> ·
  <a href="https://www.reddit.com/r/debridmediamanager/">Reddit</a> ·
  <a href="https://gatekeeper.debridmediamanager.com/">Sponsor</a>
</p>

## What is this?

[Debrid Media Manager](https://debridmediamanager.com/) is a free open source web app for building a movie and TV library without filling a hard drive. It adds torrents to Real-Debrid and AllDebrid and TorBox and Premiumize and Offcloud and Debrid-Link. It also helps you keep the collection tidy.

Two sister projects take it further. [zurg](https://zurg.debridmediamanager.com/) puts every debrid account and Usenet in one folder that Plex and Jellyfin and Emby read like a normal drive. [rex](https://rex.debridmediamanager.com/) is a media server for the Plex apps that owns no files.

## Features

This builds on top of the amazing service brought by [Real-Debrid](https://real-debrid.com/?id=20475782), [AllDebrid](https://alldebrid.com/?uid=1kk5i&lang=en), [TorBox](https://torbox.app/subscription?referral=74ffa560-7381-4a18-adb1-cef97378c670), [Premiumize](https://www.premiumize.me/), [Offcloud](https://offcloud.com/), and [Debrid-Link](https://debrid-link.com/id/diG1t).

### Library management

See your torrents in one place. Sort them by name, size, status or date added. Group them by title and remove duplicates, failed downloads and slow downloads.

**Add** accepts full magnets standalone v1 info hashes and `.torrent` files for Real-Debrid AllDebrid TorBox
Premiumize Offcloud and Debrid-Link. Debrid-Link hash lists stay **cached-only**. Full magnets and `.torrent`
files can start a download. TorBox also accepts direct HTTP(S) links. Debrid-Link **Watch** stays cached-only
and returns an error on a miss.

### Torrent search

Search for torrents and see what your library already has or is downloading. Hashlist bulk downloads include
only releases marked available in Real-Debrid. Individual downloads stay separate.

### Movie and TV show info pages

Browse movie and TV details with cast crew trailers related titles and full person filmographies.

### Stremio integration

Use DMM as a Stremio addon to stream your debrid library. Cast lets you share those streams.

### Trakt integration

Sync your Trakt watchlist collection and custom lists with your library.

### Share your library and mirror other libraries

Share your whole collection or selected items. Browse other public lists in
[r/debridmediamanager](https://www.reddit.com/r/debridmediamanager/) and mirror them into your library.

### Sponsor features

DMM is free and stays free. Sponsorship through [gatekeeper](https://gatekeeper.debridmediamanager.com/) pays for
hosting and unlocks:

- A wanted list for zurg and one-click Easynews handoff.
- Newznab and Torznab feeds for Prowlarr Sonarr and Radarr. Torznab feeds are cached-only. Linked keys unlock TorBox Premiumize and Offcloud.
- Seven Jellyfin plugins for debrid and Usenet libraries. Six Emby plugins for debrid libraries.
- Ten other streams per title in Stremio Cast and Kodi instead of five.
- Priority NZB uploads with 2 TB a day instead of 300 GB and three torrent jobs instead of one.
- DMM naming and sorting in zurg. Known titles reach rex faster with rex-stremio. The DMM API for your tools.

Every 10 filled requests earns 7 days of DMM perks. One fill per person per day counts. Earned time does not include zurg nightlies source remote help or the Discord role. Paid sponsorship includes them. [See every perk and setup step](https://notes.debridmediamanager.com/guides/sponsorship/).

## Setup

1. Have a MySQL database ready
2. Clone this repository
3. Create your local env file: `cp .env.example .env.local` and fill in the details
4. Fill in required settings in `.env.local`:
    - `DATABASE_URL` - Your MySQL connection string
5. (Optional) Configure additional integrations in `.env.local`:
    - `TMDB_KEY`, `OMDB_KEY`, `MDBLIST_KEY` - For enhanced movie/show metadata
    - `TRAKT_CLIENT_ID` and `TRAKT_CLIENT_SECRET` - For Trakt integration
    - `PROXY` - SOCKS5 proxy for stream proxying (e.g. `localhost:9050`)
    - See `.env.example` for all available options
6. Install the dependencies: `npm install`
7. Run the app: `npm run dev` (development) or `npm run build && npm run start` (production)
8. Head to `http://localhost:3000`

Use Node.js 24 and npm 11 for installation, builds and tests. `npm run build`
first runs the required full-source ESLint and Oxlint checks, then Next.js runs
type checking and the production build; invoking `next build` directly bypasses
that required lint gate.
Typed ESLint uses `tsconfig.eslint.json` to cover the application and tool
configuration files, including `vitest.config.ts`, during normal staged-file
hooks without changing the application type-check project's exclusions.

### Offline installation and UI utilities

Production builds generate the Serwist service worker. Application HTML documents
are cached on full navigation and completed frontend routes, with an offline
fallback for uncached documents. API responses remain network-only, including
credential-bearing navigation URLs; worker upgrades remove API entries left by
the previous page cache. Public assets under `noprecache/` are deliberately
excluded from installation downloads, so Cast notice MP4s load only when used.

Tailwind 4 requires Safari 16.4+, Chrome 111+ or Firefox 128+; see its
[browser support requirements](https://tailwindcss.com/docs/upgrade-guide#browser-requirements).
Use the official `outline-hidden` utility when a focus ring needs a
forced-colors outline fallback. Existing visible-sibling layouts use
`sibling-space-x-*` and `sibling-space-y-*`: one spacing owner applies margins
only to following non-hidden siblings, preserving independent trailing margins.
Do not re-register Tailwind's built-in outline or spacing utility names.
The service-worker and library Cypress specs exercise installed caches,
frontend HTML caching, computed spacing and forced-colors keyboard focus.

### Docker

```bash
cp .env.example .env.local
# Fill in your settings in .env.local
docker swarm init
docker stack deploy -c docker-compose.yml dmm
```

The website will be accessible at `http://localhost:3000`

### Log archives

The logship container merges late daily-log lines as complete gzip members. It validates an existing archive before replacing it; an unreadable archive and its late log remain intact for recovery. Maintenance works with POSIX `sh` and does not depend on `pipefail`.

## FAQ

### I just don't know where to start or why do I need this?

[Read the guide here](https://docs.google.com/document/d/13enrfVXcGEEd0Yqb0PBTpGYrIvQpSfeIaAMZ_LiBDzM/edit).

### But with Kodi and FEN and Stremio being available, why would I ever need this?

If you want some level of curation on your library. I personally prefer watching only 100+ GB remux releases. Don't ask me about -arr apps and/or Usenet. I also came from that setup and found it too time consuming to maintain.

### How does it monitor what's in your library?

It doesn't do any sort of monitoring. It gets that information when you open the Library page and caches it in your browser's local storage.

### When I share my library, is it linked to my account's identity?

Account credentials and account identifiers are not included. A shared list contains the chosen title, filenames, magnet hashes, and file sizes, so check those names before sharing. Published pages are public at https://hashlists.debridmediamanager.com. Small lists are compressed into the page's DMM URL; larger lists load a compressed file published beside the page.

## License

This project is licensed under the [AGPL-3.0](LICENSE).

---

**More from DMM:** [Debrid Media Manager](https://debridmediamanager.com/) · [zurg](https://zurg.debridmediamanager.com/) · [rex](https://rex.debridmediamanager.com/) · [Docs](https://notes.debridmediamanager.com/) · [Sponsor](https://gatekeeper.debridmediamanager.com/) · [Discord](https://discord.com/invite/7u4YjMThXP) · [Reddit](https://www.reddit.com/r/debridmediamanager/)
