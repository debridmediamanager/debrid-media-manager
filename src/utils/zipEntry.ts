/**
 * The still-compressed bytes of the first member of a zip whose name `match`es,
 * read through the central directory so only the directory is loaded and the
 * member stays a slice of the file. Deflated members only, and no zip64, which
 * Radarr and Sonarr backups never need.
 */
export async function deflatedZipMember(
	file: Blob,
	match: (name: string) => boolean
): Promise<{ name: string; data: Blob }> {
	const tailStart = Math.max(0, file.size - 65_557);
	const tail = new DataView(await file.slice(tailStart).arrayBuffer());
	let eocd = -1;
	for (let i = tail.byteLength - 22; i >= 0; i--) {
		if (tail.getUint32(i, true) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new Error('This is not a zip file');
	const cdSize = tail.getUint32(eocd + 12, true);
	const cdOffset = tail.getUint32(eocd + 16, true);
	if (cdOffset === 0xffffffff) throw new Error('Zip64 archives are not supported');

	const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
	const decoder = new TextDecoder();
	for (let p = 0; p + 46 <= cd.byteLength && cd.getUint32(p, true) === 0x02014b50;) {
		const method = cd.getUint16(p + 10, true);
		const compressedSize = cd.getUint32(p + 20, true);
		const nameLength = cd.getUint16(p + 28, true);
		const extraLength = cd.getUint16(p + 30, true);
		const commentLength = cd.getUint16(p + 32, true);
		const localOffset = cd.getUint32(p + 42, true);
		const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLength));
		p += 46 + nameLength + extraLength + commentLength;
		if (!match(name)) continue;
		if (method !== 8) throw new Error(`${name} is not deflated`);
		const local = new DataView(await file.slice(localOffset, localOffset + 30).arrayBuffer());
		const start = localOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
		return { name, data: file.slice(start, start + compressedSize) };
	}
	throw new Error('No matching file in the zip');
}
