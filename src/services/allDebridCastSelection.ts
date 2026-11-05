import { getMagnetFiles, getMagnetStatusAd } from '@/services/allDebrid';
import { selectSortedVideos } from '@/utils/allDebridCastClientPipeline';

/** Upload stays in the browser; reads attest the resulting account-owned selection. */
export async function getVerifiedAllDebridCastFiles(
	apiKey: string,
	magnetId: number,
	hash: string
) {
	if (!Number.isSafeInteger(magnetId) || magnetId <= 0 || !/^[a-f0-9]{40}$/i.test(hash)) {
		throw new Error('Invalid magnet or hash');
	}
	const status = await getMagnetStatusAd(apiKey, magnetId);
	if (
		status.id !== magnetId ||
		status.statusCode !== 4 ||
		status.hash?.toLowerCase() !== hash.toLowerCase()
	) {
		throw new Error('Magnet does not match the requested ready torrent');
	}
	const result = await getMagnetFiles(apiKey, [magnetId]);
	const magnet = result.magnets.find((item) => String(item.id) === String(magnetId));
	if (!magnet || magnet.error) throw new Error('Magnet files unavailable');
	return selectSortedVideos(magnet.files || []);
}
