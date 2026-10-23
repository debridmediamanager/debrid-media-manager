import { isIPv6 } from 'node:net';

/**
 * bittorrent-tracker's UDP server (lib/server/parse-udp.js) calls `ip.toString`
 * with the announce's optional IPv4 field, a uint32. Buffers of 4 or 16 bytes
 * are accepted too, as the `ip` package did.
 */
function toString(address) {
	if (typeof address === 'number') {
		return [24, 16, 8, 0].map((shift) => (address >>> shift) & 0xff).join('.');
	}
	if (address.length === 4) return [...address].join('.');
	if (address.length === 16) {
		const groups = [];
		for (let i = 0; i < 16; i += 2) groups.push(address.readUInt16BE(i).toString(16));
		// URL serialises an IPv6 host in its canonical compressed form.
		const host = new URL(`http://[${groups.join(':')}]`).hostname.slice(1, -1);
		if (isIPv6(host)) return host;
	}
	throw new TypeError(`Expected a uint32 or a 4- or 16-byte buffer, got ${address}`);
}

export default { toString };
export { toString };
