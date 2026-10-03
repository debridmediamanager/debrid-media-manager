import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'oc',
	type: 'series',
	fetchIds: (userid) => db.fetchOffcloudCastedShows(userid),
});
