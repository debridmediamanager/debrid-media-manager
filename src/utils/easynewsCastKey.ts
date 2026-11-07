import type { EasynewsCredentials } from '@/services/easynews';

// DMM Cast stores and sends one key per provider. Easynews has no API key, so its
// key is the Basic credential every Easynews call sends anyway: base64 of the
// UTF-8 `username:password`. With it the cast routes, pages and settings work as
// they do for the debrid services.

export function easynewsCastKey({ username, password }: EasynewsCredentials): string {
	const bytes = new TextEncoder().encode(`${username}:${password}`);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

/** The login inside a key, or null when it is not one. The same limits as readCredentials. */
export function easynewsCredentialsOf(key: unknown): EasynewsCredentials | null {
	if (typeof key !== 'string' || !key || key.length > 600 || !/^[A-Za-z0-9+/]+=*$/.test(key))
		return null;
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(
			Uint8Array.from(atob(key), (c) => c.charCodeAt(0))
		);
	} catch {
		return null;
	}
	const colon = text.indexOf(':');
	if (colon <= 0) return null;
	const username = text.slice(0, colon).trim();
	const password = text.slice(colon + 1);
	if (!username || !password || username.length > 200 || password.length > 200) return null;
	return { username, password };
}
