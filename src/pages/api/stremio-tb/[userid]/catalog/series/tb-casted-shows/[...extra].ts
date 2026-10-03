import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'tb',
	type: 'series',
	fetchIds: (userid) => db.fetchTorBoxCastedShows(userid),
});
