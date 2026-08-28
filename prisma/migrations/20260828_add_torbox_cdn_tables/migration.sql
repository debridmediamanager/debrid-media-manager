-- CreateTable: TorBoxCdnHourly (reader-browser CDN probes, bucketed per region per hour)
CREATE TABLE `TorBoxCdnHourly` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hour` DATETIME(3) NOT NULL,
    `region` VARCHAR(16) NOT NULL,
    `okCount` INTEGER NOT NULL DEFAULT 0,
    `failCount` INTEGER NOT NULL DEFAULT 0,
    `latencySumMs` DOUBLE NOT NULL DEFAULT 0,
    `latencyCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TorBoxCdnHourly_hour_idx`(`hour`),
    INDEX `TorBoxCdnHourly_region_hour_idx`(`region`, `hour`),
    UNIQUE INDEX `TorBoxCdnHourly_hour_region_key`(`hour`, `region`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: TorBoxCdnDaily (daily rollup of the above, 90-day retention)
CREATE TABLE `TorBoxCdnDaily` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL,
    `region` VARCHAR(16) NOT NULL,
    `okCount` INTEGER NOT NULL,
    `failCount` INTEGER NOT NULL,
    `latencySumMs` DOUBLE NOT NULL DEFAULT 0,
    `latencyCount` INTEGER NOT NULL DEFAULT 0,
    `minRate` DOUBLE NOT NULL DEFAULT 0,
    `maxRate` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TorBoxCdnDaily_date_idx`(`date`),
    INDEX `TorBoxCdnDaily_region_date_idx`(`region`, `date`),
    UNIQUE INDEX `TorBoxCdnDaily_date_region_key`(`date`, `region`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
