import toast from 'react-hot-toast';
import { downloadMagnetFile } from './downloadMagnet';
import { magnetToastOptions } from './toastOptions';

export const handleCopyOrDownloadMagnet = (hash: string, shouldDownloadMagnets?: boolean) => {
	if (shouldDownloadMagnets) {
		downloadMagnetFile(hash);
		toast.success('Magnet file downloaded', magnetToastOptions);
	} else {
		const magnetLink = `magnet:?xt=urn:btih:${hash}`;
		navigator.clipboard.writeText(magnetLink);
		toast.success('Magnet link copied to clipboard', magnetToastOptions);
	}
};
