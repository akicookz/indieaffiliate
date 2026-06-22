CREATE TABLE `coupon_redemptions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`coupon_id` text NOT NULL,
	`external_redemption_id` text NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`coupon_id`) REFERENCES `coupons`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_coupon_redemptions_coupon_external` ON `coupon_redemptions` (`coupon_id`,`external_redemption_id`);
--> statement-breakpoint
CREATE INDEX `idx_coupon_redemptions_project` ON `coupon_redemptions` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_coupon_redemptions_coupon` ON `coupon_redemptions` (`coupon_id`);
