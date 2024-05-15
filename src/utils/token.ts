import * as crypto from 'crypto';

export async function generateTokenAndHash(): Promise<[string, string]> {
	const token = generateRandomToken(); // Generate a secure random token
	const timestamp = Math.floor(Date.now() / 1000); // UNIX timestamp in seconds
	const tokenWithTimestamp = `${token}-${timestamp}`;
	const tokenHash = await generateHash(tokenWithTimestamp); // Hash the token with the timestamp
	return [tokenWithTimestamp, tokenHash]; // Return both the token with embedded timestamp and its hash
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

export function validateTokenWithHash(tokenWithTimestamp: string, receivedHash: string): boolean {
	const [token, timestampStr] = tokenWithTimestamp.split('-');
	const timestamp = parseInt(timestampStr, 10);
	const currentTimestamp = Math.floor(Date.now() / 1000);
	// Check time validity (5 minutes = 60 seconds)
	if (Math.abs(currentTimestamp - timestamp) > 60) {
		return false; // Token expired
	}
	// Recreate the hash with the received tokenWithTimestamp and compare
	const hash = crypto.createHash('sha256').update(tokenWithTimestamp).digest('hex');
	return hash === receivedHash;
}
