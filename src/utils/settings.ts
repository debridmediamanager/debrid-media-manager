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
            <div class="text-sm text-gray-200">
                <div class="flex flex-col gap-4">
                    <div class="flex flex-col gap-1">
                        <label class="font-semibold">Video player</label>
                        <select id="dmm-player" class="bg-gray-800 text-gray-200 rounded px-2 py-2.5 w-full">
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
                    <option ${isPlayer('ios2/open-vidhub')}>VidHub</option>
                    <option ${isPlayer('ios/infuse')}>Infuse</option>
                    <option ${isPlayer('ios/vlc')}>VLC</option>
                    <option ${isPlayer('ios/outplayer')}>Outplayer</option>
                </optgroup>
                <optgroup label="MacOS">
                    <option ${isPlayer('mac4/open-vidhub')}>VidHub</option>
                    <option ${isPlayer('mac/infuse')}>Infuse</option>
                    <option ${isPlayer('mac2/iina')}>IINA</option>
                    <option ${isPlayer('mac2/omniplayer')}>OmniPlayer</option>
                    <option ${isPlayer('mac2/figplayer')}>Fig Player</option>
                    <option ${isPlayer('mac3/nplayer-mac')}>nPlayer</option>
                </optgroup>
                        </select>
                    </div>
                    
                    <div class="flex flex-col gap-1">
                        <label class="font-semibold">Biggest movie size</label>
                        <select id="dmm-movie-max-size" class="bg-gray-800 text-gray-200 rounded px-2 py-2.5 w-full">
                            <option ${isMovieSize('1')}>1 GB</option>
                            <option ${isMovieSize('3')}>3 GB</option>
                            <option ${isMovieSize('5')}>5 GB</option>
                            <option ${isMovieSize('15')}>15 GB</option>
                            <option ${isMovieSize('30')}>30 GB</option>
                            <option ${isMovieSize('60')}>60 GB</option>
                            <option ${isMovieSize('0')}>Biggest available</option>
                        </select>
                    </div>

                    <div class="flex flex-col gap-1">
                        <label class="font-semibold">Biggest episode size</label>
                        <select id="dmm-episode-max-size" class="bg-gray-800 text-gray-200 rounded px-2 py-2.5 w-full">
                            <option ${isEpisodeSize('0.1')}>100 MB</option>
                            <option ${isEpisodeSize('0.3')}>300 MB</option>
                            <option ${isEpisodeSize('0.5')}>500 MB</option>
                            <option ${isEpisodeSize('1')}>1 GB</option>
                            <option ${isEpisodeSize('3')}>3 GB</option>
                            <option ${isEpisodeSize('5')}>5 GB</option>
                            <option ${isEpisodeSize('0')}>Biggest available</option>
                        </select>
                    </div>

                    <div class="flex flex-col gap-1">
                        <label class="font-semibold">Default torrents filter</label>
                        <input id="dmm-default-torrents-filter" type="text" 
                            class="bg-gray-800 text-gray-200 rounded px-2 py-2.5 w-full"
                            placeholder="filter results, supports regex" 
                            value="${defaultTorrentsFilter}">
                    </div>

                    <div class="flex items-center gap-2">
                        <input id="dmm-only-trusted-torrents" type="checkbox" 
                            class="w-5 h-5 bg-gray-800 border-gray-600 rounded" 
                            ${onlyTrustedTorrents ? 'checked' : ''}>
                        <label class="font-semibold">Only trusted torrents</label>
                    </div>
                </div>

                <div class="text-center mt-6">
                    <button id="dmm-default" 
                        class="border-2 border-green-500 bg-green-900/30 text-green-100 hover:bg-green-800/50 text-sm rounded px-4 py-2 transition-colors haptic-sm"
                        onclick="registerMagnetHandler()">
                        🧲 Make DMM your torrent client
                    </button>
                </div>
            </div>
        `,
		showCancelButton: true,
		confirmButtonText: 'Save',
		customClass: {
			htmlContainer: '!mx-1',
			popup: '!bg-gray-900 !text-gray-100 !w-[95%] !max-w-[600px]',
			confirmButton: '!bg-blue-600 !px-6 haptic',
			cancelButton: '!bg-gray-600 haptic',
		},
		inputAttributes: {
			autocomplete: 'off',
			autocorrect: 'off',
			autocapitalize: 'off',
			spellcheck: 'false',
		},
		focusConfirm: true,
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
			String(formValues.onlyTrustedTorrents)
		);
		window.localStorage.setItem(
			'settings:defaultTorrentsFilter',
			formValues.defaultTorrentsFilter ?? defaultTorrentsFilter
		);
	}
};
