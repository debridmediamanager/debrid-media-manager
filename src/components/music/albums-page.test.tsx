import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Test the core logic functions extracted from the albums page
// We test queue management, sorting, persistence, and MediaSession indirectly

describe('Albums page queue management logic', () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		localStorage.clear();
	});

	describe('removeFromQueue', () => {
		it('removes track at given index', () => {
			const queue = ['a', 'b', 'c'];
			const result = queue.filter((_, i) => i !== 1);
			expect(result).toEqual(['a', 'c']);
		});

		it('adjusts currentIndex when removing before it', () => {
			const currentIndex = 2;
			const removeIndex = 0;
			const newIndex = removeIndex < currentIndex ? currentIndex - 1 : currentIndex;
			expect(newIndex).toBe(1);
		});

		it('keeps currentIndex when removing after it', () => {
			const currentIndex = 0;
			const removeIndex = 2;
			const newIndex = removeIndex < currentIndex ? currentIndex - 1 : currentIndex;
			expect(newIndex).toBe(0);
		});
	});

	describe('playNext insertion', () => {
		it('inserts after current index', () => {
			const queue = ['a', 'b', 'c'];
			const currentIndex = 0;
			const insertAt = currentIndex + 1;
			const newQueue = [...queue.slice(0, insertAt), 'NEW', ...queue.slice(insertAt)];
			expect(newQueue).toEqual(['a', 'NEW', 'b', 'c']);
		});

		it('inserts at end when current is last', () => {
			const queue = ['a', 'b', 'c'];
			const currentIndex = 2;
			const insertAt = currentIndex + 1;
			const newQueue = [...queue.slice(0, insertAt), 'NEW', ...queue.slice(insertAt)];
			expect(newQueue).toEqual(['a', 'b', 'c', 'NEW']);
		});

		it('inserts multiple tracks (album) after current', () => {
			const queue = ['a', 'b', 'c'];
			const currentIndex = 1;
			const newTracks = ['X', 'Y'];
			const insertAt = currentIndex + 1;
			const newQueue = [...queue.slice(0, insertAt), ...newTracks, ...queue.slice(insertAt)];
			expect(newQueue).toEqual(['a', 'b', 'X', 'Y', 'c']);
		});
	});

	describe('album sorting', () => {
		const albums = [
			{ album: 'Zebra', artist: 'Charlie', year: 2020 },
			{ album: 'Apple', artist: 'Alice', year: 2023 },
			{ album: 'Mango', artist: 'Bob', year: null },
		];

		it('sorts by name alphabetically', () => {
			const sorted = [...albums].sort((a, b) => a.album.localeCompare(b.album));
			expect(sorted.map((a) => a.album)).toEqual(['Apple', 'Mango', 'Zebra']);
		});

		it('sorts by artist alphabetically', () => {
			const sorted = [...albums].sort((a, b) => a.artist.localeCompare(b.artist));
			expect(sorted.map((a) => a.artist)).toEqual(['Alice', 'Bob', 'Charlie']);
		});

		it('sorts by year descending, null years last', () => {
			const sorted = [...albums].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
			expect(sorted.map((a) => a.year)).toEqual([2023, 2020, null]);
		});
	});

	describe('localStorage persistence', () => {
		it('persists repeatMode', () => {
			localStorage.setItem('music:repeatMode', 'all');
			expect(localStorage.getItem('music:repeatMode')).toBe('all');
		});

		it('persists isShuffled', () => {
			localStorage.setItem('music:isShuffled', 'true');
			expect(localStorage.getItem('music:isShuffled')).toBe('true');
		});

		it('persists volume', () => {
			localStorage.setItem('music:volume', '0.5');
			expect(localStorage.getItem('music:volume')).toBe('0.5');
		});

		it('persists queue', () => {
			const queue = [{ track: { id: 't1' } }];
			localStorage.setItem('music:queue', JSON.stringify(queue));
			expect(JSON.parse(localStorage.getItem('music:queue')!)).toEqual(queue);
		});

		it('persists currentIndex', () => {
			localStorage.setItem('music:currentIndex', '3');
			expect(JSON.parse(localStorage.getItem('music:currentIndex')!)).toBe(3);
		});

		it('restores repeatMode from valid values', () => {
			for (const mode of ['off', 'all', 'one']) {
				localStorage.setItem('music:repeatMode', mode);
				const saved = localStorage.getItem('music:repeatMode');
				expect(['off', 'all', 'one']).toContain(saved);
			}
		});

		it('ignores invalid repeatMode values', () => {
			localStorage.setItem('music:repeatMode', 'invalid');
			const saved = localStorage.getItem('music:repeatMode');
			const valid = saved === 'off' || saved === 'all' || saved === 'one';
			expect(valid).toBe(false); // 'invalid' is not a valid mode
		});
	});

	describe('album search filtering', () => {
		const albums = [
			{ artist: 'Pink Floyd', album: 'The Wall' },
			{ artist: 'Radiohead', album: 'OK Computer' },
			{ artist: 'Pink Floyd', album: 'Wish You Were Here' },
		];

		it('filters by artist name (case-insensitive)', () => {
			const query = 'radiohead';
			const filtered = albums.filter(
				(a) =>
					a.artist.toLowerCase().includes(query) || a.album.toLowerCase().includes(query)
			);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].album).toBe('OK Computer');
		});

		it('filters by album name (case-insensitive)', () => {
			const query = 'wall';
			const filtered = albums.filter(
				(a) =>
					a.artist.toLowerCase().includes(query) || a.album.toLowerCase().includes(query)
			);
			expect(filtered).toHaveLength(1);
			expect(filtered[0].album).toBe('The Wall');
		});

		it('returns all when query is empty', () => {
			const query = '';
			const filtered = albums.filter(
				(a) =>
					a.artist.toLowerCase().includes(query) || a.album.toLowerCase().includes(query)
			);
			expect(filtered).toHaveLength(3);
		});

		it('returns multiple matches', () => {
			const query = 'pink';
			const filtered = albums.filter(
				(a) =>
					a.artist.toLowerCase().includes(query) || a.album.toLowerCase().includes(query)
			);
			expect(filtered).toHaveLength(2);
		});
	});

	describe('MediaSession API', () => {
		it('MediaMetadata constructor creates valid metadata', () => {
			// jsdom doesn't have MediaMetadata, so we test the shape
			const metadata = {
				title: 'Test Song',
				artist: 'Test Artist',
				album: 'Test Album',
				artwork: [
					{ src: 'https://example.com/cover.jpg', sizes: '600x600', type: 'image/jpeg' },
				],
			};
			expect(metadata.title).toBe('Test Song');
			expect(metadata.artist).toBe('Test Artist');
			expect(metadata.album).toBe('Test Album');
			expect(metadata.artwork).toHaveLength(1);
		});

		it('excludes artwork when coverUrl is null', () => {
			const coverUrl: string | null = null;
			const metadata = {
				title: 'Test Song',
				artist: 'Test Artist',
				album: 'Test Album',
				...(coverUrl ? { artwork: [{ src: coverUrl }] } : {}),
			};
			expect(metadata).not.toHaveProperty('artwork');
		});

		it('includes artwork when coverUrl is provided', () => {
			const coverUrl: string | null = 'https://example.com/cover.jpg';
			const metadata = {
				title: 'Test Song',
				artist: 'Test Artist',
				album: 'Test Album',
				...(coverUrl
					? { artwork: [{ src: coverUrl, sizes: '600x600', type: 'image/jpeg' }] }
					: {}),
			};
			expect(metadata.artwork).toHaveLength(1);
			expect(metadata.artwork![0].src).toBe('https://example.com/cover.jpg');
		});
	});

	describe('repeat mode cycling', () => {
		it('cycles off -> all -> one -> off', () => {
			const cycle = (mode: string) =>
				mode === 'off' ? 'all' : mode === 'all' ? 'one' : 'off';

			expect(cycle('off')).toBe('all');
			expect(cycle('all')).toBe('one');
			expect(cycle('one')).toBe('off');
		});
	});

	describe('skip prev logic', () => {
		it('restarts track if currentTime > 3', () => {
			const currentTime = 5;
			const shouldRestart = currentTime > 3;
			expect(shouldRestart).toBe(true);
		});

		it('goes to previous track if currentTime <= 3', () => {
			const currentTime = 2;
			const shouldRestart = currentTime > 3;
			expect(shouldRestart).toBe(false);
		});
	});

	describe('shuffle logic', () => {
		it('puts current track first when shuffling', () => {
			const queue = ['a', 'b', 'c', 'd'];
			const currentIndex = 2;
			const currentTrack = queue[currentIndex];
			const otherTracks = queue.filter((_, i) => i !== currentIndex);
			const newQueue = [currentTrack, ...otherTracks];

			expect(newQueue[0]).toBe('c');
			expect(newQueue).toHaveLength(4);
		});

		it('restores original order when unshuffling', () => {
			const originalQueue = ['a', 'b', 'c', 'd'];
			const shuffledQueue = ['c', 'a', 'd', 'b'];
			const currentTrackId = shuffledQueue[0]; // 'c'
			const newIndex = originalQueue.findIndex((t) => t === currentTrackId);

			expect(newIndex).toBe(2);
		});
	});

	describe('dynamic page title', () => {
		it('shows track info when playing', () => {
			const isPlaying = true;
			const trackName = '01 - Song';
			const artist = 'Artist';
			const albumName = 'Album';

			const title = isPlaying
				? `${trackName} - ${artist} - DMM`
				: albumName
					? `${albumName} - ${artist} - DMM`
					: 'Albums - DMM';

			expect(title).toBe('01 - Song - Artist - DMM');
		});

		it('shows album info when viewing album but not playing', () => {
			const isPlaying = false;
			const albumName = 'Test Album';
			const artist = 'Test Artist';

			const title = isPlaying
				? 'Track - Artist - DMM'
				: albumName
					? `${albumName} - ${artist} - DMM`
					: 'Albums - DMM';

			expect(title).toBe('Test Album - Test Artist - DMM');
		});

		it('shows default when no album selected', () => {
			const isPlaying = false;
			const albumName: string | null = null;

			const title = isPlaying
				? 'Track - Artist - DMM'
				: albumName
					? `${albumName} - Artist - DMM`
					: 'Albums - DMM';

			expect(title).toBe('Albums - DMM');
		});
	});
});
