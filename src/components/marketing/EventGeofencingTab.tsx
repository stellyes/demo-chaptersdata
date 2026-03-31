'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { Card } from '@/components/ui/Card';
import { SectionLabel } from '@/components/ui/SectionLabel';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { MapPin, Download, Filter, Radio } from 'lucide-react';
import {
  DEMO_EVENT_VENUES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
  type EventVenue,
} from '@/lib/demo-data/example-events';

// Dynamic import for Leaflet (SSR-incompatible)
function LeafletMap({
  venues,
  radius,
  selectedVenueId,
  onVenueClick,
}: {
  venues: EventVenue[];
  radius: number;
  selectedVenueId: number | null;
  onVenueClick: (id: number) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const leafletRef = useRef<any>(null);
  const layersRef = useRef<any[]>([]);
  const venuesRef = useRef(venues);
  const radiusRef = useRef(radius);

  // Keep refs in sync with latest props
  venuesRef.current = venues;
  radiusRef.current = radius;

  // Initialize map once
  useEffect(() => {
    if (!mapRef.current) return;

    const init = async () => {
      const L = (await import('leaflet')).default;
      // @ts-ignore - CSS import handled by bundler
      await import('leaflet/dist/leaflet.css');

      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
      }

      const map = L.map(mapRef.current!, { zoomControl: false }).setView([37.7749, -122.4194], 11);
      L.control.zoom({ position: 'bottomright' }).addTo(map);

      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 19,
      }).addTo(map);

      leafletRef.current = L;
      mapInstanceRef.current = map;

      // Render with latest venues (may have changed during async init)
      renderLayers(L, map, venuesRef.current, radiusRef.current);
      fitBounds(L, map, venuesRef.current);
    };

    init();

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
        leafletRef.current = null;
      }
    };
  }, []);

  // Re-render layers and fit bounds when venues/radius change
  useEffect(() => {
    if (!mapInstanceRef.current || !leafletRef.current) return;
    renderLayers(leafletRef.current, mapInstanceRef.current, venues, radius);
    fitBounds(leafletRef.current, mapInstanceRef.current, venues);
  }, [venues, radius]);

  // Pan to selected venue
  useEffect(() => {
    if (!mapInstanceRef.current || !selectedVenueId) return;
    const venue = venues.find((v) => v.id === selectedVenueId);
    if (venue) {
      mapInstanceRef.current.setView([venue.lat, venue.lng], 15);
    }
  }, [selectedVenueId, venues]);

  function fitBounds(L: any, map: any, venuesToFit: EventVenue[]) {
    if (venuesToFit.length > 0) {
      const bounds = L.latLngBounds(venuesToFit.map((v) => [v.lat, v.lng]));
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }

  function renderLayers(L: any, map: any, venuesToRender: EventVenue[], currentRadius: number) {
    layersRef.current.forEach((layer) => map.removeLayer(layer));
    layersRef.current = [];

    venuesToRender.forEach((venue) => {
      const circle = L.circle([venue.lat, venue.lng], {
        color: venue.color,
        fillColor: venue.color,
        fillOpacity: 0.2,
        weight: 2,
        radius: currentRadius,
      }).addTo(map);

      const marker = L.circleMarker([venue.lat, venue.lng], {
        radius: 8,
        fillColor: venue.color,
        color: '#ffffff',
        weight: 2,
        opacity: 1,
        fillOpacity: 1,
      }).addTo(map);

      const popupHtml = `
        <div style="font-family: sans-serif; min-width: 200px;">
          <strong style="font-size: 14px;">${venue.name}</strong>
          <div style="font-size: 11px; text-transform: uppercase; color: ${venue.color}; margin: 4px 0 8px;">${venue.category}</div>
          ${venue.events
            .map(
              (e) =>
                `<div style="padding: 3px 0; font-size: 12px;"><span style="font-weight: 500;">${e.name}</span><br/><span style="color: #888;">${e.date}${e.time ? ' @ ' + e.time : ''}</span></div>`
            )
            .join('')}
          <div style="font-size: 10px; color: #999; margin-top: 6px; font-family: monospace;">${venue.lat.toFixed(4)}, ${venue.lng.toFixed(4)} &middot; ${currentRadius}m radius</div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      circle.bindPopup(popupHtml);

      marker.on('click', () => onVenueClick(venue.id));
      circle.on('click', () => onVenueClick(venue.id));

      layersRef.current.push(circle, marker);
    });
  }

  return (
    <div
      ref={mapRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: '500px', background: '#0a0a0f' }}
    />
  );
}

export function EventGeofencingTab() {
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [radius, setRadius] = useState(300);
  const [selectedVenueId, setSelectedVenueId] = useState<number | null>(null);
  const [venues, setVenues] = useState<EventVenue[]>(DEMO_EVENT_VENUES);
  const [dataSource, setDataSource] = useState<string>('demo-data');

  // Try loading from API (MCP database) on mount
  useEffect(() => {
    fetch('/api/events')
      .then((res) => res.json())
      .then((result) => {
        if (result.success && result.data && result.data.length > 0) {
          setVenues(result.data);
          setDataSource(result.source);
        }
      })
      .catch(() => {
        // Silent fallback to demo data
      });
  }, []);

  const filteredVenues = useMemo(() => {
    if (activeCategory === 'all') return venues;
    return venues.filter((v) => v.category === activeCategory);
  }, [activeCategory, venues]);

  const totalEvents = useMemo(
    () => filteredVenues.reduce((sum, v) => sum + v.events.length, 0),
    [filteredVenues]
  );

  const categories = ['all', 'theater', 'festival', 'convention', 'sports', 'cultural', 'music'];

  const exportJSON = () => {
    const data = filteredVenues.map((v) => ({
      id: v.id,
      name: v.name,
      latitude: v.lat,
      longitude: v.lng,
      radius_meters: radius,
      category: v.category,
      events: v.events.map((e) => ({ name: e.name, date: e.date, time: e.time || null })),
    }));
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sf_oakland_events_geofences.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    const headers = ['id', 'name', 'latitude', 'longitude', 'radius_meters', 'category', 'events'];
    const rows = filteredVenues.map((v) => {
      const eventsStr = v.events
        .map((e) => `${e.name} (${e.date}${e.time ? ' @ ' + e.time : ''})`)
        .join('; ');
      return [v.id, `"${v.name}"`, v.lat, v.lng, radius, v.category, `"${eventsStr}"`];
    });
    const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sf_oakland_events_geofences.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {/* Data source indicator */}
      <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
        <span className={`w-2 h-2 rounded-full ${dataSource === 'mcp-database' ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
        {dataSource === 'mcp-database' ? 'Live event data from weekly discovery' : 'Demo event data — run event discovery sweep for live data'}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <Card className="p-3 md:p-4">
          <div className="flex items-center gap-3">
            <MapPin className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div>
              <p className="text-xs text-[var(--muted)]">Venues</p>
              <p className="text-xl font-semibold font-serif">{filteredVenues.length}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex items-center gap-3">
            <Radio className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div>
              <p className="text-xs text-[var(--muted)]">Events</p>
              <p className="text-xl font-semibold font-serif">{totalEvents}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex items-center gap-3">
            <Filter className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div>
              <p className="text-xs text-[var(--muted)]">Category</p>
              <p className="text-sm font-semibold capitalize">{activeCategory === 'all' ? 'All' : activeCategory}</p>
            </div>
          </div>
        </Card>
        <Card className="p-3 md:p-4">
          <div className="flex items-center gap-3">
            <Radio className="w-5 h-5 text-[var(--accent)] shrink-0" />
            <div>
              <p className="text-xs text-[var(--muted)]">Geofence Radius</p>
              <p className="text-xl font-semibold font-serif">{radius}m</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Controls */}
      <Card>
        <div className="flex flex-col md:flex-row md:items-center gap-4 mb-4">
          <div className="flex-1">
            <SectionLabel>Geofence Radius</SectionLabel>
            <div className="flex items-center gap-4 mt-1">
              <input
                type="range"
                min="100"
                max="1000"
                step="50"
                value={radius}
                onChange={(e) => setRadius(parseInt(e.target.value))}
                className="flex-1 accent-[var(--accent)]"
              />
              <span className="text-sm font-medium text-[var(--ink)] w-16 text-right">{radius}m</span>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={exportJSON}
              className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium bg-[var(--ink)] text-[var(--paper)] hover:opacity-90 transition-opacity"
            >
              <Download className="w-4 h-4" />
              JSON
            </button>
            <button
              onClick={exportCSV}
              className="flex items-center gap-2 px-3 py-2 rounded text-sm font-medium border border-[var(--border)] text-[var(--ink)] hover:bg-[var(--cream)] transition-colors"
            >
              <Download className="w-4 h-4" />
              CSV
            </button>
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex gap-2 flex-wrap">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors capitalize ${
                activeCategory === cat
                  ? 'bg-[var(--ink)] text-[var(--paper)]'
                  : 'bg-[var(--paper)] text-[var(--ink)] border border-[var(--border)]'
              }`}
              style={
                activeCategory === cat && cat !== 'all'
                  ? { backgroundColor: CATEGORY_COLORS[cat], color: '#000' }
                  : undefined
              }
            >
              {cat === 'all' ? 'All' : cat}
            </button>
          ))}
        </div>
      </Card>

      {/* Map */}
      <Card className="p-0 overflow-hidden">
        <LeafletMap
          venues={filteredVenues}
          radius={radius}
          selectedVenueId={selectedVenueId}
          onVenueClick={setSelectedVenueId}
        />
      </Card>

      {/* Legend + Venue List */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
        {/* Legend */}
        <Card>
          <SectionLabel>Legend</SectionLabel>
          <SectionTitle>Event Categories</SectionTitle>
          <div className="space-y-2 mt-3">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <div key={key} className="flex items-center gap-3 text-sm">
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[key] }}
                />
                <span className="text-[var(--ink)]">{label}</span>
              </div>
            ))}
          </div>
        </Card>

        {/* Venue List */}
        <Card className="md:col-span-2">
          <SectionLabel>Venues</SectionLabel>
          <SectionTitle>
            {filteredVenues.length} Venues &middot; {totalEvents} Events
          </SectionTitle>
          <div className="space-y-2 mt-3 max-h-[400px] overflow-y-auto">
            {filteredVenues.map((venue) => (
              <button
                key={venue.id}
                onClick={() => setSelectedVenueId(venue.id)}
                className={`w-full text-left p-3 rounded border transition-colors ${
                  selectedVenueId === venue.id
                    ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                    : 'border-[var(--border)] hover:bg-[var(--cream)]'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: venue.color }}
                  />
                  <span className="font-medium text-sm text-[var(--ink)]">{venue.name}</span>
                  <span className="text-xs text-[var(--muted)] uppercase ml-auto">{venue.category}</span>
                </div>
                {venue.events.map((e, i) => (
                  <div key={i} className="flex justify-between text-xs text-[var(--muted)] ml-5">
                    <span>{e.name}</span>
                    <span>
                      {e.date}
                      {e.time ? ` @ ${e.time}` : ''}
                    </span>
                  </div>
                ))}
              </button>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
