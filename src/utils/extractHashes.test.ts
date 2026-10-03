import allDebridTopic from '@/test/fixtures/alldebrid-encoded-topic.json';
import encodedMagnet from '@/test/fixtures/urlsearchparams-magnet.json';
import { describe, expect, it } from 'vitest';
import {
	SHA1_REGEX,
	extractDownloadLinks,
	extractHashes,
	extractMagnets,
	extractTorrentInputs,
	isValidHash,
	normalizeHash,
} from './extractHashes';

describe('extractHashes utils', () => {
	it('validates SHA1 hashes', () => {
		const valid = 'A'.repeat(40);
		const invalids = ['G'.repeat(40), 'abc', ''.padEnd(39, 'a')];
		expect(SHA1_REGEX.test(valid)).toBe(true);
		expect(isValidHash(valid)).toBe(true);
		for (const s of invalids) {
			expect(isValidHash(s)).toBe(false);
		}
	});

	it('normalizes hashes to lowercase and rejects invalid', () => {
		expect(normalizeHash('ABCDEF0123456789ABCDEF0123456789ABCDEF01')).toBe(
			'abcdef0123456789abcdef0123456789abcdef01'
		);
		expect(normalizeHash('not-a-hash')).toBe('');
		expect(normalizeHash(undefined as any)).toBe('');
		expect(normalizeHash(null as any)).toBe('');
	});

	it('extracts unique hashes from mixed input', () => {
		const hash1 = 'abcdef0123456789abcdef0123456789abcdef01';
		const hash2 = '1234567890abcdef1234567890abcdef12345678';
		const input = [
			`magnet:?xt=urn:btih:${hash1.toUpperCase()}`,
			'some text',
			hash1, // duplicate
			`another ${hash2} entry`,
		].join(' ');

		const hashes = extractHashes(input);
		expect(hashes.sort()).toEqual([hash1, hash2].sort());
	});

	it('extracts or builds magnets from input', () => {
		const hash = 'abcdef0123456789abcdef0123456789abcdef01';
		const magnet = `magnet:?xt=urn:btih:${hash}`;
		expect(extractMagnets(`foo ${magnet} bar`)).toEqual([magnet]);
		// When only hashes provided, convert them to magnets
		expect(extractMagnets(`hashes: ${hash}`)).toEqual([magnet]);
	});

	it('preserves complete magnet URIs and normalizes base32 BTIH values', () => {
		const base32 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
		const magnet = `magnet:?xt=urn:btih:${base32}&dn=Example+Release&tr=udp%3A%2F%2Fone&tr=udp%3A%2F%2Ftwo&ws=https%3A%2F%2Fseed%2Ffile`;

		expect(extractTorrentInputs(`before ${magnet} after`)).toEqual([
			{
				kind: 'magnet',
				source: magnet,
				hash: '0000000000000000000000000000000000000000',
			},
		]);
	});

	it('keeps standalone hashes distinct from full magnets in mixed input', () => {
		const magnetHash = 'abcdef0123456789abcdef0123456789abcdef01';
		const bareHash = '1234567890abcdef1234567890abcdef12345678';
		const magnet = `magnet:?xt=urn:btih:${magnetHash}&dn=Example&tr=udp%3A%2F%2Ftracker`;

		expect(extractTorrentInputs(`${magnet}\n${bareHash}`)).toEqual([
			{ kind: 'magnet', source: magnet, hash: magnetHash },
			{ kind: 'hash', source: bareHash, hash: bareHash },
		]);
	});

	it('accepts percent-encoded exact topics without rewriting the supplied magnet', () => {
		expect(extractTorrentInputs(encodedMagnet.source)).toEqual([
			{ kind: 'magnet', source: encodedMagnet.source, hash: encodedMagnet.hash },
		]);
	});

	it.each([
		['percent-encoded', allDebridTopic.source],
		['base32 with uppercase scheme', allDebridTopic.base32Source],
	])('makes a %s topic interoperable without losing magnet metadata', (_name, source) => {
		const [magnet] = extractMagnets(source);
		const accepted = allDebridTopic.canonicalResponse.magnets[0];
		// AllDebrid rejected the encoded URI but accepted the same literal exact topic.
		expect(magnet).toMatch(new RegExp(`^magnet:\\?xt=urn:btih:${accepted.hash}(?:&|$)`));
		expect(
			Array.from(new URL(magnet).searchParams).filter(([key]) => key.toLowerCase() !== 'xt')
		).toEqual(
			Array.from(new URL(source).searchParams).filter(([key]) => key.toLowerCase() !== 'xt')
		);
	});

	describe('extractDownloadLinks', () => {
		it('extracts unique http(s) links across lines and spaces', () => {
			const input = [
				'https://example.com/movie.mkv',
				'http://host.tld/path/file%20name.mp4 https://example.com/movie.mkv',
			].join('\n');

			expect(extractDownloadLinks(input)).toEqual([
				'https://example.com/movie.mkv',
				'http://host.tld/path/file%20name.mp4',
			]);
		});

		it('strips trailing punctuation left over from pasted prose', () => {
			expect(extractDownloadLinks('grab https://example.com/movie.mkv, then play')).toEqual([
				'https://example.com/movie.mkv',
			]);
		});

		it('ignores magnets and other non-http tokens', () => {
			const hash = 'abcdef0123456789abcdef0123456789abcdef01';
			expect(
				extractDownloadLinks(`magnet:?xt=urn:btih:${hash} ftp://host/file ${hash}`)
			).toEqual([]);
			expect(extractDownloadLinks('   ')).toEqual([]);
		});
	});
});
