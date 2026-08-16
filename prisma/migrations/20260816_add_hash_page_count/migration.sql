-- CreateTable
-- Materialised count of how many distinct media keys carry each infohash.
-- Refreshed periodically from Scraped/ScrapedTrue rather than maintained
-- incrementally: a stale count is harmless (a hash drifting past the threshold
-- is caught on the next refresh) and it avoids per-write bookkeeping.
CREATE TABLE `HashPageCount` (
    `hash` VARCHAR(40) NOT NULL,
    `pageCount` INTEGER NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `HashPageCount_pageCount_idx`(`pageCount`),
    PRIMARY KEY (`hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
