const mdblistKey = process.env.MDBLIST_KEY;
export const getMdbInfo = (imdbId: string) =>
	`https://mdblist.com/api/?apikey=${mdblistKey}&i=${imdbId}`;
