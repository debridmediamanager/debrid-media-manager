import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'oc',
	type: 'movie',
	fetchIds: (userid) => db.fetchOffcloudCastedMovies(userid),
});
