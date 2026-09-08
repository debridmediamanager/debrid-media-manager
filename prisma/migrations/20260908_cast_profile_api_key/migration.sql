-- A Real-Debrid cast profile can now be held by a pasted API key instead of the
-- OAuth triple.
--
-- `/realdebrid/login` has accepted a pasted key since 18b32d04, but that path
-- stores only `rd:accessToken` - there is no clientId to send - so those users
-- could never save a cast profile at all, and `/stremio` bounced them back to
-- the login forever.
--
-- The OAuth columns become nullable rather than carrying empty strings, so
-- `castAccessToken` can branch on what is actually present: an API key is
-- returned as-is, and only a real triple reaches the refresh call.
ALTER TABLE `CastProfile`
    ADD COLUMN `apiKey` VARCHAR(191) NULL,
    MODIFY COLUMN `clientId` VARCHAR(191) NULL,
    MODIFY COLUMN `clientSecret` VARCHAR(191) NULL,
    MODIFY COLUMN `refreshToken` VARCHAR(191) NULL;
