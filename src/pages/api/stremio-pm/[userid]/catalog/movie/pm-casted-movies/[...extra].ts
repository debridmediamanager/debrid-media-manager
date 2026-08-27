import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	type: 'movie',
	fetchIds: (userid) => db.fetchPremiumizeCastedMovies(userid),
	errorLabel: 'Premiumize casted movies',
});
