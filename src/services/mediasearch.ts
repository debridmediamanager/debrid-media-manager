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
