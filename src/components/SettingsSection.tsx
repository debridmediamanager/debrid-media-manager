import { AlertTriangle, Check, Link2, Settings } from 'lucide-react';
import { useState } from 'react';
import { updateAllDebridSizeLimits } from '../utils/allDebridCastApiClient';
import {
	getLocalStorageBoolean,
	getLocalStorageItemOrDefault,
	getLocalStorageString,
} from '../utils/browserStorage';
import {
	defaultAvailabilityCheckLimit,
	defaultDownloadMagnets,
	defaultEpisodeSize,
	defaultHideRdBlockedTorrents,
	defaultMagnetHandlerEnabled,
	defaultMovieSize,
	defaultMovieYearFilter,
	defaultOtherStreamsLimit,
	defaultPlayer,
	defaultShowCalendarAddButtonsApple,
	defaultShowCalendarAddButtonsGoogle,
	defaultShowSeasonFilter,
	defaultTorrentsFilter,
} from '../utils/settings';
import { updateTorBoxSizeLimits } from '../utils/torboxCastApiClient';

export const SettingsSection = () => {
	const [isMagnetHandlerEnabled, setIsMagnetHandlerEnabled] = useState(() =>
		getLocalStorageBoolean('settings:magnetHandlerEnabled', defaultMagnetHandlerEnabled)
	);

	const [storedPlayer, setStoredPlayer] = useState(() =>
		getLocalStorageItemOrDefault('settings:player', defaultPlayer)
	);
	const [movieMaxSize, setMovieMaxSize] = useState(() =>
		getLocalStorageItemOrDefault('settings:movieMaxSize', defaultMovieSize)
	);
	const [episodeMaxSize, setEpisodeMaxSize] = useState(() =>
		getLocalStorageItemOrDefault('settings:episodeMaxSize', defaultEpisodeSize)
	);
	const [otherStreamsLimit, setOtherStreamsLimit] = useState(() =>
		getLocalStorageItemOrDefault('settings:otherStreamsLimit', defaultOtherStreamsLimit)
	);
	const [onlyTrustedTorrents, setOnlyTrustedTorrents] = useState(() =>
		getLocalStorageBoolean('settings:onlyTrustedTorrents', false)
	);
	const [movieYearFilter, setMovieYearFilter] = useState(() =>
		getLocalStorageItemOrDefault('settings:movieYearFilter', defaultMovieYearFilter)
	);
	const [showSeasonFilter, setShowSeasonFilter] = useState(() =>
		getLocalStorageBoolean('settings:showSeasonFilter', defaultShowSeasonFilter)
	);
	const [defaultTorrentsFilterValue, setDefaultTorrentsFilterValue] = useState(() =>
		getLocalStorageItemOrDefault('settings:defaultTorrentsFilter', defaultTorrentsFilter)
	);
	const [downloadMagnets, setDownloadMagnets] = useState(() =>
		getLocalStorageBoolean('settings:downloadMagnets', defaultDownloadMagnets)
	);
	const [showMassReportButtons, setShowMassReportButtons] = useState(() =>
		getLocalStorageBoolean('settings:showMassReportButtons', false)
	);
	const [availabilityCheckLimit, setAvailabilityCheckLimit] = useState(() =>
		getLocalStorageItemOrDefault(
			'settings:availabilityCheckLimit',
			defaultAvailabilityCheckLimit
		)
	);
	const [includeTrackerStats, setIncludeTrackerStats] = useState(() =>
		getLocalStorageBoolean('settings:includeTrackerStats', false)
	);
	const [showCalendarAddButtonsGoogle, setShowCalendarAddButtonsGoogle] = useState(() =>
		getLocalStorageBoolean(
			'settings:showCalendarAddButtonsGoogle',
			defaultShowCalendarAddButtonsGoogle
		)
	);
	const [showCalendarAddButtonsApple, setShowCalendarAddButtonsApple] = useState(() =>
		getLocalStorageBoolean(
			'settings:showCalendarAddButtonsApple',
			defaultShowCalendarAddButtonsApple
		)
	);
	const [enableTorrentio, setEnableTorrentio] = useState(() =>
		getLocalStorageBoolean('settings:enableTorrentio', true)
	);
	const [enableComet, setEnableComet] = useState(() =>
		getLocalStorageBoolean('settings:enableComet', true)
	);
	const [enableMediaFusion, setEnableMediaFusion] = useState(() =>
		getLocalStorageBoolean('settings:enableMediaFusion', true)
	);
	const [enablePeerflix, setEnablePeerflix] = useState(() =>
		getLocalStorageBoolean('settings:enablePeerflix', true)
	);
	const [enableTorrentsDB, setEnableTorrentsDB] = useState(() =>
		getLocalStorageBoolean('settings:enableTorrentsDB', true)
	);
	const [enableTorrentioTor, setEnableTorrentioTor] = useState(() =>
		getLocalStorageBoolean('settings:enableTorrentioTor', false)
	);
	const [enableCometTor, setEnableCometTor] = useState(() =>
		getLocalStorageBoolean('settings:enableCometTor', false)
	);
	const [enableMediaFusionTor, setEnableMediaFusionTor] = useState(() =>
		getLocalStorageBoolean('settings:enableMediaFusionTor', false)
	);
	const [enablePeerflixTor, setEnablePeerflixTor] = useState(() =>
		getLocalStorageBoolean('settings:enablePeerflixTor', false)
	);
	const [enableTorrentsDBTor, setEnableTorrentsDBTor] = useState(() =>
		getLocalStorageBoolean('settings:enableTorrentsDBTor', false)
	);
	const [hideCastOption, setHideCastOption] = useState(() =>
		getLocalStorageBoolean('settings:hideCastOption', false)
	);
	const [hideRdBlockedTorrents, setHideRdBlockedTorrents] = useState(() => {
		if (typeof localStorage === 'undefined') return defaultHideRdBlockedTorrents;
		const stored = localStorage.getItem('settings:hideRdBlockedTorrents');
		if (stored !== null) return stored === 'true';
		const hasRd = !!localStorage.getItem('rd:accessToken');
		const hasAd = !!localStorage.getItem('ad:apiKey');
		const hasTb = !!localStorage.getItem('tb:apiKey');
		return hasRd && !hasAd && !hasTb;
	});

	const handlePlayerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		setStoredPlayer(value);
		if (typeof localStorage !== 'undefined') localStorage.setItem('settings:player', value);
	};

	const updateCastSizeLimits = async (
		movieSize?: string,
		episodeSize?: string,
		streamsLimit?: string,
		hideCast?: boolean
	) => {
		if (typeof localStorage === 'undefined') return;

		const updatePromises: Promise<void>[] = [];

		// Update Real-Debrid cast settings
		const castToken = localStorage.getItem('rd:castToken');
		const clientIdRaw = localStorage.getItem('rd:clientId');
		const clientSecretRaw = localStorage.getItem('rd:clientSecret');
		const refreshTokenRaw = localStorage.getItem('rd:refreshToken');

		if (castToken && clientIdRaw && clientSecretRaw) {
			const clientId = JSON.parse(clientIdRaw);
			const clientSecret = JSON.parse(clientSecretRaw);
			const refreshToken = refreshTokenRaw ? JSON.parse(refreshTokenRaw) : null;

			updatePromises.push(
				fetch('/api/stremio/cast/updateSizeLimits', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						clientId,
						clientSecret,
						refreshToken,
						movieMaxSize: movieSize !== undefined ? Number(movieSize) : undefined,
						episodeMaxSize: episodeSize !== undefined ? Number(episodeSize) : undefined,
						otherStreamsLimit:
							streamsLimit !== undefined ? Number(streamsLimit) : undefined,
						hideCastOption: hideCast,
					}),
				}).then(() => {})
			);
		}

		// Update TorBox cast settings
		const tbApiKey = getLocalStorageString('tb:apiKey');
		if (tbApiKey) {
			updatePromises.push(
				updateTorBoxSizeLimits(
					tbApiKey,
					movieSize !== undefined ? Number(movieSize) : undefined,
					episodeSize !== undefined ? Number(episodeSize) : undefined,
					streamsLimit !== undefined ? Number(streamsLimit) : undefined,
					hideCast
				)
			);
		}

		// Update AllDebrid cast settings
		const adApiKey = getLocalStorageString('ad:apiKey');
		if (adApiKey) {
			updatePromises.push(
				updateAllDebridSizeLimits(
					adApiKey,
					movieSize !== undefined ? Number(movieSize) : undefined,
					episodeSize !== undefined ? Number(episodeSize) : undefined,
					streamsLimit !== undefined ? Number(streamsLimit) : undefined,
					hideCast
				)
			);
		}

		try {
			await Promise.all(updatePromises);
		} catch (error) {
			console.error('Failed to update size limits on server:', error);
		}
	};

	const handleMovieSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		setMovieMaxSize(value);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('settings:movieMaxSize', value);
			updateCastSizeLimits(value, undefined, undefined);
		}
	};

	const handleEpisodeSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		setEpisodeMaxSize(value);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('settings:episodeMaxSize', value);
			updateCastSizeLimits(undefined, value, undefined);
		}
	};

	const handleOtherStreamsLimitChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		setOtherStreamsLimit(value);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('settings:otherStreamsLimit', value);
			updateCastSizeLimits(undefined, undefined, value);
		}
	};

	const handleTorrentsFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		setDefaultTorrentsFilterValue(value);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:defaultTorrentsFilter', value);
	};

	const handleTrustedTorrentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setOnlyTrustedTorrents(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:onlyTrustedTorrents', String(checked));
	};

	const handleHideRdBlockedTorrentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setHideRdBlockedTorrents(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:hideRdBlockedTorrents', String(checked));
	};

	const handleMovieYearFilterChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		const value = e.target.value;
		setMovieYearFilter(value);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:movieYearFilter', value);
	};

	const handleShowSeasonFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setShowSeasonFilter(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:showSeasonFilter', String(checked));
	};

	const handleDownloadMagnetsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setDownloadMagnets(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:downloadMagnets', String(checked));
	};

	const handleMassReportButtonsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setShowMassReportButtons(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:showMassReportButtons', String(checked));
	};

	const handleShowCalendarAddButtonsGoogleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setShowCalendarAddButtonsGoogle(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:showCalendarAddButtonsGoogle', String(checked));
	};

	const handleShowCalendarAddButtonsAppleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setShowCalendarAddButtonsApple(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:showCalendarAddButtonsApple', String(checked));
	};

	const handleAvailabilityCheckLimitChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const value = e.target.value;
		// Only allow numbers
		if (value === '' || /^\d+$/.test(value)) {
			setAvailabilityCheckLimit(value);
			if (typeof localStorage !== 'undefined')
				localStorage.setItem('settings:availabilityCheckLimit', value);
		}
	};

	const handleIncludeTrackerStatsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setIncludeTrackerStats(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:includeTrackerStats', String(checked));
	};

	const handleEnableTorrentioChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableTorrentio(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableTorrentio', String(checked));
	};

	const handleEnableCometChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableComet(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableComet', String(checked));
	};

	const handleEnableMediaFusionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableMediaFusion(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableMediaFusion', String(checked));
	};

	const handleEnablePeerflixChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnablePeerflix(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enablePeerflix', String(checked));
	};

	const handleEnableTorrentsDBChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableTorrentsDB(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableTorrentsDB', String(checked));
	};

	const handleEnableCometTorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableCometTor(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableCometTor', String(checked));
	};

	const handleEnableMediaFusionTorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableMediaFusionTor(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableMediaFusionTor', String(checked));
	};

	const handleEnablePeerflixTorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnablePeerflixTor(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enablePeerflixTor', String(checked));
	};

	const handleEnableTorrentsDBTorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableTorrentsDBTor(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableTorrentsDBTor', String(checked));
	};

	const handleEnableTorrentioTorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setEnableTorrentioTor(checked);
		if (typeof localStorage !== 'undefined')
			localStorage.setItem('settings:enableTorrentioTor', String(checked));
	};

	const handleHideCastOptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setHideCastOption(checked);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('settings:hideCastOption', String(checked));
			updateCastSizeLimits(undefined, undefined, undefined, checked);
		}
	};

	const getBrowserSettingsInfo = () => {
		if (typeof navigator === 'undefined') {
			return { text: 'Browser protocol handler settings:', url: '' };
		}
		const ua = navigator.userAgent;
		if (ua.includes('Chrome') && !ua.includes('Edg')) {
			return {
				text: 'Chrome protocol handler settings:',
				url: 'chrome://settings/handlers',
			};
		} else if (ua.includes('Firefox')) {
			return {
				text: 'Firefox protocol handler settings:',
				url: 'about:preferences#general',
			};
		} else if (ua.includes('Edg')) {
			return {
				text: 'Edge protocol handler settings:',
				url: 'edge://settings/content/handlers',
			};
		}
		return {
			text: 'Browser protocol handler settings:',
			url: '',
		};
	};

	return (
		<div className="w-full max-w-md">
			<div className="rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-5 shadow-sm">
				<div className="flex items-center gap-2 text-gray-100">
					<Settings className="h-5 w-5 text-gray-300" />
					<h1 className="text-lg font-semibold">Settings</h1>
				</div>
				<div className="mt-4 text-sm text-gray-200">
					<div className="flex flex-col gap-4">
						<div className="rounded border-2 border-yellow-500/30 p-4">
							<div className="mb-4 flex items-center justify-center text-center text-sm font-medium text-yellow-200">
								<AlertTriangle className="mr-2 inline-block h-4 w-4 text-yellow-400" />
								Experiencing lag or buffering? Try smaller files
							</div>

							<div className="flex flex-col gap-4">
								<div className="text-center text-xs text-gray-400">
									Check your connection speed:{' '}
									<a
										href="https://real-debrid.com/speedtest"
										target="_blank"
										rel="noopener"
										className="text-blue-400 hover:underline"
									>
										Real-Debrid
									</a>
									{' · '}
									<a
										href="https://alldebrid.com/speedtest"
										target="_blank"
										rel="noopener"
										className="text-blue-400 hover:underline"
									>
										AllDebrid
									</a>
									{' · '}
									<a
										href="https://speedtest.torbox.app/"
										target="_blank"
										rel="noopener"
										className="text-blue-400 hover:underline"
									>
										Torbox
									</a>
								</div>

								<div className="flex flex-col gap-1">
									<label className="font-semibold">Biggest movie size</label>
									<select
										id="dmm-movie-max-size"
										className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
										value={movieMaxSize}
										onChange={handleMovieSizeChange}
									>
										<option value="1">1 GB (~1.5 Mbps)</option>
										<option value="3">3 GB (~4.5 Mbps)</option>
										<option value="5">5 GB (~7.5 Mbps)</option>
										<option value="15">15 GB (~22 Mbps)</option>
										<option value="30">30 GB (~45 Mbps)</option>
										<option value="60">60 GB (~90 Mbps)</option>
										<option value="0">Biggest available</option>
									</select>
								</div>

								<div className="flex flex-col gap-1">
									<label className="font-semibold">Biggest episode size</label>
									<select
										id="dmm-episode-max-size"
										className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
										value={episodeMaxSize}
										onChange={handleEpisodeSizeChange}
									>
										<option value="0.1">100 MB (~0.7 Mbps)</option>
										<option value="0.3">300 MB (~2 Mbps)</option>
										<option value="0.5">500 MB (~3.5 Mbps)</option>
										<option value="1">1 GB (~7 Mbps)</option>
										<option value="3">3 GB (~21 Mbps)</option>
										<option value="5">5 GB (~35 Mbps)</option>
										<option value="0">Biggest available</option>
									</select>
									<p className="mt-1 text-xs text-gray-400">
										💡 These size limits also apply to the Stremio Cast addon
										stream selection
									</p>
								</div>
							</div>
						</div>

						<div className="rounded border-2 border-purple-500/30 p-4">
							<div className="mb-2 text-sm font-semibold text-purple-200">
								Stremio Cast Settings
							</div>

							<div className="flex flex-col gap-4">
								<div className="flex flex-col gap-1">
									<label className="font-semibold">Other streams limit</label>
									<select
										id="dmm-other-streams-limit"
										className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
										value={otherStreamsLimit}
										onChange={handleOtherStreamsLimitChange}
									>
										<option value="0">Don&apos;t show other streams</option>
										<option value="1">1 stream</option>
										<option value="2">2 streams</option>
										<option value="3">3 streams</option>
										<option value="4">4 streams</option>
										<option value="5">5 streams</option>
									</select>
									<p className="mt-1 text-xs text-gray-400">
										Limits streams from available files, torrents, and other
										users&apos; casts shown in the Stremio Cast addon
									</p>
								</div>

								<div className="flex items-center gap-2">
									<input
										id="dmm-hide-cast-option"
										type="checkbox"
										className="h-5 w-5 rounded border-gray-600 bg-gray-800"
										checked={hideCastOption}
										onChange={handleHideCastOptionChange}
									/>
									<label htmlFor="dmm-hide-cast-option" className="font-semibold">
										Hide &quot;Cast a file inside a torrent&quot; option
									</label>
								</div>
								<p className="-mt-2 text-xs text-gray-400">
									When enabled, the cast option will not appear in Stremio streams
								</p>
							</div>
						</div>

						<div className="rounded border-2 border-gray-500/30 p-4">
							<div className="mb-2 text-sm font-semibold text-gray-200">Playback</div>

							<div className="flex flex-col gap-1">
								<label className="font-semibold">Video player</label>
								<select
									id="dmm-player"
									className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
									value={storedPlayer}
									onChange={handlePlayerChange}
								>
									<optgroup label="Web">
										<option value="web/rd">Real-Debrid Stream</option>
									</optgroup>
									<optgroup label="Android">
										<option value="android/chooser">App chooser</option>
										<option value="android/org.videolan.vlc">VLC</option>
										<option value="android/com.mxtech.videoplayer.ad">
											MX Player
										</option>
										<option value="android/com.mxtech.videoplayer.pro">
											MX Player Pro
										</option>
										<option value="android/com.brouken.player">
											JustPlayer
										</option>
									</optgroup>
									<optgroup label="iOS">
										<option value="ios2/open-vidhub">VidHub</option>
										<option value="ios/infuse">Infuse</option>
										<option value="ios/vlc">VLC</option>
										<option value="ios/outplayer">Outplayer</option>
									</optgroup>
									<optgroup label="MacOS">
										<option value="mac4/open-vidhub">VidHub</option>
										<option value="mac/infuse">Infuse</option>
										<option value="mac2/iina">IINA</option>
										<option value="mac2/omniplayer">OmniPlayer</option>
										<option value="mac2/figplayer">Fig Player</option>
										<option value="mac3/nplayer-mac">nPlayer</option>
									</optgroup>
									<optgroup label="Windows">
										<option value="windows/vlc">VLC</option>
										<option value="windows/potplayer">PotPlayer</option>
									</optgroup>
								</select>
							</div>
						</div>

						<div className="rounded border-2 border-gray-500/30 p-4">
							<div className="mb-2 text-sm font-semibold text-gray-200">
								Torrent Search &amp; Discovery
							</div>

							<div className="flex flex-col gap-4">
								<div className="flex flex-col gap-1">
									<label className="font-semibold">Default torrents filter</label>
									<input
										id="dmm-default-torrents-filter"
										type="text"
										className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
										placeholder="filter results, supports regex"
										value={defaultTorrentsFilterValue}
										onChange={handleTorrentsFilterChange}
									/>
								</div>

								<div className="flex items-center gap-2">
									<input
										id="dmm-only-trusted-torrents"
										type="checkbox"
										className="h-5 w-5 rounded border-gray-600 bg-gray-800"
										checked={onlyTrustedTorrents}
										onChange={handleTrustedTorrentsChange}
									/>
									<label className="font-semibold">Only trusted torrents</label>
								</div>

								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-2">
										<input
											id="dmm-hide-rd-blocked-torrents"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={hideRdBlockedTorrents}
											onChange={handleHideRdBlockedTorrentsChange}
										/>
										<label
											htmlFor="dmm-hide-rd-blocked-torrents"
											className="font-semibold"
										>
											Hide Real-Debrid blocked torrents
										</label>
									</div>
									<p className="mt-1 text-xs text-gray-400">
										Hide torrents with filenames that Real-Debrid blocks (e.g.
										WEB-DL, WEBRip, BluRay.x264).{' '}
										<a
											href="/rd-filename-filters.html"
											target="_blank"
											className="text-blue-400 hover:underline"
										>
											Learn more
										</a>
									</p>
								</div>

								<div className="flex flex-col gap-1">
									<label className="font-semibold">
										Prefilter movies by year
									</label>
									<select
										id="dmm-movie-year-filter"
										className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
										value={movieYearFilter}
										onChange={handleMovieYearFilterChange}
									>
										<option value="off">Off</option>
										<option value="0">Exact year</option>
										<option value="1">&plusmn;1 year</option>
										<option value="2">&plusmn;2 years</option>
									</select>
									<p className="mt-1 text-xs text-gray-400">
										Automatically filter movie results by release year with
										optional tolerance for off-by-one metadata
									</p>
								</div>

								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-2">
										<input
											id="dmm-show-season-filter"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={showSeasonFilter}
											onChange={handleShowSeasonFilterChange}
										/>
										<label
											htmlFor="dmm-show-season-filter"
											className="font-semibold"
										>
											Prefilter shows by season
										</label>
									</div>
									<p className="mt-1 text-xs text-gray-400">
										Automatically filter TV show results by season number (e.g.
										S01, Season 1)
									</p>
								</div>

								<div className="flex flex-col gap-2 rounded border-2 border-blue-500/30 p-3">
									<div className="text-sm font-semibold text-blue-200">
										External Sources
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-torrentio"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableTorrentio}
											onChange={handleEnableTorrentioChange}
										/>
										<label className="font-semibold">Enable Torrentio</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-comet"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableComet}
											onChange={handleEnableCometChange}
										/>
										<label className="font-semibold">Enable Comet</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-mediafusion"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableMediaFusion}
											onChange={handleEnableMediaFusionChange}
										/>
										<label className="font-semibold">Enable MediaFusion</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-peerflix"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enablePeerflix}
											onChange={handleEnablePeerflixChange}
										/>
										<label className="font-semibold">Enable Peerflix</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-torrentsdb"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableTorrentsDB}
											onChange={handleEnableTorrentsDBChange}
										/>
										<label className="font-semibold">Enable TorrentsDB</label>
									</div>

									<span className="text-xs text-gray-400">
										External sources provide additional cached torrents from
										Real-Debrid. Disable if you want to use only DMM&apos;s own
										search results.
									</span>
								</div>

								<div className="flex flex-col gap-2 rounded border-2 border-orange-500/30 p-3">
									<div className="text-sm font-semibold text-orange-200">
										Tor Proxy Options (bypasses rate limits)
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-torrentio-tor"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableTorrentioTor}
											onChange={handleEnableTorrentioTorChange}
										/>
										<label className="font-semibold">
											Enable Torrentio (Tor)
										</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-comet-tor"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableCometTor}
											onChange={handleEnableCometTorChange}
										/>
										<label className="font-semibold">Enable Comet (Tor)</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-mediafusion-tor"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableMediaFusionTor}
											onChange={handleEnableMediaFusionTorChange}
										/>
										<label className="font-semibold">
											Enable MediaFusion (Tor)
										</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-peerflix-tor"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enablePeerflixTor}
											onChange={handleEnablePeerflixTorChange}
										/>
										<label className="font-semibold">
											Enable Peerflix (Tor)
										</label>
									</div>

									<div className="flex items-center gap-2">
										<input
											id="dmm-enable-torrentsdb-tor"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={enableTorrentsDBTor}
											onChange={handleEnableTorrentsDBTorChange}
										/>
										<label className="font-semibold">
											Enable TorrentsDB (Tor)
										</label>
									</div>
								</div>
							</div>
						</div>

						<div className="rounded border-2 border-gray-500/30 p-4">
							<div className="mb-2 text-sm font-semibold text-gray-200">
								Torrent Management
							</div>

							<div className="flex flex-col gap-4">
								<div className="flex items-center gap-2">
									<input
										id="dmm-download-magnets"
										type="checkbox"
										className="h-5 w-5 rounded border-gray-600 bg-gray-800"
										checked={downloadMagnets}
										onChange={handleDownloadMagnetsChange}
									/>
									<label className="font-semibold">
										Download .magnet files instead of copy
									</label>
								</div>

								<div className="flex flex-col gap-1">
									<label className="font-semibold">Service check limit</label>
									<input
										id="dmm-availability-check-limit"
										type="number"
										min="0"
										className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
										placeholder="0 for no limit"
										value={availabilityCheckLimit}
										onChange={handleAvailabilityCheckLimitChange}
									/>
									<span className="text-xs text-gray-400">
										Maximum torrents to check when using &quot;Check All
										Services&quot; button (0 = no limit)
									</span>
								</div>

								<div className="flex flex-col gap-1">
									<div className="flex items-center gap-2">
										<input
											id="dmm-include-tracker-stats"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={includeTrackerStats}
											onChange={handleIncludeTrackerStatsChange}
										/>
										<label className="font-semibold">
											Include tracker stats in service check
										</label>
									</div>
									<span className="text-xs text-gray-400">
										When enabled, also fetches seeders, leechers, and download
										counts from trackers during service checks. This provides
										more detailed information but may slow down the check
										process.
									</span>
								</div>
							</div>
						</div>

						<div className="rounded border-2 border-gray-500/30 p-4">
							<div className="mb-2 text-sm font-semibold text-gray-200">Advanced</div>

							<div className="flex flex-col gap-3">
								<div className="flex flex-col gap-2 rounded border border-cyan-500/30 p-3">
									<div className="text-sm font-semibold text-cyan-200">
										Episode Calendar buttons
									</div>
									<div className="flex items-center gap-2">
										<input
											id="dmm-show-calendar-add-buttons-google"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={showCalendarAddButtonsGoogle}
											onChange={handleShowCalendarAddButtonsGoogleChange}
										/>
										<label className="font-semibold">
											Show Google Calendar button
										</label>
									</div>
									<div className="flex items-center gap-2">
										<input
											id="dmm-show-calendar-add-buttons-apple"
											type="checkbox"
											className="h-5 w-5 rounded border-gray-600 bg-gray-800"
											checked={showCalendarAddButtonsApple}
											onChange={handleShowCalendarAddButtonsAppleChange}
										/>
										<label className="font-semibold">
											Show Apple / .ics button
										</label>
									</div>
									<span className="text-xs text-gray-400">
										Toggle quick-add actions on the calendar page. Changes apply
										immediately; default is hidden.
									</span>
								</div>

								<div className="flex items-center gap-2">
									<input
										id="dmm-show-mass-report-buttons"
										type="checkbox"
										className="h-5 w-5 rounded border-gray-600 bg-gray-800"
										checked={showMassReportButtons}
										onChange={handleMassReportButtonsChange}
									/>
									<label className="font-semibold">
										Show mass report buttons
									</label>
								</div>
							</div>
						</div>
					</div>

					<div className="mt-6 flex flex-col gap-2">
						<button
							id="dmm-default"
							className={`haptic-sm w-full rounded border-2 ${
								isMagnetHandlerEnabled
									? 'border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50'
									: 'border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50'
							} px-4 py-2 text-sm transition-colors`}
							onClick={() => {
								if (
									typeof navigator !== 'undefined' &&
									'registerProtocolHandler' in navigator
								) {
									try {
										navigator.registerProtocolHandler(
											'magnet',
											`${(typeof location !== 'undefined' && location.origin) || ''}/library?addMagnet=%s`
										);
										if (typeof localStorage !== 'undefined')
											localStorage.setItem(
												'settings:magnetHandlerEnabled',
												'true'
											);
										setIsMagnetHandlerEnabled(true);
									} catch (error) {
										console.error('Error registering protocol handler:', error);
									}
								}
							}}
						>
							{isMagnetHandlerEnabled ? (
								<>
									<Check className="mr-1 inline-block h-4 w-4 text-green-400" />
									DMM is your default magnet handler
								</>
							) : (
								<>
									<Link2 className="mr-1 inline-block h-4 w-4 text-blue-400" />
									Make DMM your default magnet handler
								</>
							)}
						</button>

						<div className="flex flex-col gap-2 text-xs text-gray-400">
							<div>{getBrowserSettingsInfo().text}</div>
							<input
								type="text"
								readOnly
								className="w-full rounded bg-gray-800 px-2 py-1.5 text-gray-200"
								value={getBrowserSettingsInfo().url}
								onClick={(e) => (e.target as HTMLInputElement).select()}
							/>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
