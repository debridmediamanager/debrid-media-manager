import { cachedSubtitleLanguages, fetchSubtitleLanguages } from '@/utils/subtitleLanguageCache';
import type { SubtitleLanguageMap } from '@/utils/subtitleLanguages';
import { useEffect, useMemo, useState } from 'react';

/** How long the result list must stay unchanged before it is asked about: sources land one by one. */
export const SETTLE_MS = 800;

/**
 * The subtitle languages of the releases on a search page, once `enabled`. Asked
 * after the results render and have settled, never as part of the search itself,
 * and only for hashes the cache does not already answer. A hash absent from
 * `languages` is unknown.
 */
export function useSubtitleLanguages(hashes: string[], enabled: boolean) {
	const [languages, setLanguages] = useState<Map<string, string[]>>(() => new Map());
	const [checking, setChecking] = useState(false);

	// One key per set of hashes, so a re-render with the same results asks nothing.
	const key = useMemo(
		() => [...new Set(hashes.map((h) => h.toLowerCase()))].sort().join(','),
		[hashes]
	);

	useEffect(() => {
		if (!enabled || !key) return;
		const wanted = key.split(',');
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			const { known, missing } = cachedSubtitleLanguages(wanted);
			if (known.size) {
				setLanguages((prev) => {
					const next = new Map(prev);
					known.forEach((langs, hash) => next.set(hash, langs));
					return next;
				});
			}
			if (!missing.length) return;
			setChecking(true);
			await fetchSubtitleLanguages(
				missing,
				(answers) => {
					if (controller.signal.aborted) return;
					setLanguages((prev) => {
						const next = new Map(prev);
						answers.forEach((langs, hash) => {
							if (langs) next.set(hash, langs);
						});
						return next;
					});
				},
				{ signal: controller.signal }
			);
			if (!controller.signal.aborted) setChecking(false);
		}, SETTLE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
			setChecking(false);
		};
	}, [key, enabled]);

	return { languages: languages as SubtitleLanguageMap, checking };
}
