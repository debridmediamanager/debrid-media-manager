import { handleAddMultipleHashesInAd, handleAddMultipleHashesInRd } from '@/utils/addMagnet';
import { extractHashes } from '@/utils/extractHashes';
import { getHashOfTorrent } from '@/utils/torrentFile';
import Swal from 'sweetalert2';

export async function handleAddTorrent(
	debridService: string,
	rdKey: string | null,
	adKey: string | null,
	triggerFetchLatestRDTorrents: (limit?: number) => Promise<void>,
	triggerFetchLatestADTorrents: () => Promise<void>
) {
	const result = await Swal.fire({
		title: `Add to your ${debridService.toUpperCase()} library`,
		html: `
      <div class="bg-gray-900 p-4 rounded-lg">
        <textarea
          id="magnetInput"
          class="w-full h-32 bg-gray-800 text-gray-100 border border-gray-700 rounded p-2 placeholder-gray-500 focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500"
          placeholder="Paste your Magnet link(s) here"
        ></textarea>
        <div class="mt-4">
          <label class="block text-sm text-gray-300 mb-2">Or upload .torrent file(s)</label>
          <input
            type="file"
            id="torrentFile"
            accept=".torrent"
            multiple
            class="block w-full text-sm text-gray-300
              file:mr-4 file:py-2 file:px-4
              file:rounded file:border-0
              file:text-sm file:font-medium
              file:bg-cyan-900 file:text-cyan-100
              hover:file:bg-cyan-800
              cursor-pointer
              border border-gray-700 rounded
            "
          />
        </div>
      </div>
    `,
		background: '#111827',
		color: '#f3f4f6',
		confirmButtonColor: '#0891b2',
		cancelButtonColor: '#374151',
		showCancelButton: true,
		customClass: {
			popup: 'bg-gray-900',
			htmlContainer: 'text-gray-100',
		},
		preConfirm: async () => {
			const magnetInput = (document.getElementById('magnetInput') as HTMLTextAreaElement)
				?.value;
			const fileInput = document.getElementById('torrentFile') as HTMLInputElement;
			const files = fileInput?.files;

			let hashes: string[] = [];

			// Process magnet links
			if (magnetInput) {
				hashes.push(...extractHashes(magnetInput));
			}

			// Process torrent files
			if (files && files.length > 0) {
				try {
					const fileHashes = await Promise.all(
						Array.from(files).map((file) => getHashOfTorrent(file))
					);
					hashes.push(...fileHashes.filter((hash): hash is string => hash !== undefined));
				} catch (error) {
					Swal.showValidationMessage(`Failed to process torrent file: ${error}`);
					return false;
				}
			}

			if (hashes.length === 0) {
				Swal.showValidationMessage('Please provide either magnet links or torrent files');
				return false;
			}

			return hashes;
		},
	});

	if (result.isDismissed || !result.value) return;
	const hashes = result.value as string[];

	if (rdKey && hashes && debridService === 'rd') {
		await handleAddMultipleHashesInRd(
			rdKey,
			hashes,
			async () => await triggerFetchLatestRDTorrents(Math.ceil(hashes.length * 1.1))
		);
	}
	if (adKey && hashes && debridService === 'ad') {
		await handleAddMultipleHashesInAd(
			adKey,
			hashes,
			async () => await triggerFetchLatestADTorrents()
		);
	}
}
