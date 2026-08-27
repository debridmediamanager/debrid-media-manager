import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	type: 'movie',
	fetchIds: (userid) => db.fetchCastedMovies(userid),
	errorLabel: 'RD casted movies',
});
