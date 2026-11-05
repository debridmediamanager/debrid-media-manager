-- Created by hand on production on 2026-11-05 (f2993dbb); this is that DDL, so a fresh
-- database gets the tables the Debrid-Link availability routes read and write.

-- CreateTable
CREATE TABLE `AvailableDl` (
    `hash` VARCHAR(40) NOT NULL,
    `imdbId` VARCHAR(16) NOT NULL,
    `filename` TEXT NOT NULL,
    `bytes` BIGINT NOT NULL,
    `season` INTEGER NULL,
    `episode` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `AvailableDl_imdbId_idx`(`imdbId`),
    PRIMARY KEY (`hash`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AvailableDlFile` (
    `hash` VARCHAR(40) NOT NULL,
    `file_id` INTEGER NOT NULL,
    `path` TEXT NOT NULL,
    `bytes` BIGINT NOT NULL,
    `season` INTEGER NULL,
    `episode` INTEGER NULL,

    PRIMARY KEY (`hash`, `file_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
