-- Per-sponsor debrid credentials for the Torznab feed's availability filters.
--
-- `/api/torznab/rd/cached` and `/ad/cached` answer out of `Available` and
-- `AvailableAd`, which DMM populates itself. TorBox, Premiumize and Offcloud
-- have no such table and no anonymous cache probe, so the same filter for them
-- has to ask the provider with an account key.
--
-- The key is the sponsor's own and is linked once, here, rather than carried in
-- the feed URL: an indexer URL is stored in plaintext in every *arr's config
-- and appears in full in DMM's own access logs.
--
-- Keyed on the gatekeeper shortId rather than on the DMM API key, so a Reset
-- API Key in gatekeeper does not silently detach a linked provider.
CREATE TABLE `SponsorProviderKey` (
    `shortId` VARCHAR(16) NOT NULL,
    `service` VARCHAR(4) NOT NULL,
    `apiKey` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`shortId`, `service`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
