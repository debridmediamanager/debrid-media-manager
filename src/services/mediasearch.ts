export type SearchApiResponse = {
	results?: SearchResult[];
	errorMessage?: string;
};

export type SearchResult = {
	title: string;
	fileSize: number;
	hash: string;
	rdAvailable: boolean;
	adAvailable: boolean;
	noVideos: boolean;
};

export type ScrapeSearchResult = Pick<SearchResult, 'title' | 'fileSize' | 'hash'>;

export const flattenAndRemoveDuplicates = (arr: ScrapeSearchResult[][]): ScrapeSearchResult[] => {
	const flattened = arr.reduce((acc, val) => acc.concat(val), []);
	const unique = new Map<string, ScrapeSearchResult>();
	flattened.forEach((item) => {
		if (!unique.has(item.hash)) {
			unique.set(item.hash, item);
		}
	});
	return Array.from(unique.values());
};

export const sortByFileSize = (results: ScrapeSearchResult[]): ScrapeSearchResult[] => {
	results.sort((a, b) => {
		return b.fileSize - a.fileSize;
	});
	return results;
};
