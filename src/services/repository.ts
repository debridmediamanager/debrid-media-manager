import { Prisma } from '@prisma/client';
import {
	AllDebridCastService,
	AnimeService,
	AvailabilityService,
	CastService,
	HashImdbService,
	HashSearchService,
	HistoryAggregationService,
	ImdbSearchService,
	RdOperationalService,
	ReportService,
	ScrapedService,
	SearchService,
	StreamHealthService,
	TorBoxCastService,
	TorrentSnapshotService,
	ZurgKeysService,
} from './database';
import { HashSearchParams } from './database/hashSearch';
import { RealDebridOperation } from './database/rdOperational';
import { StreamServerStatus, TorrentioUrlCheckResult } from './database/streamHealth';
import { ScrapeSearchResult } from './mediasearch';
import { TorrentInfoResponse } from './types';

export type RepositoryDependencies = Partial<{
	availabilityService: AvailabilityService;
	scrapedService: ScrapedService;
	searchService: SearchService;
	animeService: AnimeService;
	castService: CastService;
	torboxCastService: TorBoxCastService;
	allDebridCastService: AllDebridCastService;
	reportService: ReportService;
	torrentSnapshotService: TorrentSnapshotService;
	hashImdbService: HashImdbService;
	hashSearchService: HashSearchService;
	zurgKeysService: ZurgKeysService;
	streamHealthService: StreamHealthService;
	historyAggregationService: HistoryAggregationService;
	rdOperationalService: RdOperationalService;
	imdbSearchService: ImdbSearchService;
}>;

export class Repository {
	private availabilityService: AvailabilityService;
	private scrapedService: ScrapedService;
	private searchService: SearchService;
	private animeService: AnimeService;
	private castService: CastService;
	private torboxCastService: TorBoxCastService;
	private allDebridCastService: AllDebridCastService;
	private reportService: ReportService;
	private torrentSnapshotService: TorrentSnapshotService;
	private hashImdbService: HashImdbService;
	private hashSearchService: HashSearchService;
	private zurgKeysService: ZurgKeysService;
	private streamHealthService: StreamHealthService;
	private historyAggregationService: HistoryAggregationService;
	private rdOperationalService: RdOperationalService;
	private imdbSearchService: ImdbSearchService;

	constructor({
		availabilityService,
		scrapedService,
		searchService,
		animeService,
		castService,
		torboxCastService,
		allDebridCastService,
		reportService,
		torrentSnapshotService,
		hashImdbService,
		hashSearchService,
		zurgKeysService,
		streamHealthService,
		historyAggregationService,
		rdOperationalService,
		imdbSearchService,
	}: RepositoryDependencies = {}) {
		this.availabilityService = availabilityService ?? new AvailabilityService();
		this.scrapedService = scrapedService ?? new ScrapedService();
		this.searchService = searchService ?? new SearchService();
		this.animeService = animeService ?? new AnimeService();
		this.castService = castService ?? new CastService();
		this.torboxCastService = torboxCastService ?? new TorBoxCastService();
		this.allDebridCastService = allDebridCastService ?? new AllDebridCastService();
		this.reportService = reportService ?? new ReportService();
		this.torrentSnapshotService = torrentSnapshotService ?? new TorrentSnapshotService();
		this.hashImdbService = hashImdbService ?? new HashImdbService();
		this.hashSearchService = hashSearchService ?? new HashSearchService();
		this.zurgKeysService = zurgKeysService ?? new ZurgKeysService();
		this.streamHealthService = streamHealthService ?? new StreamHealthService();
		this.historyAggregationService =
			historyAggregationService ?? new HistoryAggregationService();
		this.rdOperationalService = rdOperationalService ?? new RdOperationalService();
		this.imdbSearchService = imdbSearchService ?? new ImdbSearchService();
	}

	// Ensure connection is properly closed when repository is no longer needed
	public async disconnect(): Promise<void> {
		await Promise.all([
			this.availabilityService.disconnect(),
			this.scrapedService.disconnect(),
			this.searchService.disconnect(),
			this.animeService.disconnect(),
			this.castService.disconnect(),
			this.torboxCastService.disconnect(),
			this.allDebridCastService.disconnect(),
			this.reportService.disconnect(),
			this.torrentSnapshotService.disconnect(),
			this.hashImdbService.disconnect(),
			this.hashSearchService.disconnect(),
			this.zurgKeysService.disconnect(),
			this.streamHealthService.disconnect(),
			this.historyAggregationService.disconnect(),
			this.rdOperationalService.disconnect(),
			this.imdbSearchService.disconnect(),
		]);
	}

	// Availability Service Methods
	public getIMDBIdByHash(hash: string) {
		return this.availabilityService.getIMDBIdByHash(hash);
	}

	public saveIMDBIdMapping(hash: string, imdbId: string) {
		return this.availabilityService.saveIMDBIdMapping(hash, imdbId);
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

	public getHashByLink(link: string) {
		return this.availabilityService.getHashByLink(link);
	}

	// AllDebrid Availability Service Methods
	public upsertAvailabilityAd(data: {
		hash: string;
		imdbId: string;
		filename: string;
		size: number;
		status: string;
		statusCode: number;
		completionDate: number;
		files: Array<{ n: string; s: number; l: string }>;
	}) {
		return this.availabilityService.upsertAvailabilityAd(data);
	}

	public checkAvailabilityAd(imdbId: string, hashes: string[]) {
		return this.availabilityService.checkAvailabilityAd(imdbId, hashes);
	}

	public removeAvailabilityAd(hash: string) {
		return this.availabilityService.removeAvailabilityAd(hash);
	}

	public getIMDBIdByHashAd(hash: string) {
		return this.availabilityService.getIMDBIdByHashAd(hash);
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
		refreshToken?: string | null,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.castService.saveCastProfile(
			userId,
			clientId,
			clientSecret,
			refreshToken,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption
		);
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

	public getAllUserCasts(userId: string) {
		return this.castService.getAllUserCasts(userId);
	}

	public getUserCastStreams(imdbId: string, userId: string, limit?: number) {
		return this.castService.getUserCastStreams(imdbId, userId, limit);
	}

	public getOtherStreams(imdbId: string, userId: string, limit?: number, maxSize?: number) {
		return this.castService.getOtherStreams(imdbId, userId, limit, maxSize);
	}

	// TorBox Cast Service Methods
	public saveTorBoxCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.torboxCastService.saveCastProfile(
			userId,
			apiKey,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption
		);
	}

	public getTorBoxLatestCast(imdbId: string, userId: string) {
		return this.torboxCastService.getLatestCast(imdbId, userId);
	}

	public getTorBoxCastURLs(imdbId: string, userId: string) {
		return this.torboxCastService.getCastURLs(imdbId, userId);
	}

	public getTorBoxOtherCastURLs(imdbId: string, userId: string) {
		return this.torboxCastService.getOtherCastURLs(imdbId, userId);
	}

	public getTorBoxCastProfile(userId: string) {
		return this.torboxCastService.getCastProfile(userId);
	}

	public saveTorBoxCast(
		imdbId: string,
		userId: string,
		hash: string,
		url: string,
		tbLink: string,
		fileSize: number,
		torrentId?: number,
		fileId?: number
	) {
		return this.torboxCastService.saveCast(
			imdbId,
			userId,
			hash,
			url,
			tbLink,
			fileSize,
			torrentId,
			fileId
		);
	}

	public fetchTorBoxCastedMovies(userId: string) {
		return this.torboxCastService.fetchCastedMovies(userId);
	}

	public fetchTorBoxCastedShows(userId: string) {
		return this.torboxCastService.fetchCastedShows(userId);
	}

	public fetchAllTorBoxCastedLinks(userId: string) {
		return this.torboxCastService.fetchAllCastedLinks(userId);
	}

	public deleteTorBoxCastedLink(imdbId: string, userId: string, hash: string) {
		return this.torboxCastService.deleteCastedLink(imdbId, userId, hash);
	}

	public getAllTorBoxUserCasts(userId: string) {
		return this.torboxCastService.getAllUserCasts(userId);
	}

	public getTorBoxUserCastStreams(imdbId: string, userId: string, limit?: number) {
		return this.torboxCastService.getUserCastStreams(imdbId, userId, limit);
	}

	public getTorBoxOtherStreams(imdbId: string, userId: string, limit?: number, maxSize?: number) {
		return this.torboxCastService.getOtherStreams(imdbId, userId, limit, maxSize);
	}

	// AllDebrid Cast Service Methods
	public saveAllDebridCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.allDebridCastService.saveCastProfile(
			userId,
			apiKey,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption
		);
	}

	public getAllDebridLatestCast(imdbId: string, userId: string) {
		return this.allDebridCastService.getLatestCast(imdbId, userId);
	}

	public getAllDebridCastURLs(imdbId: string, userId: string) {
		return this.allDebridCastService.getCastURLs(imdbId, userId);
	}

	public getAllDebridOtherCastURLs(imdbId: string, userId: string) {
		return this.allDebridCastService.getOtherCastURLs(imdbId, userId);
	}

	public getAllDebridCastProfile(userId: string) {
		return this.allDebridCastService.getCastProfile(userId);
	}

	public saveAllDebridCast(
		imdbId: string,
		userId: string,
		hash: string,
		url: string,
		adLink: string,
		fileSize: number,
		magnetId?: number,
		fileIndex?: number
	) {
		return this.allDebridCastService.saveCast(
			imdbId,
			userId,
			hash,
			url,
			adLink,
			fileSize,
			magnetId,
			fileIndex
		);
	}

	public fetchAllDebridCastedMovies(userId: string) {
		return this.allDebridCastService.fetchCastedMovies(userId);
	}

	public fetchAllDebridCastedShows(userId: string) {
		return this.allDebridCastService.fetchCastedShows(userId);
	}

	public fetchAllAllDebridCastedLinks(userId: string) {
		return this.allDebridCastService.fetchAllCastedLinks(userId);
	}

	public deleteAllDebridCastedLink(imdbId: string, userId: string, hash: string) {
		return this.allDebridCastService.deleteCastedLink(imdbId, userId, hash);
	}

	public getAllAllDebridUserCasts(userId: string) {
		return this.allDebridCastService.getAllUserCasts(userId);
	}

	public getAllDebridUserCastStreams(imdbId: string, userId: string, limit?: number) {
		return this.allDebridCastService.getUserCastStreams(imdbId, userId, limit);
	}

	public getAllDebridOtherStreams(
		imdbId: string,
		userId: string,
		limit?: number,
		maxSize?: number
	) {
		return this.allDebridCastService.getOtherStreams(imdbId, userId, limit, maxSize);
	}

	// Torrent Snapshot Methods
	public upsertTorrentSnapshot({
		id,
		hash,
		addedDate,
		payload,
	}: {
		id: string;
		hash: string;
		addedDate: Date;
		payload: Prisma.InputJsonValue;
	}) {
		return this.torrentSnapshotService.upsertSnapshot({
			id,
			hash,
			addedDate,
			payload,
		});
	}

	public getLatestTorrentSnapshot(hash: string) {
		return this.torrentSnapshotService.getLatestSnapshot(hash);
	}

	public getSnapshotsByHashes(hashes: string[]) {
		return this.torrentSnapshotService.getSnapshotsByHashes(hashes);
	}

	// Hash-IMDB Mapping Methods
	public upsertHashImdbBatch(pairs: { hash: string; imdbId: string }[]) {
		return this.hashImdbService.upsertBatch(pairs);
	}

	public getHashImdbByHash(hash: string) {
		return this.hashImdbService.getByHash(hash);
	}

	public getHashImdbByHashes(hashes: string[]) {
		return this.hashImdbService.getByHashes(hashes);
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

	// Hash Search Service Methods
	public getHashesByImdbId(params: HashSearchParams) {
		return this.hashSearchService.getHashesByImdbId(params);
	}

	// Zurg Keys Service Methods
	public createZurgApiKey(validUntilDate: Date) {
		return this.zurgKeysService.createApiKey(validUntilDate);
	}

	public validateZurgApiKey(apiKey: string) {
		return this.zurgKeysService.validateApiKey(apiKey);
	}

	public getZurgApiKey(apiKey: string) {
		return this.zurgKeysService.getApiKey(apiKey);
	}

	public deleteZurgApiKey(apiKey: string) {
		return this.zurgKeysService.deleteApiKey(apiKey);
	}

	public deleteExpiredZurgKeys() {
		return this.zurgKeysService.deleteExpiredKeys();
	}

	public listZurgApiKeys() {
		return this.zurgKeysService.listApiKeys();
	}

	// Stream Health Service Methods
	public upsertStreamHealthResults(results: StreamServerStatus[]) {
		return this.streamHealthService.upsertHealthResults(results);
	}

	public getAllStreamStatuses() {
		return this.streamHealthService.getAllStatuses();
	}

	public getStreamHealthMetrics() {
		return this.streamHealthService.getMetrics();
	}

	public deleteStreamHealthHosts(hosts: string[]) {
		return this.streamHealthService.deleteHosts(hosts);
	}

	public deleteDeprecatedStreamHosts(validHosts: string[]) {
		return this.streamHealthService.deleteDeprecatedHosts(validHosts);
	}

	public cleanupOldStreamHealth(olderThanHours?: number) {
		return this.streamHealthService.cleanupOldEntries(olderThanHours);
	}

	public getStreamHealthCount() {
		return this.streamHealthService.getCount();
	}

	public recordStreamCheckResult(result: {
		ok: boolean;
		latencyMs: number | null;
		server: string | null;
		error: string | null;
	}) {
		return this.streamHealthService.recordCheckResult(result);
	}

	public getRecentStreamChecks(limit?: number) {
		return this.streamHealthService.getRecentChecks(limit);
	}

	public recordTorrentioCheckResult(result: {
		ok: boolean;
		latencyMs: number | null;
		error: string | null;
		urls: TorrentioUrlCheckResult[];
	}) {
		return this.streamHealthService.recordTorrentioCheckResult(result);
	}

	public getRecentTorrentioChecks(limit?: number) {
		return this.streamHealthService.getRecentTorrentioChecks(limit);
	}

	// History Aggregation Service Methods
	public recordStreamHealthSnapshot(data: {
		totalServers: number;
		workingServers: number;
		avgLatencyMs: number | null;
		minLatencyMs: number | null;
		maxLatencyMs: number | null;
		fastestServer: string | null;
		failedServers: string[];
	}) {
		return this.historyAggregationService.recordStreamHealthSnapshot(data);
	}

	public recordServerReliability(
		statuses: Array<{ host: string; ok: boolean; latencyMs: number | null }>
	) {
		return this.historyAggregationService.recordServerReliability(statuses);
	}

	public rollupStreamDaily(targetDate?: Date) {
		return this.historyAggregationService.rollupStreamDaily(targetDate);
	}

	public cleanupOldHistoryData() {
		return this.historyAggregationService.cleanupOldData();
	}

	public getStreamHourlyHistory(hoursBack?: number) {
		return this.historyAggregationService.getStreamHourlyHistory(hoursBack);
	}

	public getStreamDailyHistory(daysBack?: number) {
		return this.historyAggregationService.getStreamDailyHistory(daysBack);
	}

	public getServerReliability(
		daysBack?: number,
		sortBy?: 'reliability' | 'latency',
		limit?: number
	) {
		return this.historyAggregationService.getServerReliability(daysBack, sortBy, limit);
	}

	public recordTorrentioHealthSnapshot(data: { ok: boolean; latencyMs: number | null }) {
		return this.historyAggregationService.recordTorrentioHealthSnapshot(data);
	}

	public getTorrentioHourlyHistory(hoursBack?: number) {
		return this.historyAggregationService.getTorrentioHourlyHistory(hoursBack);
	}

	public getTorrentioDailyHistory(daysBack?: number) {
		return this.historyAggregationService.getTorrentioDailyHistory(daysBack);
	}

	public rollupTorrentioDaily(targetDate?: Date) {
		return this.historyAggregationService.rollupTorrentioDaily(targetDate);
	}

	public runHistoryAggregation() {
		return this.historyAggregationService.runAggregation();
	}

	public runDailyRollup(targetDate?: Date) {
		return this.historyAggregationService.runDailyRollup(targetDate);
	}

	// RD Operational Service Methods
	public recordRdOperation(operation: RealDebridOperation, status: number) {
		return this.rdOperationalService.recordOperation(operation, status);
	}

	public getRdStats(hoursBack?: number) {
		return this.rdOperationalService.getStats(hoursBack);
	}

	public getRdHourlyHistory(hoursBack?: number) {
		return this.rdOperationalService.getHourlyHistory(hoursBack);
	}

	public getRdDailyHistory(daysBack?: number) {
		return this.rdOperationalService.getDailyHistory(daysBack);
	}

	public rollupRdDaily(targetDate?: Date) {
		return this.rdOperationalService.rollupDaily(targetDate);
	}

	public cleanupOldRdData() {
		return this.rdOperationalService.cleanupOldData();
	}

	// IMDB Search Service Methods
	public searchImdbTitles(
		keyword: string,
		options?: { limit?: number; year?: number; mediaType?: 'movie' | 'show' }
	) {
		return this.imdbSearchService.searchTitles(keyword, options);
	}

	public getImdbTitleById(imdbId: string) {
		return this.imdbSearchService.getTitleById(imdbId);
	}
}

// Export singleton instance to ensure only one PrismaClient exists
export const repository = new Repository();
