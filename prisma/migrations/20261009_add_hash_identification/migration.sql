-- content-identifier's answers for library filenames. Additive only.
CREATE TABLE `HashIdentification` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hash` VARCHAR(40) NOT NULL,
    `titleKey` CHAR(40) NOT NULL,
    `filename` TEXT NOT NULL,
    `imdbId` VARCHAR(16) NULL,
    `title` VARCHAR(500) NULL,
    `year` INTEGER NULL,
    `score` DOUBLE NULL,
    `confident` BOOLEAN NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `HashIdentification_hash_titleKey_key`(`hash`, `titleKey`),
    INDEX `HashIdentification_imdbId_idx`(`imdbId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
