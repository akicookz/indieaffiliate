-- 0014_user_subscriptions_plan_nullable.sql
-- Make user_subscriptions.plan nullable (no default) so new users start without a selected plan.
-- This migration is safe to run once per database.

-- Recreate user_subscriptions with a nullable plan column.
CREATE TABLE IF NOT EXISTS `user_subscriptions_new` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `plan` text,
  `stripe_customer_id` text,
  `stripe_subscription_id` text,
  `status` text DEFAULT 'active' NOT NULL,
  `current_period_end` integer,
  `trial_ends_at` integer,
  `created_at` integer DEFAULT (unixepoch()) NOT NULL,
  `updated_at` integer DEFAULT (unixepoch()) NOT NULL,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint

-- Copy data from the old table if it exists.
INSERT INTO `user_subscriptions_new` (
  `id`,
  `user_id`,
  `plan`,
  `stripe_customer_id`,
  `stripe_subscription_id`,
  `status`,
  `current_period_end`,
  `trial_ends_at`,
  `created_at`,
  `updated_at`
)
SELECT
  `id`,
  `user_id`,
  `plan`,
  `stripe_customer_id`,
  `stripe_subscription_id`,
  `status`,
  `current_period_end`,
  `trial_ends_at`,
  `created_at`,
  `updated_at`
FROM `user_subscriptions`;
--> statement-breakpoint

DROP TABLE `user_subscriptions`;
--> statement-breakpoint

ALTER TABLE `user_subscriptions_new` RENAME TO `user_subscriptions`;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS `idx_user_subscriptions_user` ON `user_subscriptions` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_user_subscriptions_stripe_customer` ON `user_subscriptions` (`stripe_customer_id`);

