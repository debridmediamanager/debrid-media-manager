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
