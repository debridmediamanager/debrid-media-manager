import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'ad',
	type: 'series',
	fetchIds: (userid) => db.fetchAllDebridCastedShows(userid),
});
