import Swal from 'sweetalert2';

export const defaultPlayer = 'web/rd';
export const defaultMovieSize = '0';
export const defaultEpisodeSize = '0';
export const defaultTorrentsFilter = '';

export const showSettings = async () => {
	const storedPlayer = window.localStorage.getItem('settings:player') || defaultPlayer;
	const isPlayer = (player: string) =>
		storedPlayer === player ? `value="${player}" selected` : `value="${player}"`;

	const movieMaxSize = window.localStorage.getItem('settings:movieMaxSize') || defaultMovieSize;
	const isMovieSize = (size: string) =>
		movieMaxSize === size ? `value="${size}" selected` : `value="${size}"`;

	const episodeMaxSize =
		window.localStorage.getItem('settings:episodeMaxSize') || defaultEpisodeSize;
	const isEpisodeSize = (size: string) =>
		episodeMaxSize === size ? `value="${size}" selected` : `value="${size}"`;

	const onlyTrustedTorrents =
		window.localStorage.getItem('settings:onlyTrustedTorrents') === 'true';

	const defaultTorrentsFilter =
		window.localStorage.getItem('settings:defaultTorrentsFilter') || '';

	const { value: formValues } = await Swal.fire({
		title: '⚙️ Settings',
		html: `
				<label for="dmm-player">Video player:</label>
				<select id="dmm-player" class="swal2-input">
					<optgroup label="Web">
						<option ${isPlayer('web/rd')}>Real-Debrid Stream</option>
					</optgroup>
					<optgroup label="Android">
						<option ${isPlayer('android/chooser')}>App chooser</option>
						<option ${isPlayer('android/org.videolan.vlc')}>VLC</option>
						<option ${isPlayer('android/com.mxtech.videoplayer.ad')}>MX Player</option>
						<option ${isPlayer('android/com.mxtech.videoplayer.pro')}>MX Player Pro</option>
						<option ${isPlayer('android/com.brouken.player')}>JustPlayer</option>
					</optgroup>
					<optgroup label="iOS">
						<option ${isPlayer('ios/infuse')}>Infuse</option>
						<option ${isPlayer('ios/vlc')}>VLC</option>
						<option ${isPlayer('ios/outplayer')}>Outplayer</option>
					</optgroup>
					<optgroup label="MacOS">
						<option ${isPlayer('mac/infuse')}>Infuse</option>
						<option ${isPlayer('mac2/iina')}>IINA</option>
						<option ${isPlayer('mac2/omniplayer')}>OmniPlayer</option>
						<option ${isPlayer('mac2/figplayer')}>Fig Player</option>
						<option ${isPlayer('mac3/nplayer-mac')}>nPlayer</option>
					</optgroup>
				</select>

				<div name="divider" class="py-2"></div>

				<label for="dmm-movie-max-size">Biggest movie size to show:</label>
				<select id="dmm-movie-max-size" class="swal2-input">
					<option ${isMovieSize('1')}>1 GB</option>
					<option ${isMovieSize('3')}>3 GB</option>
					<option ${isMovieSize('5')}>5 GB</option>
					<option ${isMovieSize('15')}>15 GB</option>
					<option ${isMovieSize('30')}>30 GB</option>
					<option ${isMovieSize('60')}>60 GB</option>
					<option ${isMovieSize('0')}>Biggest available</option>
				</select>

				<div name="divider" class="py-2"></div>

				<label for="dmm-episode-max-size">Biggest episode size to show:</label>
				<select id="dmm-episode-max-size" class="swal2-input">
					<option ${isEpisodeSize('0.1')}>100 MB</option>
					<option ${isEpisodeSize('0.3')}>300 MB</option>
					<option ${isEpisodeSize('0.5')}>500 MB</option>
					<option ${isEpisodeSize('1')}>1 GB</option>
					<option ${isEpisodeSize('3')}>3 GB</option>
					<option ${isEpisodeSize('5')}>5 GB</option>
					<option ${isEpisodeSize('0')}>Biggest available</option>
				</select>

				<div name="divider" class="py-2"></div>

				<label for="dmm-default-torrents-filter">Default torrents filter:</label>
				<input id="dmm-default-torrents-filter" type="text" class="ml-4 outline-none text-md w-64" placeholder="filter results, supports regex" value="${defaultTorrentsFilter}">

				<div name="divider" class="py-4"></div>

				<label for="dmm-only-trusted-torrents">Only show trusted torrents:</label>
				<input id="dmm-only-trusted-torrents" type="checkbox" class="w-4 h-4 ml-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600" ${onlyTrustedTorrents ? 'checked' : ''}>

				<div name="divider" class="py-4"></div>

				<button id="dmm-default" class="bg-green-500 hover:bg-green-700 text-white font-bold py-1 px-2 rounded" onclick="registerMagnetHandler()">
					🧲 Make DMM your torrent client
				</button>`,
		focusConfirm: false,
		preConfirm: () => {
			return {
				player: (document.getElementById('dmm-player') as HTMLSelectElement).value,
				movieMaxSize: (document.getElementById('dmm-movie-max-size') as HTMLSelectElement)
					.value,
				episodeMaxSize: (
					document.getElementById('dmm-episode-max-size') as HTMLSelectElement
				).value,
				onlyTrustedTorrents: (
					document.getElementById('dmm-only-trusted-torrents') as HTMLInputElement
				).checked,
				defaultTorrentsFilter: (
					document.getElementById('dmm-default-torrents-filter') as HTMLInputElement
				).value,
			};
		},
	});

	if (formValues) {
		window.localStorage.setItem('settings:player', formValues.player ?? defaultPlayer);
		window.localStorage.setItem(
			'settings:movieMaxSize',
			formValues.movieMaxSize ?? defaultMovieSize
		);
		window.localStorage.setItem(
			'settings:episodeMaxSize',
			formValues.episodeMaxSize ?? defaultEpisodeSize
		);
		window.localStorage.setItem(
			'settings:onlyTrustedTorrents',
			formValues.onlyTrustedTorrents ?? false
		);
		window.localStorage.setItem(
			'settings:defaultTorrentsFilter',
			formValues.defaultTorrentsFilter ?? defaultTorrentsFilter
		);
	}
};
