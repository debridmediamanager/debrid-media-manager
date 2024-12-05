import bencode from 'bencode';

export const getHashOfTorrent = async (torrent: Blob): Promise<string | undefined> => {
	try {
		// Convert Blob to ArrayBuffer
		const arrayBuffer = await torrent.arrayBuffer();
		const data = Buffer.from(arrayBuffer);

		// Decode torrent data
		const decoded = bencode.decode(data);
		const info = decoded.info;

		if (!info) {
			throw new Error('Invalid torrent file: missing info dictionary');
		}

		// Encode info dictionary
		const encodedInfo = bencode.encode(info);
		const uint8Array = new Uint8Array(encodedInfo);

		// Use Web Crypto API to compute SHA-1 hash
		const hashBuffer = await crypto.subtle.digest('SHA-1', uint8Array);

		// Convert hash to hex string
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray
			.map((byte) => ('0' + byte.toString(16)).slice(-2))
			.join('')
			.toLowerCase();

		return hashHex;
	} catch (error) {
		console.error(
			'Error computing hash from torrent file:',
			error instanceof Error ? error.message : 'Unknown error'
		);
		return undefined;
	}
};
