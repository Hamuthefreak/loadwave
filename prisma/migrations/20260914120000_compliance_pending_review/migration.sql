-- A driver can now renew their own qualification documents from the cab — the
-- licence and the medical examiner's certificate are theirs, and waiting until
-- they are next in the yard means the truck sits.
--
-- The upload is a request, not a fix. The expiry date on it is a claim the
-- office has not agreed to, so the row lands with `pendingReview` set and the
-- assignment gate keeps blocking until somebody confirms it. Without that, the
-- gate would have a door in it exactly where the driver is standing: type your
-- own renewal date and dispatch stops complaining.
--
-- Defaults to false, so every row written by the office (and every row that
-- already exists) is untouched by this migration.

ALTER TABLE "ComplianceDocument" ADD COLUMN "pendingReview" BOOLEAN NOT NULL DEFAULT false;
