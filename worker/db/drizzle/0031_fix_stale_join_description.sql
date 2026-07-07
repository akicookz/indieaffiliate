-- The old join-page default subheadline hardcoded "first 3 months", which
-- contradicts programs with a different duration (shown in the benefits card +
-- calculator). Replace that exact stale default with a neutral invite so the
-- offer specifics come only from the program. Custom copy is untouched.
UPDATE project_branding
SET description = 'Join the partner program and get paid for every customer you bring along.'
WHERE description = 'Join the partner program. Get paid monthly for everyone you bring along — for the first 3 months of their subscription, no cap.';
