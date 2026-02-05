CREATE TABLE `payouts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`amount` real NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`status` text DEFAULT 'scheduled' NOT NULL,
	`note` text,
	`period_start` integer,
	`period_end` integer,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_payouts_project` ON `payouts` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_payouts_partner` ON `payouts` (`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_payouts_partner_status` ON `payouts` (`partner_id`,`status`);--> statement-breakpoint
ALTER TABLE `customers` ADD `name` text;--> statement-breakpoint
ALTER TABLE `customers` ADD `stripe_customer_id` text;--> statement-breakpoint
ALTER TABLE `partners` ADD `user_id` text REFERENCES users(id);--> statement-breakpoint
CREATE INDEX `idx_partners_user` ON `partners` (`user_id`);