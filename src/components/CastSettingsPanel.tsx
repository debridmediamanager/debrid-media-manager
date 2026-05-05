import { Settings } from 'lucide-react';
import { useState } from 'react';
import { updateAllDebridSizeLimits } from '../utils/allDebridCastApiClient';
import {
	getLocalStorageBoolean,
	getLocalStorageItemOrDefault,
	getLocalStorageString,
} from '../utils/browserStorage';
import { defaultEpisodeSize, defaultMovieSize, defaultOtherStreamsLimit } from '../utils/settings';
import { updateTorBoxSizeLimits } from '../utils/torboxCastApiClient';

interface CastSettingsPanelProps {
	service: 'rd' | 'ad' | 'tb';
	accentColor: 'green' | 'yellow' | 'purple';
}

export const CastSettingsPanel = ({ service, accentColor }: CastSettingsPanelProps) => {
	const [movieMaxSize, setMovieMaxSize] = useState(() =>
		getLocalStorageItemOrDefault('settings:movieMaxSize', defaultMovieSize)
	);
	const [episodeMaxSize, setEpisodeMaxSize] = useState(() =>
		getLocalStorageItemOrDefault('settings:episodeMaxSize', defaultEpisodeSize)
	);
	const [otherStreamsLimit, setOtherStreamsLimit] = useState(() =>
		getLocalStorageItemOrDefault('settings:otherStreamsLimit', defaultOtherStreamsLimit)
	);
	const [hideCastOption, setHideCastOption] = useState(() =>
		getLocalStorageBoolean('settings:hideCastOption', false)
	);

	const colorClasses = {
		green: {
			border: 'border-green-500/30',
			title: 'text-green-200',
			icon: 'text-green-400',
		},
		yellow: {
			border: 'border-yellow-500/30',
			title: 'text-yellow-200',
			icon: 'text-yellow-400',
		},
		purple: {
			border: 'border-purple-500/30',
			title: 'text-purple-200',
			icon: 'text-purple-400',
		},
	};

	const colors = colorClasses[accentColor];

	const updateCastSizeLimits = async (
		movieSize?: string,
		episodeSize?: string,
		streamsLimit?: string,
		hideCast?: boolean
	) => {
		if (typeof localStorage === 'undefined') return;

		try {
			if (service === 'rd') {
				const castToken = localStorage.getItem('rd:castToken');
				const clientIdRaw = localStorage.getItem('rd:clientId');
				const clientSecretRaw = localStorage.getItem('rd:clientSecret');
				const refreshTokenRaw = localStorage.getItem('rd:refreshToken');

				if (castToken && clientIdRaw && clientSecretRaw) {
					const clientId = JSON.parse(clientIdRaw);
					const clientSecret = JSON.parse(clientSecretRaw);
					const refreshToken = refreshTokenRaw ? JSON.parse(refreshTokenRaw) : null;

					await fetch('/api/stremio/cast/updateSizeLimits', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							clientId,
							clientSecret,
							refreshToken,
							movieMaxSize: movieSize !== undefined ? Number(movieSize) : undefined,
							episodeMaxSize:
								episodeSize !== undefined ? Number(episodeSize) : undefined,
							otherStreamsLimit:
								streamsLimit !== undefined ? Number(streamsLimit) : undefined,
							hideCastOption: hideCast,
						}),
					});
				}
			} else if (service === 'tb') {
				const tbApiKey = getLocalStorageString('tb:apiKey');
				if (tbApiKey) {
					await updateTorBoxSizeLimits(
						tbApiKey,
						movieSize !== undefined ? Number(movieSize) : undefined,
						episodeSize !== undefined ? Number(episodeSize) : undefined,
						streamsLimit !== undefined ? Number(streamsLimit) : undefined,
						hideCast
					);
				}
			} else if (service === 'ad') {
				const adApiKey = getLocalStorageString('ad:apiKey');
				if (adApiKey) {
					await updateAllDebridSizeLimits(
						adApiKey,
						movieSize !== undefined ? Number(movieSize) : undefined,
						episodeSize !== undefined ? Number(episodeSize) : undefined,
						streamsLimit !== undefined ? Number(streamsLimit) : undefined,
						hideCast
					);
				}
			}
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

	const handleHideCastOptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const checked = e.target.checked;
		setHideCastOption(checked);
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem('settings:hideCastOption', String(checked));
			updateCastSizeLimits(undefined, undefined, undefined, checked);
		}
	};

	return (
		<div
			className={`mt-6 w-full max-w-md rounded-lg border ${colors.border} bg-gray-800/50 p-4`}
		>
			<div className="mb-4 flex items-center gap-2">
				<Settings className={`h-5 w-5 ${colors.icon}`} />
				<h2 className={`text-lg font-semibold ${colors.title}`}>Cast Settings</h2>
			</div>

			<div className="flex flex-col gap-4 text-sm text-gray-200">
				<div className="flex flex-col gap-1">
					<label className="font-semibold">Biggest movie size</label>
					<select
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
				</div>

				<div className="flex flex-col gap-1">
					<label className="font-semibold">Other streams limit</label>
					<select
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
						Limits streams from available files, torrents, and other users&apos; casts
					</p>
				</div>

				<div className="flex items-center gap-2">
					<input
						type="checkbox"
						className="h-5 w-5 rounded border-gray-600 bg-gray-800"
						checked={hideCastOption}
						onChange={handleHideCastOptionChange}
					/>
					<label className="font-semibold">
						Hide &quot;Cast a file inside a torrent&quot; option
					</label>
				</div>
				<p className="-mt-2 text-xs text-gray-400">
					When enabled, the cast option will not appear in Stremio streams
				</p>
			</div>
		</div>
	);
};
