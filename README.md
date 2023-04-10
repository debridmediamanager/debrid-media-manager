![Alt text](./dmm-logo.svg)
<img src="./dmm-logo.svg">

# Debrid Media Manager

Start building your media library with truly unlimited storage size

## Features

This builds on top of the amazing service brought by [Real-Debrid](http://real-debrid.com/?id=440161) and [AllDebrid](https://alldebrid.com/?uid=1kk5i&lang=en).

### Library management

You can see all your torrents in one page, sort them by name, by size, by "quality score", etc. It groups all your torrents by title and delete duplicate files. It can show you failed or slow downloads and delete them.

### Torrent search

You can add more content to your library by searching the DHT (powered by BtDigg). It detects what you already have downloaded and currently downloading in your library too.

### Share your library and mirror other libraries

You can share your whole collection or select specific items you want to share. Head over to [r/debridmediamanager](https://www.reddit.com/r/debridmediamanager/) and see other people's media collections and easily mirror their content to yours.

## Setup

0. Have Tor running at `127.0.0.1:9050` (needed for DHT search; if you don't use that then it's not needed)
1. Clone this repository
2. Install the dependencies `npm i`
3. This is a Next.js project so either go with `npm run dev` or `npm run build && npm run start`
4. Head to `localhost:3000` and login

## FAQ

### I just don't know where to start or why do I need this?

[Read the guide here](https://docs.google.com/document/d/13enrfVXcGEEd0Yqb0PBTpGYrIvQpSfeIaAMZ_LiBDzM/edit). I highlighted my tested setup in green.
### But with Kodi and FEN and Stremio being available, why would I ever need this?

If you want some level of curation on your library. I personally prefer watching only 100+ GB remux release. Don't ask me about -arr apps and/or Usenet. I also came from that setup and found it too much time consuming to maintain.

### How does it monitor what's in your library?

It doesn't do any sort of monitoring. It gets that information when you open the Library page and caches it in your browser's local storage.
