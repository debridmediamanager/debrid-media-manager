type TitleEntry = {
	titleId: string;
	ordering: number;
	title: string;
	region: string;
	language: string;
	types: string;
	attributes: string;
	isOriginalTitle: boolean;
};

class TitlesDatabase {
	private titles: TitleEntry[] = [];

	constructor(tsvData: string) {
		this.parseTsv(tsvData);
	}

	private parseTsv(tsvData: string): void {
		const lines = tsvData.split('\n');
		for (const line of lines) {
			const [titleId, ordering, title, region, language, types, attributes, isOriginalTitle] =
				line.split('\t');
			this.titles.push({
				titleId,
				ordering: parseInt(ordering),
				title,
				region,
				language,
				types,
				attributes,
				isOriginalTitle: isOriginalTitle === '1',
			});
		}
	}

	findCommonAndUnacceptableTerms(imdbId: string): {
		commonTerms: Set<string>;
		unacceptableTerms: Set<string>;
	} {
		const titlesForId = this.titles.filter((title) => title.titleId === imdbId);
		const allTerms = titlesForId.map((title) => title.title.split(' '));
		const commonTerms = allTerms.reduce((acc, terms) => {
			terms.forEach((term) => {
				if (allTerms.every((t) => t.includes(term))) {
					acc.add(term);
				}
			});
			return acc;
		}, new Set<string>());

		let unacceptableTerms = new Set<string>();
		this.titles.forEach((title) => {
			if (
				title.titleId !== imdbId &&
				titlesForId.some(
					(t) => title.title.includes(t.title) || t.title.includes(title.title)
				)
			) {
				title.title.split(' ').forEach((term) => unacceptableTerms.add(term));
			}
		});

		return { commonTerms, unacceptableTerms };
	}
}
