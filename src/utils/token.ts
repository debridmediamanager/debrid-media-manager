import { getTimeISO } from '@/services/realDebrid';

export async function generateTokenAndHash(): Promise<[string, string]> {
	const token = generateRandomToken(); // Generate a secure random token
	const timestamp = await fetchTimestamp(); // Fetch the timestamp from the API
	const tokenWithTimestamp = `${token}-${timestamp}`;
	const tokenHash = await generateSecureHash(tokenWithTimestamp); // Hash the token with the timestamp
	return [tokenWithTimestamp, tokenHash]; // Return both the token with embedded timestamp and its hash
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

async function generateSecureHash(input: string): Promise<string> {
	const salt = 'uBjg@V4g$oMzEL0GZmnR';
    const saltedInput = input + salt; // Combine input with salt

    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
        // Browser environment - use Web Crypto API
        const encoder = new TextEncoder().encode(saltedInput); // Encode salted input
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', encoder);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return obfuscateResult(salt, hashHex); // Return obfuscated result
    } else {
        // Node.js environment - use Node.js crypto module
        const crypto = require('crypto');
        const hashHex = crypto.createHash('sha256').update(saltedInput).digest('hex');
        return obfuscateResult(salt, hashHex); // Return obfuscated result
    }
}

function obfuscateResult(salt: string, hash: string): string {
    const randomPrefix = Math.random().toString(36).substr(2, 5); // Generate a random prefix for obfuscation
    const combined = `${randomPrefix}${salt}${hash}`; // Combine the random prefix, salt, and hash
    return combined.split('').reverse().join(''); // Reverse the result to make it harder to reverse-engineer
}


export async function validateTokenWithHash(tokenWithTimestamp: string, receivedHash: string): Promise<boolean> {
	const [token, timestampStr] = tokenWithTimestamp.split('-');
	const timestamp = parseInt(timestampStr, 10);
	const currentTimestamp = Math.floor(Date.now() / 1000);
	// Check time validity (5 minutes = 60 seconds)
	const threshold = 60;
	if (Math.abs(currentTimestamp - timestamp) > threshold) {
		return false; // Token expired
	}
	// Recreate the hash with the received tokenWithTimestamp and compare
	const hash = await generateSecureHash(tokenWithTimestamp);
	return hash === receivedHash;
}
