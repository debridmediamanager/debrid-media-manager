import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	type: 'movie',
	fetchIds: (userid) => db.fetchDebridLinkCastedMovies(userid),
	errorLabel: 'Debrid-Link casted movies',
});
