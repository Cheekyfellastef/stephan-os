export const WORLD_LAYERS = [
  { id: 'Cities', label: 'Cities' },
  { id: 'Naval Assets', label: 'Naval Assets' },
  { id: 'Air Assets', label: 'Air Assets' },
  { id: 'Infrastructure', label: 'Infrastructure' },
  { id: 'Routes', label: 'Routes' },
  { id: 'Labels', label: 'Labels' }
];

export const WORLD_ASSETS = [
  { id: 'city-nyc', name: 'New York Cluster', type: 'City Cluster', lat: 40.7, lon: -74, region: 'North America', layer: 'Cities', representationMode: 'Illustrative', confidence: 'demo', freshness: 'static demo', sourceLabel: 'local demo dataset', description: 'Major illustrative metro cluster.', color: 0x7acbff },
  { id: 'city-tokyo', name: 'Tokyo Cluster', type: 'City Cluster', lat: 35.6, lon: 139.7, region: 'East Asia', layer: 'Cities', representationMode: 'Illustrative', confidence: 'demo', freshness: 'static demo', sourceLabel: 'local demo dataset', description: 'Major illustrative metro cluster.', color: 0x7acbff },
  { id: 'city-london', name: 'London Cluster', type: 'City Cluster', lat: 51.5, lon: -0.1, region: 'Europe', layer: 'Cities', representationMode: 'Illustrative', confidence: 'demo', freshness: 'static demo', sourceLabel: 'local demo dataset', description: 'Illustrative city-node cluster.', color: 0x7acbff },
  { id: 'carrier-1', name: 'Carrier Group Atlas', type: 'Carrier', lat: 16, lon: 146, region: 'Pacific', layer: 'Naval Assets', representationMode: 'Simulated', confidence: 'low', freshness: 'static demo', sourceLabel: 'future adapter placeholder', description: 'Illustrative naval task group marker.', color: 0x9bf1ff, route: 'pacific-loop' },
  { id: 'carrier-2', name: 'Carrier Group Meridian', type: 'Carrier', lat: 24, lon: 57, region: 'Indian Ocean', layer: 'Naval Assets', representationMode: 'Simulated', confidence: 'low', freshness: 'static demo', sourceLabel: 'future adapter placeholder', description: 'Illustrative naval task group marker.', color: 0x9bf1ff, route: 'indian-loop' },
  { id: 'air-1', name: 'Flight Echo', type: 'Aircraft', lat: 50, lon: -20, altitude: 0.12, region: 'North Atlantic', layer: 'Air Assets', representationMode: 'Simulated', confidence: 'demo', freshness: 'static demo', sourceLabel: 'future adapter placeholder', description: 'Illustrative aircraft path follower.', color: 0xffdd8c, route: 'atlantic-air-corridor' },
  { id: 'air-2', name: 'Flight Kilo', type: 'Aircraft', lat: 26, lon: 48, altitude: 0.1, region: 'Middle East', layer: 'Air Assets', representationMode: 'Simulated', confidence: 'demo', freshness: 'static demo', sourceLabel: 'future adapter placeholder', description: 'Illustrative tactical transit marker.', color: 0xffdd8c, route: 'gulf-air-corridor' },
  { id: 'port-1', name: 'Port of Singapore', type: 'Port', lat: 1.3, lon: 103.8, region: 'SE Asia', layer: 'Infrastructure', representationMode: 'Public infrastructure', confidence: 'medium', freshness: 'dated', sourceLabel: 'public source', description: 'Publicly known seaport used as infrastructure example.', color: 0x7dffb3 },
  { id: 'port-2', name: 'Port of Rotterdam', type: 'Port', lat: 51.95, lon: 4.14, region: 'Europe', layer: 'Infrastructure', representationMode: 'Public infrastructure', confidence: 'medium', freshness: 'dated', sourceLabel: 'public source', description: 'Publicly known seaport used as infrastructure example.', color: 0x7dffb3 },
  { id: 'airbase-1', name: 'Illustrative Airbase Delta', type: 'Airbase', lat: 25.2, lon: 55.3, region: 'Middle East', layer: 'Infrastructure', representationMode: 'Illustrative', confidence: 'demo', freshness: 'unknown', sourceLabel: 'local demo dataset', description: 'Illustrative airbase marker for demo controls.', color: 0x7dffb3 }
];

export const WORLD_ROUTES = [
  { id: 'pacific-loop', name: 'Pacific Patrol Route', layer: 'Routes', waypoints: [[16, 146], [20, 154], [14, 161]] },
  { id: 'indian-loop', name: 'Indian Ocean Patrol Route', layer: 'Routes', waypoints: [[24, 57], [17, 64], [21, 72]] },
  { id: 'atlantic-air-corridor', name: 'North Atlantic Air Corridor', layer: 'Routes', waypoints: [[50, -20], [53, -35], [44, -52]] },
  { id: 'gulf-air-corridor', name: 'Gulf Air Corridor', layer: 'Routes', waypoints: [[26, 48], [28, 57], [24, 66]] }
];

export function validateWorldDataset({ layers = WORLD_LAYERS, assets = WORLD_ASSETS, routes = WORLD_ROUTES } = {}) {
  const layerIds = new Set(layers.map((layer) => layer.id));
  const issues = [];
  const validAssets = assets.filter((asset) => {
    const required = ['id', 'name', 'type', 'lat', 'lon', 'region', 'layer', 'representationMode', 'confidence', 'freshness', 'sourceLabel', 'description'];
    const missing = required.filter((field) => asset?.[field] === undefined || asset?.[field] === null || String(asset[field]).trim() === '');
    if (missing.length > 0) {
      issues.push(`asset ${asset?.id || '(unknown)'} missing fields: ${missing.join(', ')}`);
      return false;
    }
    if (!layerIds.has(asset.layer)) {
      issues.push(`asset ${asset.id} uses unknown layer ${asset.layer}`);
      return false;
    }
    return true;
  });

  routes.forEach((route) => {
    if (!layerIds.has(route.layer)) {
      issues.push(`route ${route.id} uses unknown layer ${route.layer}`);
    }
    if (!Array.isArray(route.waypoints) || route.waypoints.length < 2) {
      issues.push(`route ${route.id} has invalid waypoints`);
    }
  });

  return { ok: issues.length === 0, issues, layerIds: Array.from(layerIds), validAssets };
}
