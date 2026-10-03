-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PlanningDayState" ADD VALUE 'PLANNING';
ALTER TYPE "PlanningDayState" ADD VALUE 'PUBLISHED';
ALTER TYPE "PlanningDayState" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "PlanningDayState" ADD VALUE 'COMPLETE';
