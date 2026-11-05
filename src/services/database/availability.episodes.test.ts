import { describe, expect, it } from 'vitest';
import { episodeOfFile, extractEpisodeInfo } from './availability';

// Real AvailableFile paths from production (2026-11-05), with what they were filed as
describe('season and episode parsing', () => {
	it('never reads a resolution as a season and episode', () => {
		// 15,539 files were filed as S20E10 from `1920x1080`
		for (const path of [
			'/[Final8]Michiko to Hatchin - 15 (BD 10-bit 1920x1080 x264 FLAC)[7EAB8F2D].mkv',
			'/[TenB] Hunter x Hunter - 130 (1920x1080 HEVC BD FLAC) [7A437AC4].mkv',
			'/[Doki] Persona 4 The Animation - 18v2 (1920x1080 Hi10P BD FLAC) [DBCD7A77].mkv',
		]) {
			expect(episodeOfFile(path)).toBeNull();
		}
		expect(extractEpisodeInfo('Show.1x05.720p.HDTV.x264')).toEqual({ season: 1, episode: 5 });
		expect(extractEpisodeInfo('Movie.2019.DD5.1x264')).toBeNull();
	});

	it('reads three- and four-digit episodes whole', () => {
		// all were filed as episode 10
		expect(episodeOfFile('/Hercai.S01S02E106.DUB.WEBRip.1080p.mkv')).toEqual({
			season: 2,
			episode: 106,
		});
		expect(
			episodeOfFile(
				'/Dragon Ball Z/Season 4 - Garlic Jr., Trunks and Androids Sagas/Dragon Ball Z - S04E108 - Terrible Happenings in Heaven!! Garlic Jr. to Become Kami! -- The Heavens Tremble.mkv'
			)
		).toEqual({ season: 4, episode: 108 });
		expect(
			episodeOfFile('/[CR] One Piece_ WANO KUNI (892-Current) - S14E1091 [1080p].mkv')
		).toEqual({ season: 14, episode: 1091 });
	});

	it("takes a file's own name before its folder's", () => {
		expect(episodeOfFile('/Show.S01E01-E10.1080p/Show.S01E07.1080p.mkv')).toEqual({
			season: 1,
			episode: 7,
		});
		// a bare file in a season folder still gets the season
		expect(episodeOfFile('/Show Season 2/07.mkv')).toEqual({ season: 2, isSeasonPack: true });
	});
});
