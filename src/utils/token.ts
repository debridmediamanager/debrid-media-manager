import { getTimeISO } from '@/services/realDebrid';
import * as crypto from 'crypto';

const salt = '691Rbf3#aI@JL84xDD!2';

export async function generateTokenAndHash(): Promise<[string, string]> {
	const token = generateRandomToken(); // Generate a secure random token
	const timestamp = await fetchTimestamp(); // Fetch the timestamp from the API
	const tokenWithTimestamp = `${token}-${timestamp}`;
	const tokenTimestampHash = await generateHash(tokenWithTimestamp); // Hash the token with the timestamp
	// append a random string to the token
	const tokenSaltHash = await generateHash(salt+token)
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

async function generateHash(input: string): Promise<string> {
	// Encode the input string as a Uint8Array
	const encoder = new TextEncoder();
	const data = encoder.encode(input);
	// Hash the data using SHA-256
	const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
	// Convert the hash to a hexadecimal string
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	return hashHex;
}

// Validate the token with the hash, called by the server
export function validateTokenWithHash(tokenWithTimestamp: string, receivedHash: string): boolean {
	const [token, timestampStr] = tokenWithTimestamp.split('-');
	const timestamp = parseInt(timestampStr, 10);
	const currentTimestamp = Math.floor(Date.now() / 1000);
	// Check time validity (5 minutes = 60 seconds)
	const threshold = 60;
	if (Math.abs(currentTimestamp - timestamp) > threshold) {
		return false; // Token expired
	}
	// Recreate the hash with the received tokenWithTimestamp and compare
	const tokenTimestampHash = crypto.createHash('sha256').update(tokenWithTimestamp).digest('hex');
	const tokenSaltHash = crypto.createHash('sha256').update(salt+token).digest('hex');
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
	obfuscated += secondPart2.split('').reverse().join('') + secondPart1.split('').reverse().join('');
  
	return obfuscated;
  }