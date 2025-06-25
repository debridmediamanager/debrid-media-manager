import { getTimeISO } from '@/services/realDebrid';

const salt = 'debridmediamanager.com%%fe7#td00rA3vHz%VmI';

export async function generateTokenAndHash(): Promise<[string, string]> {
	const token = generateRandomToken(); // Generate a secure random token
	const timestamp = await fetchTimestamp(); // Fetch the timestamp from the API
	const tokenWithTimestamp = `${token}-${timestamp}`;
	const tokenTimestampHash = await generateHash(tokenWithTimestamp); // Hash the token with the timestamp
	const tokenSaltHash = await generateHash(`${salt}-${token}`); // Hash the token with the salt
	const combinedHash = combineHashes(tokenTimestampHash, tokenSaltHash);
	return [tokenWithTimestamp, combinedHash]; // Return both the token with embedded timestamp and its hash
}

async function fetchTimestamp(): Promise<number> {
	const response = await getTimeISO();
	const timestamp = Math.floor(new Date(response).getTime() / 1000);
	return timestamp;
}

function generateRandomToken(): string {
	const array = new Uint32Array(1);
	window.crypto.getRandomValues(array);
	return array[0].toString(16);
}

function generateHash(str: string) {
	let hash1 = 0xdeadbeef ^ str.length;
	let hash2 = 0x41c6ce57 ^ str.length;

	for (let i = 0; i < str.length; i++) {
		let charCode = str.charCodeAt(i);
		hash1 = Math.imul(hash1 ^ charCode, 2654435761);
		hash2 = Math.imul(hash2 ^ charCode, 1597334677);
		hash1 = (hash1 << 5) | (hash1 >>> 27); // Rotate left
		hash2 = (hash2 << 5) | (hash2 >>> 27); // Rotate left
	}

	hash1 = (hash1 + Math.imul(hash2, 1566083941)) | 0;
	hash2 = (hash2 + Math.imul(hash1, 2024237689)) | 0;

	return ((hash1 ^ hash2) >>> 0).toString(16); // Return as unsigned 32-bit integer in hexadecimal
}

// Validate the token with the hash, called by the server
export function validateTokenWithHash(tokenWithTimestamp: string, receivedHash: string): boolean {
	const [token, timestampStr] = tokenWithTimestamp.split('-');
	const timestamp = parseInt(timestampStr, 10);
	const currentTimestamp = Math.floor(Date.now() / 1000);
	const threshold = 300; // seconds (5 minutes)
	if (Math.abs(currentTimestamp - timestamp) > threshold) {
		return false; // Token expired
	}
	// Recreate the hash with the received tokenWithTimestamp and compare
	const tokenTimestampHash = generateHash(tokenWithTimestamp);
	const tokenSaltHash = generateHash(`${salt}-${token}`);
	const combinedHash = combineHashes(tokenTimestampHash, tokenSaltHash);
	return combinedHash === receivedHash;
}

function combineHashes(hash1: string, hash2: string) {
	// Split the hashes into halves
	const halfLength = Math.floor(hash1.length / 2);
	const firstPart1 = hash1.slice(0, halfLength);
	const secondPart1 = hash1.slice(halfLength);
	const firstPart2 = hash2.slice(0, halfLength);
	const secondPart2 = hash2.slice(halfLength);

	// Interleave parts from both hashes
	let obfuscated = '';
	for (let i = 0; i < halfLength; i++) {
		obfuscated += firstPart1[i] + firstPart2[i];
	}

	// Add the remaining parts in reverse
	obfuscated +=
		secondPart2.split('').reverse().join('') + secondPart1.split('').reverse().join('');

	return obfuscated;
}
