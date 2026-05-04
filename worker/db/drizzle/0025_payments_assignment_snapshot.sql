-- Stripe payments are now live-pulled instead of synced into the table.
-- Existing Stripe rows are wiped; CSV rows remain.
DELETE FROM `payments` WHERE `source` = 'stripe';
--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `commission_program_id` text;--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `program_type` text;--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `duration_months` integer;--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `rate` real;--> statement-breakpoint
ALTER TABLE `payments` ADD COLUMN `subscription_anchor_at` integer;
