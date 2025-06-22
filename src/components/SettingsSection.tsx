import { useEffect, useState } from 'react';
import {
	defaultDownloadMagnets,
	defaultEpisodeSize,
	defaultMagnetHandlerEnabled,
	defaultMagnetInstructionsHidden,
	defaultMovieSize,
	defaultPlayer,
	defaultTorrentsFilter,
} from '../utils/settings';

export const SettingsSection = () => {
	const [isExpanded, setIsExpanded] = useState(false);
	const [isMagnetHandlerEnabled, setIsMagnetHandlerEnabled] = useState(
		defaultMagnetHandlerEnabled
	);
	const [isInstructionsHidden, setIsInstructionsHidden] = useState(
		defaultMagnetInstructionsHidden
	);

	const storedPlayer = window.localStorage.getItem('settings:player') || defaultPlayer;
	const movieMaxSize = window.localStorage.getItem('settings:movieMaxSize') || defaultMovieSize;
	const episodeMaxSize =
		window.localStorage.getItem('settings:episodeMaxSize') || defaultEpisodeSize;
	const onlyTrustedTorrents =
		window.localStorage.getItem('settings:onlyTrustedTorrents') === 'true';
	const defaultTorrentsFilterValue =
		window.localStorage.getItem('settings:defaultTorrentsFilter') || defaultTorrentsFilter;
	const downloadMagnets =
		window.localStorage.getItem('settings:downloadMagnets') === 'true' ||
		defaultDownloadMagnets;
	const showMassReportButtons =
		window.localStorage.getItem('settings:showMassReportButtons') === 'true';

	useEffect(() => {
		// Check if protocol handler is registered
		const checkProtocolHandler = () => {
			const isEnabled =
				window.localStorage.getItem('settings:magnetHandlerEnabled') === 'true';
			setIsMagnetHandlerEnabled(isEnabled);
		};
		checkProtocolHandler();

		// Check if instructions are hidden
		const checkInstructionsHidden = () => {
			const isHidden =
				window.localStorage.getItem('settings:magnetInstructionsHidden') === 'true';
			setIsInstructionsHidden(isHidden);
		};
		checkInstructionsHidden();
	}, []);

	const handlePlayerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		window.localStorage.setItem('settings:player', e.target.value);
	};

	const handleMovieSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		window.localStorage.setItem('settings:movieMaxSize', e.target.value);
	};

	const handleEpisodeSizeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
		window.localStorage.setItem('settings:episodeMaxSize', e.target.value);
	};

	const handleTorrentsFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		window.localStorage.setItem('settings:defaultTorrentsFilter', e.target.value);
	};

	const handleTrustedTorrentsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		window.localStorage.setItem('settings:onlyTrustedTorrents', String(e.target.checked));
	};

	const handleDownloadMagnetsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		window.localStorage.setItem('settings:downloadMagnets', String(e.target.checked));
	};

	const handleMassReportButtonsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		window.localStorage.setItem('settings:showMassReportButtons', String(e.target.checked));
	};

	const handleHideInstructions = () => {
		window.localStorage.setItem('settings:magnetInstructionsHidden', 'true');
		setIsInstructionsHidden(true);
	};

	const handleShowInstructions = () => {
		window.localStorage.setItem('settings:magnetInstructionsHidden', 'false');
		setIsInstructionsHidden(false);
	};

	const getBrowserSettingsInfo = () => {
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
			<button
				onClick={() => setIsExpanded(!isExpanded)}
				className="haptic-sm flex w-full items-center justify-between rounded border-2 border-gray-500 bg-gray-800/30 px-4 py-2 text-sm font-medium text-gray-100 transition-colors hover:bg-gray-700/50"
			>
				<span>⚙️ Settings</span>
				<span>{isExpanded ? '▼' : '▶'}</span>
			</button>

			{isExpanded && (
				<div className="mt-4 text-sm text-gray-200">
					<div className="flex flex-col gap-4">
						<div className="rounded border-2 border-yellow-500/30 p-4">
							<div className="mb-4 text-center text-sm font-medium text-yellow-200">
								⚠️ Experiencing lag or buffering? Try smaller files
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
										defaultValue={movieMaxSize}
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
										defaultValue={episodeMaxSize}
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
								</div>
							</div>
						</div>

						<div className="flex flex-col gap-1">
							<label className="font-semibold">Video player</label>
							<select
								id="dmm-player"
								className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
								defaultValue={storedPlayer}
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
									<option value="android/com.brouken.player">JustPlayer</option>
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
							</select>
						</div>

						<div className="flex flex-col gap-1">
							<label className="font-semibold">Default torrents filter</label>
							<input
								id="dmm-default-torrents-filter"
								type="text"
								className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
								placeholder="filter results, supports regex"
								defaultValue={defaultTorrentsFilterValue}
								onChange={handleTorrentsFilterChange}
							/>
						</div>

						<div className="flex items-center gap-2">
							<input
								id="dmm-only-trusted-torrents"
								type="checkbox"
								className="h-5 w-5 rounded border-gray-600 bg-gray-800"
								defaultChecked={onlyTrustedTorrents}
								onChange={handleTrustedTorrentsChange}
							/>
							<label className="font-semibold">Only trusted torrents</label>
						</div>

						<div className="flex items-center gap-2">
							<input
								id="dmm-download-magnets"
								type="checkbox"
								className="h-5 w-5 rounded border-gray-600 bg-gray-800"
								defaultChecked={downloadMagnets}
								onChange={handleDownloadMagnetsChange}
							/>
							<label className="font-semibold">
								Download .magnet files instead of copy
							</label>
						</div>

						<div className="flex items-center gap-2">
							<input
								id="dmm-show-mass-report-buttons"
								type="checkbox"
								className="h-5 w-5 rounded border-gray-600 bg-gray-800"
								defaultChecked={showMassReportButtons}
								onChange={handleMassReportButtonsChange}
							/>
							<label className="font-semibold">Show mass report buttons</label>
						</div>
					</div>
				</div>
			)}

			<div className="mt-4 flex flex-col gap-2">
				<button
					id="dmm-default"
					className={`haptic-sm w-full rounded border-2 ${
						isMagnetHandlerEnabled
							? 'border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50'
							: 'border-blue-500 bg-blue-900/30 text-blue-100 hover:bg-blue-800/50'
					} px-4 py-2 text-sm transition-colors`}
					onClick={() => {
						if ('registerProtocolHandler' in navigator) {
							try {
								navigator.registerProtocolHandler(
									'magnet',
									`${window.location.origin}/library?addMagnet=%s`
								);
								window.localStorage.setItem(
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
					{isMagnetHandlerEnabled
						? '✅ DMM is your default magnet handler'
						: '🧲 Make DMM your default magnet handler'}
				</button>

				{!isInstructionsHidden ? (
					<div className="flex flex-col gap-1 text-xs text-gray-400">
						<div className="flex items-center justify-between">
							<div>{getBrowserSettingsInfo().text}</div>
							<button
								onClick={handleHideInstructions}
								className="ml-2 text-gray-500 hover:text-gray-300"
							>
								✕
							</button>
						</div>
						<input
							type="text"
							readOnly
							className="w-full rounded bg-gray-800 px-2 py-1.5 text-gray-200"
							value={getBrowserSettingsInfo().url}
							onClick={(e) => (e.target as HTMLInputElement).select()}
						/>
					</div>
				) : (
					<button
						onClick={handleShowInstructions}
						className="text-xs text-gray-500 hover:text-gray-300"
					>
						Show browser settings
					</button>
				)}
			</div>
		</div>
	);
};
