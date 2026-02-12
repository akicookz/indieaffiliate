CREATE TABLE `stripe_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`stripe_customer_id` text NOT NULL,
	`stripe_subscription_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`status` text DEFAULT 'incomplete' NOT NULL,
	`current_period_end` integer,
	`cancel_at_period_end` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stripe_subscriptions_user` ON `stripe_subscriptions` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_stripe_subscriptions_subscription` ON `stripe_subscriptions` (`stripe_subscription_id`);--> statement-breakpoint
CREATE INDEX `idx_stripe_subscriptions_customer` ON `stripe_subscriptions` (`stripe_customer_id`);