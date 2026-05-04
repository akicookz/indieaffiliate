CREATE TABLE `commission_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text DEFAULT 'recurring' NOT NULL,
	`rate` real NOT NULL,
	`duration_months` integer,
	`flat_amount` real,
	`description` text,
	`min_payout` real DEFAULT 50 NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_commission_programs_project_code` ON `commission_programs` (`project_id`,`code`);
--> statement-breakpoint
CREATE INDEX `idx_commission_programs_project` ON `commission_programs` (`project_id`);
--> statement-breakpoint
CREATE TABLE `coupons` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`partner_id` text NOT NULL,
	`commission_program_id` text,
	`code` text NOT NULL,
	`customer_discount` text,
	`stripe_coupon` text,
	`redemptions` integer DEFAULT 0 NOT NULL,
	`mrr_attributed` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'live' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partner_id`) REFERENCES `partners`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`commission_program_id`) REFERENCES `commission_programs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coupons_project_code` ON `coupons` (`project_id`,`code`);
--> statement-breakpoint
CREATE INDEX `idx_coupons_partner` ON `coupons` (`partner_id`);
--> statement-breakpoint
CREATE INDEX `idx_coupons_program` ON `coupons` (`commission_program_id`);
