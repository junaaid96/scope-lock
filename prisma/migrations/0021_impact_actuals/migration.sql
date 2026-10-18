-- Optional actuals on impact assessments: effort and price recorded after
-- implementation, for the estimate-vs-actual report. All nullable; existing
-- rows are untouched.
ALTER TABLE "ChangeImpact" ADD COLUMN "actualEffortDays" DOUBLE PRECISION;
ALTER TABLE "ChangeImpact" ADD COLUMN "actualPriceMinor" INTEGER;
ALTER TABLE "ChangeImpact" ADD COLUMN "actualNotes" TEXT;
