import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'pm',
	type: 'series',
	fetchIds: (userid) => db.fetchPremiumizeCastedShows(userid),
});
