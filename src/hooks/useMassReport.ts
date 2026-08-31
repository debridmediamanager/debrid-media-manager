import { SearchResult } from '@/services/mediasearch';
import { generateTokenAndHash } from '@/utils/token';
import axios from 'axios';
import { useCallback } from 'react';
import toast from 'react-hot-toast';

// `/api/report/mass` refuses more than this per request, so one rate-limited
// call cannot fan out into an unbounded number of DB writes. A filtered result
// set routinely runs longer than 100 rows, so batch rather than lose the tail.
// The endpoint's own IP limit (5 per 10s) still caps a single click at ~500 rows;
// past that the later batches 429 and the catch below reports the failure.
const MAX_REPORTS_PER_REQUEST = 100;

export function useMassReport(
	rdKey: string | null,
	adKey: string | null,
	torboxKey: string | null,
	imdbId: string
) {
	const handleMassReport = useCallback(
		async (type: 'porn' | 'wrong_imdb' | 'wrong_season', filteredResults: SearchResult[]) => {
			if (!rdKey && !adKey && !torboxKey) {
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
				const userId = rdKey || adKey || torboxKey || '';

				// Prepare reports data
				const reports = filteredResults.map((result) => ({
					hash: result.hash,
					imdbId: imdbId,
				}));

				// The endpoint now demands a server-minted token; a failed mint
				// throws into the catch below, so the user is told rather than the
				// click quietly doing nothing.
				const [dmmProblemKey, solution] = await generateTokenAndHash();

				// Send mass report, in batches the endpoint will accept
				let reported = 0;
				let failed = 0;
				let accepted = true;

				for (let i = 0; i < reports.length; i += MAX_REPORTS_PER_REQUEST) {
					const response = await axios.post('/api/report/mass', {
						reports: reports.slice(i, i + MAX_REPORTS_PER_REQUEST),
						userId,
						type,
						dmmProblemKey,
						solution,
					});

					if (!response.data.success) {
						accepted = false;
						break;
					}

					reported += response.data.reported ?? 0;
					failed += response.data.failed ?? 0;
				}

				if (accepted) {
					toast.success(`Reported ${reported} torrents.`, {
						id: toastId,
					});
					if (failed > 0) {
						toast.error(`Failed to report ${failed} torrents.`);
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
		[rdKey, adKey, torboxKey, imdbId]
	);

	return { handleMassReport };
}
