import { SearchResult } from '@/services/mediasearch';
import axios from 'axios';
import { useCallback } from 'react';
import toast from 'react-hot-toast';

export function useMassReport(
	rdKey: string | null,
	adKey: string | null,
	torboxKey: string | null,
	imdbId: string,
	torrinApiKey?: string | null
) {
	const handleMassReport = useCallback(
		async (type: 'porn' | 'wrong_imdb' | 'wrong_season', filteredResults: SearchResult[]) => {
			if (!rdKey && !adKey && !torboxKey && !torrinApiKey) {
				toast.error('Sign in to a debrid service before reporting.');
				return;
			}

			if (filteredResults.length === 0) {
				toast.error('Select torrents before reporting.');
				return;
			}

			// Confirm with user
			const typeLabels = {
				porn: 'pornographic content',
				wrong_imdb: 'wrong IMDB ID',
				wrong_season: 'wrong season',
			};
			const confirmMessage = `Report ${filteredResults.length} torrents as ${typeLabels[type]}?`;
			if (!confirm(confirmMessage)) return;

			const toastId = toast.loading(`Reporting ${filteredResults.length} torrents...`);

			try {
				// Use the debrid key as userId
				const userId = rdKey || adKey || torboxKey || torrinApiKey || '';

				// Prepare reports data
				const reports = filteredResults.map((result) => ({
					hash: result.hash,
					imdbId: imdbId,
				}));

				// Send mass report
				const response = await axios.post('/api/report/mass', {
					reports,
					userId,
					type,
				});

				if (response.data.success) {
					toast.success(`Reported ${response.data.reported} torrents.`, {
						id: toastId,
					});
					if (response.data.failed > 0) {
						toast.error(`Failed to report ${response.data.failed} torrents.`);
					}
				} else {
					toast.error('Failed to submit reports.', { id: toastId });
				}

				// Reload the page after a short delay to refresh the results
				setTimeout(() => {
					window.location.reload();
				}, 1500);
			} catch (error) {
				console.error('Mass report error:', error);
				toast.error('Failed to submit reports.', { id: toastId });

				// Reload the page after a short delay even on error
				setTimeout(() => {
					window.location.reload();
				}, 1500);
			}
		},
		[rdKey, adKey, torboxKey, imdbId, torrinApiKey]
	);

	return { handleMassReport };
}
