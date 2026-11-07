import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'en',
	type: 'movie',
	fetchIds: (userid) => db.fetchEasynewsCastedMovies(userid),
});
