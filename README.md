![ChatGPT made this logo](./dmm-logo.svg)

# Debrid Media Manager

Start building your media library with truly unlimited storage size!

## What is this?

Do you want a movie and TV show library that has unlimited size? Consider using a Debrid service, like Real-Debrid or AllDebrid. These services work like a shared storage space for downloading torrents. You can download as much as you want without worrying about storage limits, because the files are shared among all users. You only "own" the file when you download it to your account.

These Debrid services also offer a feature called a WebDAV API. Think of it as a special tool that lets you connect your media library to different devices or software. It's like your Windows Samba share but better.

You can use this WebDAV API to connect your media library to different media players that support it, like [Infuse](https://firecore.com/infuse), which works on Apple devices like Mac, iPhone, Apple TV, and iPad. You can also connect it to your server and use it with media server software like Plex, Emby, or Jellyfin. This way, your media library can be accessed and played from anywhere!

To make this process even easier, I've developed this **free** and open source website called [Debrid Media Manager](https://debridmediamanager.com/). With this app, you can easily download movies and TV shows directly to your Debrid library. You can build and curate your media collection without ever worrying about storage limits.

## Features

This builds on top of the amazing service brought by [Real-Debrid](http://real-debrid.com/?id=440161) and [AllDebrid](https://alldebrid.com/?uid=1kk5i&lang=en).

### Library management

You can see all your torrents in one page, sort them by name, by size, by "quality score", etc. It groups all your torrents by title and delete duplicate files. It can show you failed or slow downloads and delete them.

### Torrent search

You can add more content to your library by searching the DHT (powered by BtDigg). It detects what you already have downloaded and currently downloading in your library too.

### Share your library and mirror other libraries

You can share your whole collection or select specific items you want to share. Head over to [r/debridmediamanager](https://www.reddit.com/r/debridmediamanager/) and see other people's media collections and easily mirror their content to yours.

## Setup

0. Signup for a free tier plan at [PlanetScale](https://planetscale.com/) - this is a serverless MySQL database hosted in the cloud
1. Have Tor running at `127.0.0.1:9050` (needed for DHT search; if you don't need your own search database then refer to the secion `External Search API`)
2. Clone this repository and go to the directory
3. Create a copy of the `.env` file `cp .env .env.local` and fill in the details
4. Fill in required settings in `.env.local` (e.g. `PROXY=socks5h://127.0.0.1:9050` if tor is running on your host machine)
5. Get your Prisma database connection string from PlanetScale console and put that in your `.env.local` file
6. Install the dependencies `npm i`
7. This is a Next.js project so either go with `npm run dev` or `npm run build && npm run start`
8. Head to `localhost:3000` and login

### External Search API

If you don't want to build your own library, edit the config `EXTERNAL_SEARCH_API_HOSTNAME` in your `.env.local` and set it to `https://corsproxy.org/?https://debridmediamanager.com`

### Docker Swarm

```
cp .env .env.local
docker swarm init
docker stack deploy -c docker-compose.yml
```

The website will be accessible at `http://localhost:3000`

## FAQ

### I just don't know where to start or why do I need this?

[Read the guide here](https://docs.google.com/document/d/13enrfVXcGEEd0Yqb0PBTpGYrIvQpSfeIaAMZ_LiBDzM/edit). I highlighted my tested setup in green.
### But with Kodi and FEN and Stremio being available, why would I ever need this?

If you want some level of curation on your library. I personally prefer watching only 100+ GB remux release. Don't ask me about -arr apps and/or Usenet. I also came from that setup and found it too much time consuming to maintain.

### How does it monitor what's in your library?

It doesn't do any sort of monitoring. It gets that information when you open the Library page and caches it in your browser's local storage.

### When I share my library, is it linked to my account's identity?

No. It's completely anonymous. What's only shared are 3 things: filename, magnet hash, file size. It's not even stored in any database. The way it works is that all these data are compressed and stored in the URL. A "webpage" is then created over at https://hashlists.debridmediamanager.com that loads via iframe this (usually very long) list of magnet hashes.
