-- Verdicts on scraped movie results, and the trash that trash verdicts move
-- results into. Additive only: Scraped and ScrapedTrue keep their schema.
CREATE TABLE `ScrapedVerdict` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `imdbId` VARCHAR(16) NOT NULL,
    `hash` VARCHAR(40) NOT NULL,
    `titleKey` CHAR(40) NOT NULL,
    `title` TEXT NOT NULL,
    `verdict` VARCHAR(8) NOT NULL,
    `rule` VARCHAR(16) NOT NULL,
    `media` VARCHAR(16) NULL,
    `titleMatch` VARCHAR(16) NULL,
    `engine` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ScrapedVerdict_imdbId_hash_titleKey_key`(`imdbId`, `hash`, `titleKey`),
    INDEX `ScrapedVerdict_imdbId_titleKey_idx`(`imdbId`, `titleKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ScrapedTrash` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `source` VARCHAR(16) NOT NULL,
    `key` VARCHAR(191) NOT NULL,
    `imdbId` VARCHAR(16) NOT NULL,
    `movieTitle` VARCHAR(500) NOT NULL,
    `hash` VARCHAR(40) NOT NULL,
    `title` TEXT NOT NULL,
    `fileSize` DOUBLE NULL,
    `rule` VARCHAR(16) NOT NULL,
    `engine` VARCHAR(64) NOT NULL,
    `trashedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ScrapedTrash_imdbId_idx`(`imdbId`),
    INDEX `ScrapedTrash_hash_idx`(`hash`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
