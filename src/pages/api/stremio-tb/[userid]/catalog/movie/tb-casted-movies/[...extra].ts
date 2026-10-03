import { repository as db } from '@/services/repository';
import { createCastCatalogPageHandler } from '@/utils/castCatalogMeta';

export default createCastCatalogPageHandler({
	provider: 'tb',
	type: 'movie',
	fetchIds: (userid) => db.fetchTorBoxCastedMovies(userid),
});
