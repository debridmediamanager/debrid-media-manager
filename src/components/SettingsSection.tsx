import {
	defaultEpisodeSize,
	defaultMovieSize,
	defaultPlayer,
	defaultTorrentsFilter,
} from '@/utils/settings';
import { useState } from 'react';

export const SettingsSection = () => {
	const [isExpanded, setIsExpanded] = useState(false);

	const storedPlayer = window.localStorage.getItem('settings:player') || defaultPlayer;
	const movieMaxSize = window.localStorage.getItem('settings:movieMaxSize') || defaultMovieSize;
	const episodeMaxSize =
		window.localStorage.getItem('settings:episodeMaxSize') || defaultEpisodeSize;
	const onlyTrustedTorrents =
		window.localStorage.getItem('settings:onlyTrustedTorrents') === 'true';
	const defaultTorrentsFilterValue =
		window.localStorage.getItem('settings:defaultTorrentsFilter') || defaultTorrentsFilter;

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
							<label className="font-semibold">Biggest movie size</label>
							<select
								id="dmm-movie-max-size"
								className="w-full rounded bg-gray-800 px-2 py-2.5 text-gray-200"
								defaultValue={movieMaxSize}
								onChange={handleMovieSizeChange}
							>
								<option value="1">1 GB</option>
								<option value="3">3 GB</option>
								<option value="5">5 GB</option>
								<option value="15">15 GB</option>
								<option value="30">30 GB</option>
								<option value="60">60 GB</option>
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
								<option value="0.1">100 MB</option>
								<option value="0.3">300 MB</option>
								<option value="0.5">500 MB</option>
								<option value="1">1 GB</option>
								<option value="3">3 GB</option>
								<option value="5">5 GB</option>
								<option value="0">Biggest available</option>
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

						<div className="text-center">
							<button
								id="dmm-default"
								className="haptic-sm rounded border-2 border-green-500 bg-green-900/30 px-4 py-2 text-sm text-green-100 transition-colors hover:bg-green-800/50"
								onClick={() => {
									if ('registerProtocolHandler' in navigator) {
										try {
											navigator.registerProtocolHandler(
												'magnet',
												`${window.location.origin}/library?addMagnet=%s`
											);
										} catch (error) {
											console.error(
												'Error registering protocol handler:',
												error
											);
										}
									}
								}}
							>
								🧲 Make DMM your torrent client
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
};
