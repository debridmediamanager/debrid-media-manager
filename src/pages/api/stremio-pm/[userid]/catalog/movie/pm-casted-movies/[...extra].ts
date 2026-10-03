import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'pm',
	type: 'movie',
	fetchIds: (userid) => db.fetchPremiumizeCastedMovies(userid),
});
