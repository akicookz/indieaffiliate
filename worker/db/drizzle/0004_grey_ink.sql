CREATE TABLE `fraud_flags` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`partner_id` text,
	`type` text NOT NULL,
	`severity` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`details` text NOT NULL,
	`related_commission_id` text,
	`related_click_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_fraud_flags_project_status` ON `fraud_flags` (`project_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_fraud_flags_partner` ON `fraud_flags` (`partner_id`);--> statement-breakpoint
ALTER TABLE `clicks` ADD `is_unique` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `clicks` ADD `country` text;--> statement-breakpoint
ALTER TABLE `clicks` ADD `bot_score` integer;--> statement-breakpoint
CREATE INDEX `idx_clicks_ip_referral_created` ON `clicks` (`ip`,`referral_code`,`created_at`);--> statement-breakpoint
ALTER TABLE `commissions` ADD `external_event_id` text;--> statement-breakpoint
ALTER TABLE `commissions` ADD `fraud_flag` text;--> statement-breakpoint
CREATE INDEX `idx_commissions_event` ON `commissions` (`project_id`,`external_event_id`);--> statement-breakpoint
ALTER TABLE `partners` ADD `registration_ip` text;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_customers_project_email` ON `customers` (`project_id`,`email`);