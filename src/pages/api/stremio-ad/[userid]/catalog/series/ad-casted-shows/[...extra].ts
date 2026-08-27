import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	type: 'series',
	fetchIds: (userid) => db.fetchAllDebridCastedShows(userid),
	errorLabel: 'AllDebrid casted shows',
});
