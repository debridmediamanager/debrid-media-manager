/**
 * Strip the filename patterns Real-Debrid rejects with `451 infringing_file`.
 * Same rewrite the debrid uploader service applies before building a torrent
 * (see debrid/src/naming.ts), so a title produced here matches what actually
 * lands in the RD account: `WEB-DL` -> `WEB.DL`, `BluRay.x264` -> `BluRay-x264`,
 * `BDRip` -> `BD-Rip`. Newer codecs (x265/HEVC/AV1) and service tags are never
 * blocked, so they pass untouched.
 */
export function deInfringe(name: string): string {
	return name
		.replace(/(bluray|hdtv|web)\.(x264|xvid|h264)/gi, '$1-$2')
		.replace(/web-dl/gi, (m) => m.replace('-', '.'))
		.replace(/(web|bd|hd|dvd)rip/gi, (m) => m.replace(/rip$/i, (r) => `-${r}`));
}
