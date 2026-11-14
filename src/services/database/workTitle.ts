import { Prisma } from '@prisma/client';

/**
 * `work_title` (primary_title without episodes, its own FULLTEXT index) was added to
 * production's imdb_title_basics by hand on 2026-11-11, and Prisma cannot declare a
 * generated column, so a database built with `prisma db push` (a self-hosted copy)
 * lacks it and every search there failed with MySQL 1054. Such a copy matches on
 * primary_title instead; its queries already leave episodes out by title_type.
 */
let hasWorkTitle = true;

const missingWorkTitle = (error: unknown) =>
	/Unknown column '(?:b\.)?work_title'/.test(String((error as Error | undefined)?.message));

/** Runs `query` with the column to MATCH on: work_title, or primary_title where it is missing. */
export async function withWorkTitle<T>(query: (column: Prisma.Sql) => Promise<T>): Promise<T> {
	if (hasWorkTitle) {
		try {
			return await query(Prisma.raw('work_title'));
		} catch (error) {
			if (!missingWorkTitle(error)) throw error;
			hasWorkTitle = false;
		}
	}
	return query(Prisma.raw('primary_title'));
}

/** Tests only. */
export const resetWorkTitleForTest = () => {
	hasWorkTitle = true;
};
