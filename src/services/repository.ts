import {
	AnimeService,
	AvailabilityService,
	CastService,
	ReportService,
	ScrapedService,
	SearchService,
} from './database';
import { ScrapeSearchResult } from './mediasearch';
import { TorrentInfoResponse } from './types';

export class Repository {
	private availabilityService: AvailabilityService;
	private scrapedService: ScrapedService;
	private searchService: SearchService;
	private animeService: AnimeService;
	private castService: CastService;
	private reportService: ReportService;

	constructor() {
		this.availabilityService = new AvailabilityService();
		this.scrapedService = new ScrapedService();
		this.searchService = new SearchService();
		this.animeService = new AnimeService();
		this.castService = new CastService();
		this.reportService = new ReportService();
	}

	// Ensure connection is properly closed when repository is no longer needed
	public async disconnect(): Promise<void> {
		await Promise.all([
			this.availabilityService.disconnect(),
			this.scrapedService.disconnect(),
			this.searchService.disconnect(),
			this.animeService.disconnect(),
			this.castService.disconnect(),
			this.reportService.disconnect(),
		]);
	}

	// Availability Service Methods
	public getIMDBIdByHash(hash: string) {
		return this.availabilityService.getIMDBIdByHash(hash);
	}

	public handleDownloadedTorrent(torrentInfo: TorrentInfoResponse, hash: string, imdbId: string) {
		return this.availabilityService.handleDownloadedTorrent(torrentInfo, hash, imdbId);
	}

	public upsertAvailability(data: {
		hash: string;
		imdbId: string;
		filename: string;
		originalFilename: string;
		bytes: number;
		originalBytes: number;
		host: string;
		progress: number;
		status: string;
		ended: string;
		selectedFiles: Array<{ id: number; path: string; bytes: number; selected: number }>;
		links: string[];
	}) {
		return this.availabilityService.upsertAvailability(data);
	}

	public checkAvailability(imdbId: string, hashes: string[]) {
		return this.availabilityService.checkAvailability(imdbId, hashes);
	}

	public checkAvailabilityByHashes(hashes: string[]) {
		return this.availabilityService.checkAvailabilityByHashes(hashes);
	}

	public removeAvailability(hash: string) {
		return this.availabilityService.removeAvailability(hash);
	}

	// Scraped Service Methods
	public getScrapedTrueResults<T>(key: string, maxSizeGB?: number, page?: number) {
		return this.scrapedService.getScrapedTrueResults<T>(key, maxSizeGB, page);
	}

	public getScrapedResults<T>(key: string, maxSizeGB?: number, page?: number) {
		return this.scrapedService.getScrapedResults<T>(key, maxSizeGB, page);
	}

	public saveScrapedTrueResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt?: boolean,
		replaceOldScrape?: boolean
	) {
		return this.scrapedService.saveScrapedTrueResults(
			key,
			value,
			updateUpdatedAt,
			replaceOldScrape
		);
	}

	public saveScrapedResults(
		key: string,
		value: ScrapeSearchResult[],
		updateUpdatedAt?: boolean,
		replaceOldScrape?: boolean
	) {
		return this.scrapedService.saveScrapedResults(
			key,
			value,
			updateUpdatedAt,
			replaceOldScrape
		);
	}

	public keyExists(key: string) {
		return this.scrapedService.keyExists(key);
	}

	public isOlderThan(imdbId: string, daysAgo: number) {
		return this.scrapedService.isOlderThan(imdbId, daysAgo);
	}

	public getOldestRequest(olderThan?: Date | null) {
		return this.scrapedService.getOldestRequest(olderThan);
	}

	public processingMoreThanAnHour() {
		return this.scrapedService.processingMoreThanAnHour();
	}

	public getOldestScrapedMedia(mediaType: 'tv' | 'movie', quantity?: number) {
		return this.scrapedService.getOldestScrapedMedia(mediaType, quantity);
	}

	public getAllImdbIds(mediaType: 'tv' | 'movie') {
		return this.scrapedService.getAllImdbIds(mediaType);
	}

	public markAsDone(imdbId: string) {
		return this.scrapedService.markAsDone(imdbId);
	}

	public getRecentlyUpdatedContent() {
		return this.scrapedService.getRecentlyUpdatedContent();
	}

	// Search Service Methods
	public saveSearchResults<T>(key: string, value: T) {
		return this.searchService.saveSearchResults(key, value);
	}

	public getSearchResults<T>(key: string) {
		return this.searchService.getSearchResults<T>(key);
	}

	// Anime Service Methods
	public getRecentlyUpdatedAnime(limit: number) {
		return this.animeService.getRecentlyUpdatedAnime(limit);
	}

	public searchAnimeByTitle(query: string) {
		return this.animeService.searchAnimeByTitle(query);
	}

	public getAnimeByMalIds(malIds: number[]) {
		return this.animeService.getAnimeByMalIds(malIds);
	}

	public getAnimeByKitsuIds(kitsuIds: number[]) {
		return this.animeService.getAnimeByKitsuIds(kitsuIds);
	}

	// Cast Service Methods
	public saveCastProfile(
		userId: string,
		clientId: string,
		clientSecret: string,
		refreshToken?: string | null
	) {
		return this.castService.saveCastProfile(userId, clientId, clientSecret, refreshToken);
	}

	public getLatestCast(imdbId: string, userId: string) {
		return this.castService.getLatestCast(imdbId, userId);
	}

	public getCastURLs(imdbId: string, userId: string) {
		return this.castService.getCastURLs(imdbId, userId);
	}

	public getOtherCastURLs(imdbId: string, userId: string) {
		return this.castService.getOtherCastURLs(imdbId, userId);
	}

	public getCastProfile(userId: string) {
		return this.castService.getCastProfile(userId);
	}

	public saveCast(
		imdbId: string,
		userId: string,
		hash: string,
		url: string,
		rdLink: string,
		fileSize: number
	) {
		return this.castService.saveCast(imdbId, userId, hash, url, rdLink, fileSize);
	}

	public fetchCastedMovies(userId: string) {
		return this.castService.fetchCastedMovies(userId);
	}

	public fetchCastedShows(userId: string) {
		return this.castService.fetchCastedShows(userId);
	}

	public fetchAllCastedLinks(userId: string) {
		return this.castService.fetchAllCastedLinks(userId);
	}

	public deleteCastedLink(imdbId: string, userId: string, hash: string) {
		return this.castService.deleteCastedLink(imdbId, userId, hash);
	}

	// Report Service Methods
	public reportContent(
		hash: string,
		imdbId: string,
		userId: string,
		type: 'porn' | 'wrong_imdb' | 'wrong_season'
	) {
		return this.reportService.reportContent(hash, imdbId, userId, type);
	}

	public getEmptyMedia(quantity?: number) {
		return this.reportService.getEmptyMedia(quantity);
	}

	public getReportedHashes(imdbId: string) {
		return this.reportService.getReportedHashes(imdbId);
	}

	// Database Size Methods
	public getContentSize() {
		return this.scrapedService.getContentSize();
	}

	public getProcessingCount() {
		return this.scrapedService.getProcessingCount();
	}

	public getRequestedCount() {
		return this.scrapedService.getRequestedCount();
	}
}
