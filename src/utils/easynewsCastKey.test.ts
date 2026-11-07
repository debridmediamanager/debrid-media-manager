import { describe, expect, it } from 'vitest';
import { easynewsCastKey, easynewsCredentialsOf } from './easynewsCastKey';

describe('easynewsCastKey', () => {
	it('is the Basic credential Easynews takes', () => {
		const key = easynewsCastKey({ username: 'alice', password: 'p:ss word' });
		expect(key).toBe(Buffer.from('alice:p:ss word').toString('base64'));
		expect(easynewsCredentialsOf(key)).toEqual({ username: 'alice', password: 'p:ss word' });
	});

	it('round-trips a non-ASCII password as UTF-8, as the server sends it', () => {
		const key = easynewsCastKey({ username: 'jürgen', password: 'pässwörd€' });
		expect(Buffer.from(key, 'base64').toString('utf8')).toBe('jürgen:pässwörd€');
		expect(easynewsCredentialsOf(key)).toEqual({ username: 'jürgen', password: 'pässwörd€' });
	});

	it.each([
		['not a string', 42],
		['empty', ''],
		['not base64', 'abc$def'],
		['no colon', Buffer.from('alice').toString('base64')],
		['no username', Buffer.from(':secret').toString('base64')],
		['no password', Buffer.from('alice:').toString('base64')],
		['invalid UTF-8', Buffer.from([0x61, 0x3a, 0xff, 0xfe]).toString('base64')],
		['too long', Buffer.from(`alice:${'x'.repeat(201)}`).toString('base64')],
	])('refuses a key that is %s', (_, key) => {
		expect(easynewsCredentialsOf(key)).toBeNull();
	});
});
