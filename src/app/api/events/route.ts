import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/events
 * Returns event venue data from Aurora PostgreSQL.
 * Falls back to demo data if no venues exist in Aurora.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category');
  const city = searchParams.get('city');

  try {
    const where: Record<string, unknown> = {};
    if (category) where.category = category;
    if (city) where.city = { contains: city, mode: 'insensitive' };

    const venues = await prisma.eventVenue.findMany({
      where,
      include: { events: true },
      orderBy: { name: 'asc' },
    });

    if (venues.length === 0) {
      return NextResponse.json({
        success: true,
        source: 'demo-data',
        data: null,
        metadata: { message: 'No events in Aurora — using demo data' },
      });
    }

    const result = venues.map((venue) => ({
      id: venue.id,
      name: venue.name,
      lat: venue.latitude,
      lng: venue.longitude,
      category: venue.category,
      color: venue.color,
      radius: venue.radius,
      city: venue.city,
      events: venue.events.map((e) => ({
        name: e.name,
        date: e.date,
        time: e.time,
        description: e.description,
      })),
    }));

    return NextResponse.json({
      success: true,
      source: 'aurora',
      data: result,
      metadata: {
        totalVenues: result.length,
        totalEvents: result.reduce((sum, v) => sum + v.events.length, 0),
      },
    });
  } catch (error) {
    console.error('Failed to load event data from Aurora:', error);
    return NextResponse.json({
      success: true,
      source: 'demo-data',
      data: null,
      metadata: { message: 'Error reading Aurora — falling back to demo data' },
    });
  }
}
