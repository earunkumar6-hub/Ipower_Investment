-- Owner change list #25: a product (holding) can be deactivated – bills and reminders stop, records stay –
-- and switched back on later.
ALTER TYPE "PolicyStatus" ADD VALUE 'Deactivated';
