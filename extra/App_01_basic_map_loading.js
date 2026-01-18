import React, { useEffect, useState } from 'react';
import aeginaData from './aegina.json';
import moniData from './moni.json';
import elevationData from './aegina_elevation.json';

const AeginaElevation = () => {
  const [aeginaPath, setAeginaPath] = useState('');
  const [moniPath, setMoniPath] = useState('');
  const [elevationRects, setElevationRects] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Extract coordinates from GeoJSON
    const getCoordinates = (data, name) => {
      let coordinates = null;
      
      if (data.type === 'Feature' && data.geometry) {
        coordinates = data.geometry.coordinates;
      } else if (data.type === 'Polygon' || data.type === 'MultiPolygon') {
        coordinates = data.coordinates;
      } else if (data.coordinates) {
        coordinates = data.coordinates;
      }
      
      if (!coordinates) {
        console.error(`Could not find coordinates in ${name} data`);
        return null;
      }
      return coordinates;
    };

    const aeginaCoords = getCoordinates(aeginaData, 'Aegina');
    const moniCoords = getCoordinates(moniData, 'Moni');
    
    // Get polygon rings
    const getPolygonRing = (coords) => {
      let current = coords;
      while (current && current.length > 0 && Array.isArray(current[0]) && Array.isArray(current[0][0])) {
        current = current[0];
      }
      return current;
    };
    
    const aeginaRing = getPolygonRing(aeginaCoords);
    const moniRing = getPolygonRing(moniCoords);
    
    // Point-in-polygon test
    const isPointInPolygon = (lon, lat, ring) => {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1];
        const xj = ring[j][0], yj = ring[j][1];
        
        const intersect = ((yi > lat) !== (yj > lat)) &&
          (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
      }
      return inside;
    };
    
    // Use elevation data bounds
    const minLon = elevationData.bounds.lon_min;
    const maxLon = elevationData.bounds.lon_max;
    const minLat = elevationData.bounds.lat_min;
    const maxLat = elevationData.bounds.lat_max;
    
    const width = 800;
    const height = 800;
    const padding = 50;
    
    const lonToX = (lon) => {
      return padding + ((lon - minLon) / (maxLon - minLon)) * (width - 2 * padding);
    };
    
    const latToY = (lat) => {
      return height - padding - ((lat - minLat) / (maxLat - minLat)) * (height - 2 * padding);
    };
    
    // Convert coordinates to SVG path
    const coordsToPath = (ring) => {
      if (!ring || ring.length === 0) return '';
      
      let path = '';
      ring.forEach((point, i) => {
        const [lon, lat] = point;
        const x = lonToX(lon);
        const y = latToY(lat);
        
        if (i === 0) {
          path += `M ${x} ${y} `;
        } else {
          path += `L ${x} ${y} `;
        }
      });
      path += 'Z';
      return path;
    };
    
    // Set outlines immediately
    if (aeginaRing) {
      setAeginaPath(coordsToPath(aeginaRing));
    }
    
    if (moniRing) {
      setMoniPath(coordsToPath(moniRing));
    }
    
    // Process elevation data
    const elevations = elevationData.elevations;
    const rows = elevationData.resolution.rows;
    const cols = elevationData.resolution.cols;
    
    const latStep = (maxLat - minLat) / rows;
    const lonStep = (maxLon - minLon) / cols;
    
    // Find min and max elevation for island pixels only
    let minElev = Infinity;
    let maxElev = -Infinity;
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const elevation = elevations[row][col];
        if (elevation <= 0) continue;
        
        const lat = maxLat - ((row + 0.5) * latStep);
        const lon = minLon + ((col + 0.5) * lonStep);
        
        const inAegina = isPointInPolygon(lon, lat, aeginaRing);
        const inMoni = isPointInPolygon(lon, lat, moniRing);
        
        if (inAegina || inMoni) {
          minElev = Math.min(minElev, elevation);
          maxElev = Math.max(maxElev, elevation);
        }
      }
    }
    
    // Create color scale
    const getElevationColor = (elevation) => {
      if (elevation <= 0) return null;
      
      const normalized = (elevation - minElev) / (maxElev - minElev);
      const lightness = 70 - (normalized * 40);
      const saturation = 40 + (normalized * 30);
      
      return `hsl(120, ${saturation}%, ${lightness}%)`;
    };
    
    // Build all rectangles
    const allRects = [];
    
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const elevation = elevations[row][col];
        if (elevation <= 0) continue;
        
        const lat1 = maxLat - (row * latStep);
        const lat2 = maxLat - ((row + 1) * latStep);
        const lon1 = minLon + (col * lonStep);
        const lon2 = minLon + ((col + 1) * lonStep);
        
        const latCenter = (lat1 + lat2) / 2;
        const lonCenter = (lon1 + lon2) / 2;
        
        const inAegina = isPointInPolygon(lonCenter, latCenter, aeginaRing);
        const inMoni = isPointInPolygon(lonCenter, latCenter, moniRing);
        
        if (inAegina || inMoni) {
          const color = getElevationColor(elevation);
          
          if (color) {
            const x1 = lonToX(lon1);
            const y1 = latToY(lat1);
            const x2 = lonToX(lon2);
            const y2 = latToY(lat2);
            
            const rectWidth = Math.abs(x2 - x1);
            const rectHeight = Math.abs(y2 - y1);
            
            allRects.push({
              x: Math.min(x1, x2),
              y: Math.min(y1, y2),
              width: rectWidth,
              height: rectHeight,
              color: color,
              elevation: elevation
            });
          }
        }
      }
    }
    
    // Render progressively in chunks
    const chunkSize = 500; // Render 500 rectangles at a time
    let currentIndex = 0;
    
    const renderChunk = () => {
      const nextChunk = allRects.slice(0, currentIndex + chunkSize);
      setElevationRects(nextChunk);
      
      currentIndex += chunkSize;
      
      if (currentIndex < allRects.length) {
        requestAnimationFrame(renderChunk);
      } else {
        setLoading(false); // Done
      }
    };
    
    // Start rendering
    requestAnimationFrame(renderChunk);
    
  }, []);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      backgroundColor: '#e0e0e0',
      position: 'relative'
    }}>
      {/* Loading spinner - only shows while loading */}
      {loading && (
        <div style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          width: '40px',
          height: '40px',
          border: '4px solid rgba(0, 0, 0, 0.1)',
          borderTop: '4px solid #333',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
          zIndex: 1000
        }} />
      )}
      
      {/* SVG is always visible, builds up progressively */}
      <svg width={800} height={800}>
        {elevationRects.map((rect, i) => (
          <rect
            key={i}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            fill={rect.color}
            stroke="none"
          />
        ))}
        
        {aeginaPath && (
          <path
            d={aeginaPath}
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
        )}
        {moniPath && (
          <path
            d={moniPath}
            fill="none"
            stroke="black"
            strokeWidth="1"
          />
        )}
      </svg>
      
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};

export default AeginaElevation;