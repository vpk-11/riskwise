CREATE TYPE "risk_source_type" AS ENUM ('live', 'baseline', 'llm-synthetic');
--> statement-breakpoint
ALTER TABLE "risk_events" ADD COLUMN "source_type" "risk_source_type";
--> statement-breakpoint
UPDATE "risk_events" SET "source_type" = CASE
  WHEN "description" LIKE '[Live % Osiris%' THEN 'baseline'::"risk_source_type"
  WHEN "description" LIKE '[Live %' THEN 'live'::"risk_source_type"
  ELSE 'llm-synthetic'::"risk_source_type"
END;
--> statement-breakpoint
ALTER TABLE "risk_events" ALTER COLUMN "source_type" SET NOT NULL;
