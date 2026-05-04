ALTER TABLE `commission_programs` ADD COLUMN `payout_cadence` text;--> statement-breakpoint
ALTER TABLE `commission_programs` ADD COLUMN `payout_day_of_month` integer;--> statement-breakpoint
ALTER TABLE `commission_programs` ADD COLUMN `payout_day_of_week` integer;--> statement-breakpoint
ALTER TABLE `commission_programs` ADD COLUMN `payout_ordinal` integer;
