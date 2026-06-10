CREATE TYPE "role" AS ENUM ('user', 'admin');
CREATE TYPE "risk_category" AS ENUM ('Weather', 'Strike', 'Geopolitical', 'Port Congestion');
CREATE TYPE "risk_severity" AS ENUM ('Low', 'Medium', 'High', 'Critical');

CREATE TABLE IF NOT EXISTS "users" (
  "id" serial PRIMARY KEY NOT NULL,
  "email" varchar(320) NOT NULL UNIQUE,
  "name" text,
  "password_hash" varchar(255),
  "role" "role" DEFAULT 'user' NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_signed_in" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "risk_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "title" varchar(255) NOT NULL,
  "description" text NOT NULL,
  "category" "risk_category" NOT NULL,
  "severity" "risk_severity" NOT NULL,
  "affected_locations" json NOT NULL,
  "source_url" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "shipping_routes" (
  "id" serial PRIMARY KEY NOT NULL,
  "origin_port" varchar(100) NOT NULL,
  "destination_port" varchar(100) NOT NULL,
  "waypoints" json NOT NULL,
  "base_transit_days" integer NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "route_evaluations" (
  "id" serial PRIMARY KEY NOT NULL,
  "route_id" integer REFERENCES "shipping_routes"("id"),
  "origin_port" varchar(100) NOT NULL,
  "destination_port" varchar(100) NOT NULL,
  "overall_risk_score" integer NOT NULL,
  "primary_risk_factor" text NOT NULL,
  "breakdown" json NOT NULL,
  "base_transit_days" integer NOT NULL,
  "alternative_routes" json,
  "risk_narrative" text,
  "intelligence_summary" text,
  "data_sources" json,
  "query_text" text,
  "evaluated_at" timestamp DEFAULT now() NOT NULL
);
