import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'dl',
	type: 'movie',
	fetchIds: (userid) => db.fetchDebridLinkCastedMovies(userid),
});
