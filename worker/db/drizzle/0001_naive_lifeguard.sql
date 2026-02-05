CREATE TABLE `clicks` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`referral_code` text NOT NULL,
	`ip` text,
	`user_agent` text,
	`referrer` text,
	`landing_page` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_clicks_project` ON `clicks` (`project_id`);--> statement-breakpoint
CREATE INDEX `idx_clicks_partner` ON `clicks` (`partner_id`);--> statement-breakpoint
CREATE INDEX `idx_clicks_referral_created` ON `clicks` (`referral_code`,`created_at`);--> statement-breakpoint
CREATE TABLE `commissions` (
	`id` text PRIMARY KEY NOT NULL,
	`partner_id` text NOT NULL,
	`customer_id` text NOT NULL,
	`project_id` text NOT NULL,
	`amount` real NOT NULL,
	`rate` real NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_commissions_partner_status` ON `commissions` (`partner_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_commissions_project` ON `commissions` (`project_id`);