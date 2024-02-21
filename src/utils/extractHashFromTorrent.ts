import axios from 'axios';
import bencode from 'bencode';
import { createHash } from 'crypto';

export function extractHashFromMagnetLink(magnetLink: string) {
	const regex = /urn:btih:([A-Fa-f0-9]+)/;
	const match = magnetLink.match(regex);
	if (match) {
		return match[1].toLowerCase();
	} else {
		return undefined;
	}
}

export async function computeHashFromTorrent(url: string): Promise<string | undefined> {
	try {
		const response = await axios.get(url, {
			maxRedirects: 0, // Set maxRedirects to 0 to disable automatic redirects
			validateStatus: (status) => status >= 200 && status < 400,
			responseType: 'arraybuffer',
			timeout: 10000,
		});

		if (response.status === 302) {
			const redirectURL = response.headers.location;
			if (redirectURL.startsWith('magnet:')) {
				return extractHashFromMagnetLink(redirectURL);
			}
		}

		const info = bencode.decode(response.data).info;
		const encodedInfo = bencode.encode(info);
		const infoHash = createHash('sha1').update(encodedInfo).digest();
		const magnetHash = Array.prototype.map
			.call(new Uint8Array(infoHash), (byte) => {
				return ('0' + byte.toString(16)).slice(-2);
			})
			.join('');

		return magnetHash.toLowerCase();
	} catch (error: any) {
		console.error('getMagnetURI error:', error.message, url);
		return undefined;
	}
}
