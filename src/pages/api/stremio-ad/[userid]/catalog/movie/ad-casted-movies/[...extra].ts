import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	type: 'movie',
	fetchIds: (userid) => db.fetchAllDebridCastedMovies(userid),
	errorLabel: 'AllDebrid casted movies',
});
