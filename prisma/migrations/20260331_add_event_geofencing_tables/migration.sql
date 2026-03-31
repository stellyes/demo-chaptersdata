-- CreateTable
CREATE TABLE "event_venues" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "category" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#999999',
    "radius" INTEGER NOT NULL DEFAULT 300,
    "city" TEXT NOT NULL DEFAULT 'San Francisco',
    "address" TEXT,
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_listings" (
    "id" TEXT NOT NULL,
    "venue_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT,
    "description" TEXT,
    "expected_attendance" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_discovery_sweeps" (
    "id" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'running',
    "venues_found" INTEGER NOT NULL DEFAULT 0,
    "events_found" INTEGER NOT NULL DEFAULT 0,
    "search_queries" JSONB,
    "sources" JSONB,
    "errors" JSONB,

    CONSTRAINT "event_discovery_sweeps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_venues_city_idx" ON "event_venues"("city");

-- CreateIndex
CREATE INDEX "event_venues_category_idx" ON "event_venues"("category");

-- CreateIndex
CREATE INDEX "event_listings_venue_id_idx" ON "event_listings"("venue_id");

-- CreateIndex
CREATE INDEX "event_listings_date_idx" ON "event_listings"("date");

-- CreateIndex
CREATE INDEX "event_discovery_sweeps_status_idx" ON "event_discovery_sweeps"("status");

-- AddForeignKey
ALTER TABLE "event_listings" ADD CONSTRAINT "event_listings_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "event_venues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
