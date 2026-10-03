import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'rd',
	type: 'movie',
	fetchIds: (userid) => db.fetchCastedMovies(userid),
});
