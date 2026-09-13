-- Driver pay profile: what the driver who hauls the load earns.
--
-- Two nullable columns rather than a separate table, because this is a property
-- of the driver and there is exactly one live profile per driver. Both stay
-- nullable on purpose: an existing driver has no profile, and the settlement
-- policy treats a missing model as "owner-operator keeps the revenue" rather
-- than guessing a rate on the carrier's behalf.
ALTER TABLE "Driver" ADD COLUMN "payModel" TEXT;
ALTER TABLE "Driver" ADD COLUMN "payRate" DECIMAL(12, 4);
