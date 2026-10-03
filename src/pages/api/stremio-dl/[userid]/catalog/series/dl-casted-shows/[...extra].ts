import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'dl',
	type: 'series',
	fetchIds: (userid) => db.fetchDebridLinkCastedShows(userid),
});
