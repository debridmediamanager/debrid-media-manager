-- Which titles was a release judged for? Every other ScrapedVerdict index starts
-- with imdbId, so reading verdicts by hash alone scanned the whole table, and the
-- DMM Cast cover lookup could only read verdicts for imdbIds another table had
-- already proposed. With this index it reads them by hash, and a release only a
-- keep verdict knows about gets its cover too.
--
-- Deploys do not run migrations. Applied by hand on dmmdb on 2026-10-06, online,
-- 19:36-19:40 UTC, after card 216 re-judged the keeps card 206's rules got wrong
-- (a hash-only read would otherwise have filed The Ministry of Ungentlemanly
-- Warfare under Warfare), and before the code that reads verdicts by hash
-- shipped: without the index every catalog page would scan the table. The ALTER
-- takes a metadata lock briefly at start and end; the server's lock_wait_timeout
-- is a year, so the session timeout makes it fail fast behind a long transaction
-- instead of queueing every query on the table behind it. Retry if it times out.
SET SESSION lock_wait_timeout = 10;
ALTER TABLE `ScrapedVerdict`
    ADD INDEX `ScrapedVerdict_hash_idx` (`hash`),
    ALGORITHM = INPLACE, LOCK = NONE;
