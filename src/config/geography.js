/**
 * Centralized geographic configuration for the island simulator.
 * This file serves as the single source of truth for all geographic bounds,
 * coordinate mappings, and related helpers used throughout the application.
 */

// Island boundaries and geographic data
export const ISLANDS = {
  AEGINA: {
    name: 'Aegina',
    // Bounds match the elevation data exactly - this is the source of truth
    bounds: {
      lon_min: 23.4174315,
      lon_max: 23.5652998,
      lat_min: 37.6735755,
      lat_max: 37.775114
    },
    // Map bounds should match elevation bounds for pixel-perfect alignment
    mapBounds: {
      lon_min: 23.4174315,
      lon_max: 23.5652998,
      lat_min: 37.6735755,
      lat_max: 37.775114
    }
  },
  MONI: {
    name: 'Moni',
    bounds: {
      lon_min: 23.4230677,
      lon_max: 23.4288928,
      lat_min: 37.6861170,
      lat_max: 37.7010720
    },
    // Map bounds should match elevation bounds
    mapBounds: {
      lon_min: 23.4230677,
      lon_max: 23.4288928,
      lat_min: 37.6861170,
      lat_max: 37.7010720
    }
  }
};

// Combined bounds for all islands (union of all island bounds)
export const COMBINED_BOUNDS = {
  lon_min: Math.min(ISLANDS.AEGINA.bounds.lon_min, ISLANDS.MONI.bounds.lon_min),
  lon_max: Math.max(ISLANDS.AEGINA.bounds.lon_max, ISLANDS.MONI.bounds.lon_max),
  lat_min: Math.min(ISLANDS.AEGINA.bounds.lat_min, ISLANDS.MONI.bounds.lat_min),
  lat_max: Math.max(ISLANDS.AEGINA.bounds.lat_max, ISLANDS.MONI.bounds.lat_max)
};

// Plane dimensions based on geographic bounds aspect ratio
const boundsWidth = COMBINED_BOUNDS.lon_max - COMBINED_BOUNDS.lon_min;
const boundsHeight = COMBINED_BOUNDS.lat_max - COMBINED_BOUNDS.lat_min;
const aspectRatio = boundsWidth / boundsHeight;

export const PLANE_DIMENSIONS = {
  width: 8,
  height: 8 / aspectRatio,
  aspectRatio: aspectRatio
};

// Elevation scale configuration
export const ELEVATION = {
  scale: 800, // Divisor for elevation values to Z-position
  maxZ: 1.0  // Maximum Z position (scale / 800)
};

// Zoom level configurations for map tiles
// Higher zoom = smaller geographic area per tile = more detail and focus
// These are tuned for Aegina's mapBounds to avoid overly large surrounding area
export const ZOOM_LEVELS = {
  LOW: 12,      // Low terrain detail - wider view
  MEDIUM: 13,   // Medium terrain detail
  HIGH: 14,     // High terrain detail - street level
  VERY_HIGH: 15 // Very high terrain detail - maximum zoom for most detail
};

/**
 * Get the appropriate zoom level for map tiles based on terrain detail
 * @param {string} terrainDetail - 'Low', 'Medium', 'High', or 'Very High'
 * @returns {number} - Zoom level for map tiles
 */
export function getZoomForTerrainDetail(terrainDetail) {
  switch (terrainDetail) {
    case 'Low':
      return ZOOM_LEVELS.LOW;
    case 'Medium':
      return ZOOM_LEVELS.MEDIUM;
    case 'High':
      return ZOOM_LEVELS.HIGH;
    case 'Very High':
      return ZOOM_LEVELS.VERY_HIGH;
    default:
      return ZOOM_LEVELS.HIGH;
  }
}

/**
 * Get the map bounds for a specific island
 * @param {string} islandName - 'AEGINA', 'MONI', or undefined for combined
 * @returns {object} - Bounds object for map tile fetching
 */
export function getMapBounds(islandName = 'AEGINA') {
  if (islandName === 'AEGINA' && ISLANDS.AEGINA.mapBounds) {
    return ISLANDS.AEGINA.mapBounds;
  }
  if (islandName === 'MONI' && ISLANDS.MONI.mapBounds) {
    return ISLANDS.MONI.mapBounds;
  }
  return COMBINED_BOUNDS;
}

/**
 * Convert geographic coordinates to normalized plane coordinates (0-1)
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @param {object} bounds - Geographic bounds (lon_min, lon_max, lat_min, lat_max)
 * @returns {object} - Normalized coordinates { lonNorm, latNorm }
 */
export function geographicToNormalized(lon, lat, bounds = COMBINED_BOUNDS) {
  const boundsWidth = bounds.lon_max - bounds.lon_min;
  const boundsHeight = bounds.lat_max - bounds.lat_min;
  
  return {
    lonNorm: (lon - bounds.lon_min) / boundsWidth,
    latNorm: (lat - bounds.lat_min) / boundsHeight
  };
}

/**
 * Convert normalized plane coordinates (0-1) to geographic coordinates
 * @param {number} lonNorm - Normalized longitude (0-1)
 * @param {number} latNorm - Normalized latitude (0-1)
 * @param {object} bounds - Geographic bounds (lon_min, lon_max, lat_min, lat_max)
 * @returns {object} - Geographic coordinates { lon, lat }
 */
export function normalizedToGeographic(lonNorm, latNorm, bounds = COMBINED_BOUNDS) {
  const boundsWidth = bounds.lon_max - bounds.lon_min;
  const boundsHeight = bounds.lat_max - bounds.lat_min;
  
  return {
    lon: bounds.lon_min + lonNorm * boundsWidth,
    lat: bounds.lat_min + latNorm * boundsHeight
  };
}

/**
 * Convert plane coordinates to geographic coordinates
 * Plane coordinates range from -width/2 to +width/2 horizontally
 * and -height/2 to +height/2 vertically
 * @param {number} x - Plane X coordinate
 * @param {number} y - Plane Y coordinate
 * @param {object} bounds - Geographic bounds
 * @returns {object} - Geographic coordinates { lon, lat }
 */
export function planeToGeographic(x, y, bounds = COMBINED_BOUNDS) {
  const { width, height } = PLANE_DIMENSIONS;
  const lonNorm = (x + width / 2) / width;
  const latNorm = (y + height / 2) / height;
  
  return normalizedToGeographic(lonNorm, latNorm, bounds);
}

/**
 * Convert geographic coordinates to plane coordinates
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @param {object} bounds - Geographic bounds
 * @returns {object} - Plane coordinates { x, y }
 */
export function geographicToPlane(lon, lat, bounds = COMBINED_BOUNDS) {
  const { lonNorm, latNorm } = geographicToNormalized(lon, lat, bounds);
  const { width, height } = PLANE_DIMENSIONS;
  
  return {
    x: lonNorm * width - width / 2,
    y: latNorm * height - height / 2
  };
}

/**
 * Validate if coordinates are within bounds
 * @param {number} lon - Longitude
 * @param {number} lat - Latitude
 * @param {object} bounds - Geographic bounds
 * @returns {boolean} - True if coordinates are within bounds
 */
export function isWithinBounds(lon, lat, bounds = COMBINED_BOUNDS) {
  return (
    lon >= bounds.lon_min &&
    lon <= bounds.lon_max &&
    lat >= bounds.lat_min &&
    lat <= bounds.lat_max
  );
}

/**
 * Get the visible map area bounds for a given camera distance
 * This helps determine what area of the world to fetch tiles for
 * @param {number} cameraDistance - Distance of camera from center
 * @returns {object} - Visible bounds with some padding
 */
export function getVisibleMapBounds(cameraDistance) {
  // Simple heuristic: farther camera = need broader map view
  // This would be refined based on actual camera FOV and position
  const padding = Math.max(0.1, Math.min(0.3, cameraDistance / 100));
  
  const boundsWidth = COMBINED_BOUNDS.lon_max - COMBINED_BOUNDS.lon_min;
  const boundsHeight = COMBINED_BOUNDS.lat_max - COMBINED_BOUNDS.lat_min;
  
  return {
    lon_min: COMBINED_BOUNDS.lon_min - boundsWidth * padding,
    lon_max: COMBINED_BOUNDS.lon_max + boundsWidth * padding,
    lat_min: COMBINED_BOUNDS.lat_min - boundsHeight * padding,
    lat_max: COMBINED_BOUNDS.lat_max + boundsHeight * padding
  };
}

export default {
  ISLANDS,
  COMBINED_BOUNDS,
  PLANE_DIMENSIONS,
  ELEVATION,
  ZOOM_LEVELS,
  getZoomForTerrainDetail,
  getMapBounds,
  geographicToNormalized,
  normalizedToGeographic,
  planeToGeographic,
  geographicToPlane,
  isWithinBounds,
  getVisibleMapBounds
};
