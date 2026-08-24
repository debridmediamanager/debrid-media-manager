-- CreateTable: TorBoxOperationalHourly (real DMM-user TorBox API calls, bucketed per hour)
CREATE TABLE `TorBoxOperationalHourly` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hour` DATETIME(3) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `totalCount` INTEGER NOT NULL DEFAULT 0,
    `successCount` INTEGER NOT NULL DEFAULT 0,
    `failureCount` INTEGER NOT NULL DEFAULT 0,
    `otherCount` INTEGER NOT NULL DEFAULT 0,
    `successRate` DOUBLE NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TorBoxOperationalHourly_hour_idx`(`hour`),
    INDEX `TorBoxOperationalHourly_operation_hour_idx`(`operation`, `hour`),
    UNIQUE INDEX `TorBoxOperationalHourly_hour_operation_key`(`hour`, `operation`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: TorBoxOperationalDaily (daily rollup of the above, 90-day retention)
CREATE TABLE `TorBoxOperationalDaily` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL,
    `operation` VARCHAR(191) NOT NULL,
    `totalCount` INTEGER NOT NULL,
    `successCount` INTEGER NOT NULL,
    `failureCount` INTEGER NOT NULL,
    `avgSuccessRate` DOUBLE NOT NULL,
    `minSuccessRate` DOUBLE NOT NULL,
    `maxSuccessRate` DOUBLE NOT NULL,
    `peakHour` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TorBoxOperationalDaily_date_idx`(`date`),
    INDEX `TorBoxOperationalDaily_operation_date_idx`(`operation`, `date`),
    UNIQUE INDEX `TorBoxOperationalDaily_date_operation_key`(`date`, `operation`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
