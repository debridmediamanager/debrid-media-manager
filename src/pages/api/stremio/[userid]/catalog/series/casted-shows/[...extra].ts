import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	type: 'series',
	fetchIds: (userid) => db.fetchCastedShows(userid),
	errorLabel: 'RD casted shows',
});
