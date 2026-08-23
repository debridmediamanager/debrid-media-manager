-- CreateTable: TorBoxCdnHealth (current status of each advertised CDN node)
CREATE TABLE `TorBoxCdnHealth` (
    `host` VARCHAR(191) NOT NULL,
    `region` VARCHAR(32) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `status` INTEGER NULL,
    `latencyMs` DOUBLE NULL,
    `ok` BOOLEAN NOT NULL,
    `error` TEXT NULL,
    `checkedAt` DATETIME(3) NOT NULL,

    INDEX `TorBoxCdnHealth_ok_idx`(`ok`),
    INDEX `TorBoxCdnHealth_region_idx`(`region`),
    PRIMARY KEY (`host`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: TorBoxCheckResult (one row per health check run, 7-day retention)
CREATE TABLE `TorBoxCheckResult` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `apiOk` BOOLEAN NOT NULL,
    `apiLatencyMs` DOUBLE NULL,
    `apiDetail` TEXT NULL,
    `authState` VARCHAR(16) NOT NULL,
    `authError` TEXT NULL,
    `totalNodes` INTEGER NOT NULL DEFAULT 0,
    `workingNodes` INTEGER NOT NULL DEFAULT 0,
    `checkedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TorBoxCheckResult_checkedAt_idx`(`checkedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: TorBoxHealthHourly (hourly snapshots, 90-day retention)
CREATE TABLE `TorBoxHealthHourly` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `hour` DATETIME(3) NOT NULL,
    `totalNodes` INTEGER NOT NULL,
    `workingNodes` INTEGER NOT NULL,
    `workingRate` DOUBLE NOT NULL,
    `apiSuccessCount` INTEGER NOT NULL DEFAULT 0,
    `apiTotalCount` INTEGER NOT NULL DEFAULT 0,
    `apiSuccessRate` DOUBLE NOT NULL DEFAULT 0,
    `avgLatencyMs` DOUBLE NULL,
    `minLatencyMs` DOUBLE NULL,
    `maxLatencyMs` DOUBLE NULL,
    `fastestNode` VARCHAR(191) NULL,
    `checksInHour` INTEGER NOT NULL DEFAULT 1,
    `failedNodes` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TorBoxHealthHourly_hour_idx`(`hour`),
    UNIQUE INDEX `TorBoxHealthHourly_hour_key`(`hour`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable: TorBoxHealthDaily (daily aggregates, 90-day retention)
CREATE TABLE `TorBoxHealthDaily` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `date` DATETIME(3) NOT NULL,
    `avgWorkingRate` DOUBLE NOT NULL,
    `minWorkingRate` DOUBLE NOT NULL,
    `maxWorkingRate` DOUBLE NOT NULL,
    `avgApiSuccessRate` DOUBLE NOT NULL DEFAULT 0,
    `avgLatencyMs` DOUBLE NULL,
    `checksCount` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `TorBoxHealthDaily_date_idx`(`date`),
    UNIQUE INDEX `TorBoxHealthDaily_date_key`(`date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
