import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

interface EventInput {
  name: string;
  date: string;
  time?: string;
  description?: string;
  expectedAttendance?: string;
}

interface VenueInput {
  name: string;
  latitude: number;
  longitude: number;
  category: string;
  color: string;
  radius?: number;
  city: string;
  address?: string;
  source?: string;
  events: EventInput[];
}

/**
 * POST /api/events/sync
 * Upsert event venues and listings into Aurora PostgreSQL.
 * Used by the event-discovery MCP to push weekly data.
 * Deduplicates venues by name + city.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const venues: VenueInput[] = body.venues;

    if (!venues || !Array.isArray(venues)) {
      return NextResponse.json(
        { success: false, error: 'Request body must include a "venues" array' },
        { status: 400 }
      );
    }

    let venuesCreated = 0;
    let venuesUpdated = 0;
    let eventsCreated = 0;

    for (const venue of venues) {
      // Find existing venue by name + city
      const existing = await prisma.eventVenue.findFirst({
        where: { name: venue.name, city: venue.city },
      });

      let venueId: string;

      if (existing) {
        // Update venue metadata
        await prisma.eventVenue.update({
          where: { id: existing.id },
          data: {
            latitude: venue.latitude,
            longitude: venue.longitude,
            category: venue.category,
            color: venue.color,
            radius: venue.radius ?? 300,
            address: venue.address,
            source: venue.source,
          },
        });
        venueId = existing.id;
        venuesUpdated++;
      } else {
        // Create new venue
        const created = await prisma.eventVenue.create({
          data: {
            name: venue.name,
            latitude: venue.latitude,
            longitude: venue.longitude,
            category: venue.category,
            color: venue.color,
            radius: venue.radius ?? 300,
            city: venue.city,
            address: venue.address,
            source: venue.source,
          },
        });
        venueId = created.id;
        venuesCreated++;
      }

      // Upsert events (skip duplicates by name + date for same venue)
      for (const evt of venue.events) {
        const existingEvent = await prisma.eventListing.findFirst({
          where: {
            venueId,
            name: evt.name,
            date: evt.date,
          },
        });

        if (!existingEvent) {
          await prisma.eventListing.create({
            data: {
              venueId,
              name: evt.name,
              date: evt.date,
              time: evt.time,
              description: evt.description,
              expectedAttendance: evt.expectedAttendance,
            },
          });
          eventsCreated++;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: { venuesCreated, venuesUpdated, eventsCreated },
      message: `Synced ${venuesCreated} new venues, updated ${venuesUpdated}, added ${eventsCreated} events`,
    });
  } catch (error) {
    console.error('Failed to sync event data:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to sync event data' },
      { status: 500 }
    );
  }
}
