import { Prisma } from '@prisma/client';
import {
	AllDebridCastService,
	AnimeService,
	AvailabilityService,
	CastService,
	ContentRequestService,
	DebridUploaderMapService,
	DmmApiKeysService,
	HashImdbService,
	HashSearchService,
	HistoryAggregationService,
	ImdbSearchService,
	Nzb2rdMapService,
	type Nzb2rdWaiter,
	NzbSearchCacheService,
	PremiumizeCastService,
	RdOperationalService,
	ReportService,
	ScrapedService,
	SearchService,
	SponsorsService,
	StreamHealthService,
	TorBoxCastService,
	TorBoxCdnService,
	TorBoxOperationalService,
	TorrentSnapshotService,
	type TransferMetaRecord,
	TransferMetaService,
	type TransferMetaSource,
	ZurgKeysService,
} from './database';
import { HashSearchParams } from './database/hashSearch';
import { RealDebridOperation } from './database/rdOperational';
import { StreamServerStatus, TorrentioUrlCheckResult } from './database/streamHealth';
import { TorBoxCdnSample } from './database/torboxCdn';
import { TorBoxOperation } from './database/torboxOperational';
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
	premiumizeCastService: PremiumizeCastService;
	reportService: ReportService;
	torrentSnapshotService: TorrentSnapshotService;
	hashImdbService: HashImdbService;
	hashSearchService: HashSearchService;
	zurgKeysService: ZurgKeysService;
	dmmApiKeysService: DmmApiKeysService;
	sponsorsService: SponsorsService;
	streamHealthService: StreamHealthService;
	historyAggregationService: HistoryAggregationService;
	rdOperationalService: RdOperationalService;
	torboxOperationalService: TorBoxOperationalService;
	torboxCdnService: TorBoxCdnService;
	imdbSearchService: ImdbSearchService;
	debridUploaderMapService: DebridUploaderMapService;
	nzb2rdMapService: Nzb2rdMapService;
	nzbSearchCacheService: NzbSearchCacheService;
	transferMetaService: TransferMetaService;
	contentRequestService: ContentRequestService;
}>;

export class Repository {
	private availabilityService: AvailabilityService;
	private scrapedService: ScrapedService;
	private searchService: SearchService;
	private animeService: AnimeService;
	private castService: CastService;
	private torboxCastService: TorBoxCastService;
	private allDebridCastService: AllDebridCastService;
	private premiumizeCastService: PremiumizeCastService;
	private reportService: ReportService;
	private torrentSnapshotService: TorrentSnapshotService;
	private hashImdbService: HashImdbService;
	private hashSearchService: HashSearchService;
	private zurgKeysService: ZurgKeysService;
	private dmmApiKeysService: DmmApiKeysService;
	private sponsorsService: SponsorsService;
	private streamHealthService: StreamHealthService;
	private historyAggregationService: HistoryAggregationService;
	private rdOperationalService: RdOperationalService;
	private torboxOperationalService: TorBoxOperationalService;
	private torboxCdnService: TorBoxCdnService;
	private imdbSearchService: ImdbSearchService;
	private debridUploaderMapService: DebridUploaderMapService;
	private nzb2rdMapService: Nzb2rdMapService;
	private nzbSearchCacheService: NzbSearchCacheService;
	private transferMetaService: TransferMetaService;
	private contentRequestService: ContentRequestService;

	constructor({
		availabilityService,
		scrapedService,
		searchService,
		animeService,
		castService,
		torboxCastService,
		allDebridCastService,
		premiumizeCastService,
		reportService,
		torrentSnapshotService,
		hashImdbService,
		hashSearchService,
		zurgKeysService,
		dmmApiKeysService,
		sponsorsService,
		streamHealthService,
		historyAggregationService,
		rdOperationalService,
		torboxOperationalService,
		torboxCdnService,
		imdbSearchService,
		debridUploaderMapService,
		nzb2rdMapService,
		nzbSearchCacheService,
		transferMetaService,
		contentRequestService,
	}: RepositoryDependencies = {}) {
		this.availabilityService = availabilityService ?? new AvailabilityService();
		this.scrapedService = scrapedService ?? new ScrapedService();
		this.searchService = searchService ?? new SearchService();
		this.animeService = animeService ?? new AnimeService();
		this.castService = castService ?? new CastService();
		this.torboxCastService = torboxCastService ?? new TorBoxCastService();
		this.allDebridCastService = allDebridCastService ?? new AllDebridCastService();
		this.premiumizeCastService = premiumizeCastService ?? new PremiumizeCastService();
		this.reportService = reportService ?? new ReportService();
		this.torrentSnapshotService = torrentSnapshotService ?? new TorrentSnapshotService();
		this.hashImdbService = hashImdbService ?? new HashImdbService();
		this.hashSearchService = hashSearchService ?? new HashSearchService();
		this.zurgKeysService = zurgKeysService ?? new ZurgKeysService();
		this.dmmApiKeysService = dmmApiKeysService ?? new DmmApiKeysService();
		this.sponsorsService = sponsorsService ?? new SponsorsService();
		this.streamHealthService = streamHealthService ?? new StreamHealthService();
		this.historyAggregationService =
			historyAggregationService ?? new HistoryAggregationService();
		this.rdOperationalService = rdOperationalService ?? new RdOperationalService();
		this.torboxOperationalService = torboxOperationalService ?? new TorBoxOperationalService();
		this.torboxCdnService = torboxCdnService ?? new TorBoxCdnService();
		this.imdbSearchService = imdbSearchService ?? new ImdbSearchService();
		this.debridUploaderMapService = debridUploaderMapService ?? new DebridUploaderMapService();
		this.nzb2rdMapService = nzb2rdMapService ?? new Nzb2rdMapService();
		this.nzbSearchCacheService = nzbSearchCacheService ?? new NzbSearchCacheService();
		this.transferMetaService = transferMetaService ?? new TransferMetaService();
		this.contentRequestService = contentRequestService ?? new ContentRequestService();
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
			this.dmmApiKeysService.disconnect(),
			this.sponsorsService.disconnect(),
			this.streamHealthService.disconnect(),
			this.historyAggregationService.disconnect(),
			this.rdOperationalService.disconnect(),
			this.torboxOperationalService.disconnect(),
			this.imdbSearchService.disconnect(),
			this.debridUploaderMapService.disconnect(),
			this.nzb2rdMapService.disconnect(),
			this.nzbSearchCacheService.disconnect(),
			this.transferMetaService.disconnect(),
			this.contentRequestService.disconnect(),
		]);
	}

	// Content request board (RD-only users ask; TB/AD users fulfil)
	public createContentRequest(input: Parameters<ContentRequestService['createRequest']>[0]) {
		return this.contentRequestService.createRequest(input);
	}

	public getContentRequest(id: string) {
		return this.contentRequestService.getRequest(id);
	}

	public listOpenContentRequests(limit: number, offset = 0) {
		return this.contentRequestService.listOpenRequests(limit, offset);
	}

	public listContentRequestsFor(requesterId: string, limit: number) {
		return this.contentRequestService.listRequestsFor(requesterId, limit);
	}

	public claimContentRequest(id: string, fulfillerId: string) {
		return this.contentRequestService.claimRequest(id, fulfillerId);
	}

	public attachContentRequestJob(id: string, jobId: string, jobHost: string) {
		return this.contentRequestService.attachJob(id, jobId, jobHost);
	}

	public releaseContentRequest(id: string, error: string) {
		return this.contentRequestService.releaseRequest(id, error);
	}

	public cancelContentRequest(id: string, requesterId: string) {
		return this.contentRequestService.cancelRequest(id, requesterId);
	}

	// Debrid Uploader (TB → RD transfer) mapping methods
	public getDebridTransfer(originalHash: string) {
		return this.debridUploaderMapService.getTransfer(originalHash);
	}

	public getDebridTransfers(originalHashes: string[]) {
		return this.debridUploaderMapService.getTransfers(originalHashes);
	}

	public recordDebridTransferPending(originalHash: string, jobId: string, imdbId: string) {
		return this.debridUploaderMapService.recordPending(originalHash, jobId, imdbId);
	}

	public recordDebridTransferCompleted(
		originalHash: string,
		jobId: string,
		imdbId: string,
		rewrittenHash: string
	) {
		return this.debridUploaderMapService.recordCompleted(
			originalHash,
			jobId,
			imdbId,
			rewrittenHash
		);
	}

	public removeDebridTransfer(originalHash: string) {
		return this.debridUploaderMapService.removeTransfer(originalHash);
	}

	public recordDebridJobServer(jobId: string, serverUrl: string) {
		return this.debridUploaderMapService.recordJobServer(jobId, serverUrl);
	}

	public getDebridJobServer(jobId: string) {
		return this.debridUploaderMapService.getJobServer(jobId);
	}

	// nzb2rd (Usenet → RD transfer) mapping methods, keyed by indexer release id
	public getNzb2rdTransfer(releaseId: string) {
		return this.nzb2rdMapService.getTransfer(releaseId);
	}

	public getNzb2rdTransfers(releaseIds: string[]) {
		return this.nzb2rdMapService.getTransfers(releaseIds);
	}

	public recordNzb2rdTransferPending(
		releaseId: string,
		jobId: string,
		imdbId: string,
		title?: string
	) {
		return this.nzb2rdMapService.recordPending(releaseId, jobId, imdbId, title);
	}

	public recordNzb2rdTransferCompleted(
		releaseId: string,
		jobId: string,
		imdbId: string,
		infoHash: string,
		title?: string
	) {
		return this.nzb2rdMapService.recordCompleted(releaseId, jobId, imdbId, infoHash, title);
	}

	public recordNzb2rdTransferFailed(
		releaseId: string,
		jobId: string,
		imdbId: string,
		error?: string,
		title?: string
	) {
		return this.nzb2rdMapService.recordFailed(releaseId, jobId, imdbId, error, title);
	}

	public removeNzb2rdTransfer(releaseId: string) {
		return this.nzb2rdMapService.removeTransfer(releaseId);
	}

	// Users parked on someone else's in-flight job, to be given the content when it lands
	public addNzb2rdWaiter(
		releaseId: string,
		rdKey: string,
		imdbId: string,
		oauth?: Nzb2rdWaiter['oauth']
	) {
		return this.nzb2rdMapService.addWaiter(releaseId, rdKey, imdbId, oauth);
	}

	public takeNzb2rdWaiters(releaseId: string) {
		return this.nzb2rdMapService.takeWaiters(releaseId);
	}

	public getNzb2rdWaiters(releaseId: string) {
		return this.nzb2rdMapService.getWaiters(releaseId);
	}

	// Page context for a transfer — the DMM title and the content page it started
	// from — which neither uploader service stores and localStorage used to hold.
	public recordTransferMeta(meta: Omit<TransferMetaRecord, 'updatedAt'>) {
		return this.transferMetaService.record(meta);
	}

	public getTransferMeta(jobs: { source: TransferMetaSource; jobId: string }[]) {
		return this.transferMetaService.getMany(jobs);
	}

	// Newznab search cache, so one indexer call serves a title for a whole TTL
	public getCachedNzbSearch(imdbId: string, seasonNum?: number) {
		return this.nzbSearchCacheService.get(imdbId, seasonNum);
	}

	public setCachedNzbSearch(
		imdbId: string,
		seasonNum: number | undefined,
		results: Parameters<NzbSearchCacheService['set']>[2]
	) {
		return this.nzbSearchCacheService.set(imdbId, seasonNum, results);
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

	public saveInstantAvailability(
		imdbId: string,
		rows: Array<{ hash: string; filename: string; bytes: number }>
	) {
		return this.availabilityService.saveInstantAvailability(imdbId, rows);
	}

	public getDebridioRefreshedAt(key: string) {
		return this.availabilityService.getDebridioRefreshedAt(key);
	}

	public markDebridioRefreshed(key: string) {
		return this.availabilityService.markDebridioRefreshed(key);
	}

	public saveInstantAvailabilityAd(
		imdbId: string,
		rows: Array<{ hash: string; filename: string; bytes: number }>
	) {
		return this.availabilityService.saveInstantAvailabilityAd(imdbId, rows);
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

	public removeAvailableFileByLinkPrefix(linkPrefix: string) {
		return this.availabilityService.removeAvailableFileByLinkPrefix(linkPrefix);
	}

	public deleteCastsByLinkPrefix(linkPrefix: string) {
		return this.castService.deleteCastsByLinkPrefix(linkPrefix);
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

	public checkAvailabilityAdByHashes(hashes: string[]) {
		return this.availabilityService.checkAvailabilityAdByHashes(hashes);
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

	public getAllScrapedTrueResults(key: string) {
		return this.scrapedService.getAllScrapedTrueResults(key);
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

	public updateAllDebridCastSettings(
		userId: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.allDebridCastService.updateCastSettings(
			userId,
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

	// Premiumize Cast Methods
	public savePremiumizeCastProfile(
		userId: string,
		apiKey: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.premiumizeCastService.saveCastProfile(
			userId,
			apiKey,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption
		);
	}

	public updatePremiumizeCastSettings(
		userId: string,
		movieMaxSize?: number,
		episodeMaxSize?: number,
		otherStreamsLimit?: number,
		hideCastOption?: boolean
	) {
		return this.premiumizeCastService.updateCastSettings(
			userId,
			movieMaxSize,
			episodeMaxSize,
			otherStreamsLimit,
			hideCastOption
		);
	}

	public getPremiumizeCastProfile(userId: string) {
		return this.premiumizeCastService.getCastProfile(userId);
	}

	public savePremiumizeCast(
		imdbId: string,
		userId: string,
		hash: string,
		filename: string,
		fileSize: number,
		path?: string
	) {
		return this.premiumizeCastService.saveCast(imdbId, userId, hash, filename, fileSize, path);
	}

	public fetchPremiumizeCastedMovies(userId: string) {
		return this.premiumizeCastService.fetchCastedMovies(userId);
	}

	public fetchPremiumizeCastedShows(userId: string) {
		return this.premiumizeCastService.fetchCastedShows(userId);
	}

	public fetchAllPremiumizeCastedLinks(userId: string) {
		return this.premiumizeCastService.fetchAllCastedLinks(userId);
	}

	public deletePremiumizeCastedLink(imdbId: string, userId: string, hash: string) {
		return this.premiumizeCastService.deleteCastedLink(imdbId, userId, hash);
	}

	public getPremiumizeUserCastStreams(imdbId: string, userId: string, limit?: number) {
		return this.premiumizeCastService.getUserCastStreams(imdbId, userId, limit);
	}

	public getPremiumizeOtherStreams(
		imdbId: string,
		userId: string,
		limit?: number,
		maxSize?: number
	) {
		return this.premiumizeCastService.getOtherStreams(imdbId, userId, limit, maxSize);
	}

	public getAllDebridCastLink(magnetId: number, fileIndex: number) {
		return this.allDebridCastService.getCastLink(magnetId, fileIndex);
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

	// DMM API Keys Service Methods
	public validateDmmApiKey(apiKey: string) {
		return this.dmmApiKeysService.validateApiKey(apiKey);
	}

	// Sponsors Service Methods
	public getSponsorByDmmApiKey(apiKey: string) {
		return this.sponsorsService.getByDmmApiKey(apiKey);
	}

	public getSponsorByShortId(shortId: string) {
		return this.sponsorsService.getByShortId(shortId);
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

	// TorBox Operational Service Methods (real DMM-user TorBox API calls)
	public recordTorBoxOperation(operation: TorBoxOperation, status: number) {
		return this.torboxOperationalService.recordOperation(operation, status);
	}

	public getTorBoxOperationalStats(hoursBack?: number) {
		return this.torboxOperationalService.getStats(hoursBack);
	}

	public getTorBoxOperationalHourlyHistory(hoursBack?: number) {
		return this.torboxOperationalService.getHourlyHistory(hoursBack);
	}

	public getTorBoxOperationalDailyHistory(daysBack?: number) {
		return this.torboxOperationalService.getDailyHistory(daysBack);
	}

	public rollupTorBoxOperationalDaily(targetDate?: Date) {
		return this.torboxOperationalService.rollupDaily(targetDate);
	}

	public cleanupOldTorBoxOperationalData() {
		return this.torboxOperationalService.cleanupOldData();
	}

	// TorBox CDN Service Methods (reachability measured in readers' own browsers)
	public recordTorBoxCdnSamples(samples: TorBoxCdnSample[]) {
		return this.torboxCdnService.recordSamples(samples);
	}

	public getTorBoxCdnHourlyHistory(hoursBack?: number) {
		return this.torboxCdnService.getHourlyHistory(hoursBack);
	}

	public getTorBoxCdnDailyHistory(daysBack?: number) {
		return this.torboxCdnService.getDailyHistory(daysBack);
	}

	public getTorBoxCdnRegionSummary(hoursBack?: number) {
		return this.torboxCdnService.getRegionSummary(hoursBack);
	}

	public rollupTorBoxCdnDaily(targetDate?: Date) {
		return this.torboxCdnService.rollupDaily(targetDate);
	}

	public cleanupOldTorBoxCdnData() {
		return this.torboxCdnService.cleanupOldData();
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

	public getImdbTitleType(imdbId: string) {
		return this.imdbSearchService.getTitleType(imdbId);
	}
}

// Export singleton instance to ensure only one PrismaClient exists
export const repository = new Repository();
