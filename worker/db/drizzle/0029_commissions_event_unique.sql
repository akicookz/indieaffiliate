-- Enforce commission idempotency: a given (project, external_event_id) may only
-- produce one commission. Prevents approve-race double-creation for the same
-- Stripe invoice and duplicate rows on CSV re-import. NULL external_event_id is
-- treated as distinct in SQLite, so rows without an event id are unaffected.
DROP INDEX `idx_commissions_event`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commissions_event_unique` ON `commissions` (`project_id`,`external_event_id`);
