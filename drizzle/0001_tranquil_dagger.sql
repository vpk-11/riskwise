CREATE TABLE `heartbeat_jobs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`taskUid` varchar(65),
	`description` text,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `heartbeat_jobs_id` PRIMARY KEY(`id`),
	CONSTRAINT `heartbeat_jobs_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `risk_events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(255) NOT NULL,
	`description` text NOT NULL,
	`category` enum('Weather','Strike','Geopolitical','Port Congestion') NOT NULL,
	`severity` enum('Low','Medium','High','Critical') NOT NULL,
	`affectedLocations` json NOT NULL,
	`sourceUrl` text,
	`isActive` int NOT NULL DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `risk_events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `route_evaluations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`routeId` int,
	`originPort` varchar(100) NOT NULL,
	`destinationPort` varchar(100) NOT NULL,
	`overallRiskScore` int NOT NULL,
	`primaryRiskFactor` text NOT NULL,
	`breakdown` json NOT NULL,
	`baseTransitDays` int NOT NULL,
	`alternativeRoutes` json,
	`queryText` text,
	`evaluatedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `route_evaluations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shipping_routes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`originPort` varchar(100) NOT NULL,
	`destinationPort` varchar(100) NOT NULL,
	`waypoints` json NOT NULL,
	`baseTransitDays` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shipping_routes_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `route_evaluations` ADD CONSTRAINT `route_evaluations_routeId_shipping_routes_id_fk` FOREIGN KEY (`routeId`) REFERENCES `shipping_routes`(`id`) ON DELETE no action ON UPDATE no action;