import React, { useEffect, useState, useRef } from 'react';
import * as THREE from 'three';
import aeginaData from './aegina.json';
import moniData from './moni.json';
import elevationData from './aegina_elevation.json';

// === CONTOUR LINE CONFIGURATION ===
// Set to 0 to disable contour lines, or any positive number for interval in meters
const CONTOUR_INTERVAL = 10; // meters between contour lines
const CONTOUR_THICKNESS = 1.5; // how close (in meters) to contour line to darken

const AeginaElevation = () => {
  const [aeginaPath, setAeginaPath] = useState('');
  const [moniPath, setMoniPath] = useState('');
  const [elevationRects, setElevationRects] = useState([]);
  const [loading, setLoading] = useState(true);
  const threeRef = useRef(null);
  const threeInitialized = useRef(false); // Flag to prevent double init

  // Existing 2D SVG code (unchanged)
  useEffect(() => {
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
    
    const getPolygonRing = (coords) => {
      let current = coords;
      while (current && current.length > 0 && Array.isArray(current[0]) && Array.isArray(current[0][0])) {
        current = current[0];
      }
      return current;
    };
    
    const aeginaRing = getPolygonRing(aeginaCoords);
    const moniRing = getPolygonRing(moniCoords);
    
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
    
    const minLon = elevationData.bounds.lon_min;
    const maxLon = elevationData.bounds.lon_max;
    const minLat = elevationData.bounds.lat_min;
    const maxLat = elevationData.bounds.lat_max;
    
    const width = 400;
    const height = 400;
    const padding = 25;
    
    const lonToX = (lon) => {
      return padding + ((lon - minLon) / (maxLon - minLon)) * (width - 2 * padding);
    };
    
    const latToY = (lat) => {
      return height - padding - ((lat - minLat) / (maxLat - minLat)) * (height - 2 * padding);
    };
    
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
    
    if (aeginaRing) {
      setAeginaPath(coordsToPath(aeginaRing));
    }
    
    if (moniRing) {
      setMoniPath(coordsToPath(moniRing));
    }
    
    const elevations = elevationData.elevations;
    const rows = elevationData.resolution.rows;
    const cols = elevationData.resolution.cols;
    
    const latStep = (maxLat - minLat) / rows;
    const lonStep = (maxLon - minLon) / cols;
    
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
    
    const getElevationColor = (elevation) => {
      if (elevation <= 0) return null;
      
      const normalized = (elevation - minElev) / (maxElev - minElev);
      const lightness = 70 - (normalized * 40);
      const saturation = 40 + (normalized * 30);
      
      return `hsl(120, ${saturation}%, ${lightness}%)`;
    };
    
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
    
    const chunkSize = 500;
    let currentIndex = 0;
    
    const renderChunk = () => {
      const nextChunk = allRects.slice(0, currentIndex + chunkSize);
      setElevationRects(nextChunk);
      
      currentIndex += chunkSize;
      
      if (currentIndex < allRects.length) {
        requestAnimationFrame(renderChunk);
      } else {
        setLoading(false);
      }
    };
    
    requestAnimationFrame(renderChunk);
    
  }, []);

// Three.js setup - STEP 3: Add elevation data for 3D terrain
useEffect(() => {
  if (!threeRef.current) return;

  console.log('Three.js effect running...');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe0e0e0);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(0, 5, 10);
  camera.lookAt(0, 0, 0);

  let renderer, geometry, material, terrain;
  
  const existingCanvas = threeRef.current.querySelector('canvas');
  
  // Get polygon rings for masking
  const getCoordinates = (data) => {
    if (data.type === 'Feature' && data.geometry) return data.geometry.coordinates;
    if (data.type === 'Polygon' || data.type === 'MultiPolygon') return data.coordinates;
    if (data.coordinates) return data.coordinates;
    return null;
  };
  
  const getPolygonRing = (coords) => {
    let current = coords;
    while (current && current.length > 0 && Array.isArray(current[0]) && Array.isArray(current[0][0])) {
      current = current[0];
    }
    return current;
  };
  
  const aeginaRing = getPolygonRing(getCoordinates(aeginaData));
  const moniRing = getPolygonRing(getCoordinates(moniData));
  
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
  
  // Elevation data
  const elevations = elevationData.elevations;
  const rows = elevationData.resolution.rows;
  const cols = elevationData.resolution.cols;
  const minLon = elevationData.bounds.lon_min;
  const maxLon = elevationData.bounds.lon_max;
  const minLat = elevationData.bounds.lat_min;
  const maxLat = elevationData.bounds.lat_max;
  
  console.log('Elevation grid:', rows, 'x', cols);
  
  // Helper function to apply elevation and colors to geometry
  const applyElevationAndColors = (geometry, planeWidth, planeHeight, elevationScale) => {
    const positions = geometry.attributes.position;
    const vertexElevations = []; // Store actual elevation values
    
    console.log('Applying elevation to', positions.count, 'vertices...');
    
    // First pass: apply elevation and collect values
    let minElev = Infinity;
    let maxElev = -Infinity;
    
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const y = positions.getY(i);
      
      const lonNorm = (x + planeWidth / 2) / planeWidth;
      const latNorm = (y + planeHeight / 2) / planeHeight;
      
      const lon = minLon + lonNorm * (maxLon - minLon);
      const lat = minLat + latNorm * (maxLat - minLat);
      
      const col = Math.floor(lonNorm * (cols - 1));
      const row = Math.floor((1 - latNorm) * (rows - 1));
      
      const inAegina = isPointInPolygon(lon, lat, aeginaRing);
      const inMoni = isPointInPolygon(lon, lat, moniRing);
      
      let elevation = 0;
      
      if ((inAegina || inMoni) && row >= 0 && row < rows && col >= 0 && col < cols) {
        elevation = elevations[row][col];
        if (elevation < 0) elevation = 0;
      }
      
      vertexElevations.push(elevation);
      
      if (elevation > 0) {
        minElev = Math.min(minElev, elevation);
        maxElev = Math.max(maxElev, elevation);
      }
      
      const z = elevation / elevationScale;
      positions.setZ(i, z);
    }
    
    // Second pass: apply vertex colors based on elevation
    const colors = [];
    const color = new THREE.Color();
    
    for (let i = 0; i < positions.count; i++) {
      const elevation = vertexElevations[i];
      
      if (elevation <= 0) {
        // Sea level / outside islands - gray
        color.setRGB(0.6, 0.6, 0.6);
      } else {
        // Normalize elevation to 0-1 range
        const t = (elevation - minElev) / (maxElev - minElev);
        
        // Light green at base (high lightness), dark green at top (low lightness)
        const lightness = 0.65 - t * 0.35; // 0.65 -> 0.30
        const saturation = 0.45 + t * 0.25; // 0.45 -> 0.70
        
        // Check for contour lines
        let isContour = false;
        if (CONTOUR_INTERVAL > 0) {
          const distToContour = elevation % CONTOUR_INTERVAL;
          isContour = distToContour < CONTOUR_THICKNESS || 
                      distToContour > (CONTOUR_INTERVAL - CONTOUR_THICKNESS);
        }
        
        if (isContour) {
          // Darken for contour line
          color.setHSL(120 / 360, saturation, lightness * 0.4);
        } else {
          color.setHSL(120 / 360, saturation, lightness);
        }
      }
      
      colors.push(color.r, color.g, color.b);
    }
    
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    
    console.log('Elevation range:', minElev, '-', maxElev, 'meters');
  };
  
  if (existingCanvas) {
    console.log('Reusing existing canvas');
    renderer = new THREE.WebGLRenderer({ canvas: existingCanvas, antialias: true });
    
    const planeWidth = 8;
    const planeHeight = 5.5;
    
    geometry = new THREE.PlaneGeometry(
      planeWidth, 
      planeHeight, 
      cols - 1,
      rows - 1
    );
    
    applyElevationAndColors(geometry, planeWidth, planeHeight, 500);
    
    material = new THREE.MeshPhongMaterial({ 
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false
    });
    terrain = new THREE.Mesh(geometry, material);
    
    terrain.rotation.x = -Math.PI / 2;
    
    scene.add(terrain);
    
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 10, 5);
    scene.add(light);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
    
  } else {
    console.log('Creating new canvas');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(400, 400);
    threeRef.current.appendChild(renderer.domElement);

    const planeWidth = 8;
    const planeHeight = 5.5;
    
    geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, cols - 1, rows - 1);
    
    applyElevationAndColors(geometry, planeWidth, planeHeight, 100);
    
    material = new THREE.MeshPhongMaterial({ 
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false
    });
    terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    
    scene.add(terrain);

    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 10, 5);
    scene.add(light);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);
  }

  // Animation
  let isRunning = true;
  const animate = () => {
    if (!isRunning) return;
    
    requestAnimationFrame(animate);
    terrain.rotation.z += 0.005;
    renderer.render(scene, camera);
  };

  console.log('Starting animation...');
  animate();

  return () => {
    console.log('Stopping animation (cleanup)...');
    isRunning = false;
    geometry.dispose();
    material.dispose();
  };
}, []);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center',
      backgroundColor: '#e0e0e0',
      position: 'relative',
      gap: '20px'
    }}>
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
      
      {/* 2D SVG */}
      <svg width={400} height={400} style={{ border: '1px solid #999' }}>
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

      {/* Three.js 3D */}
      <div 
        ref={threeRef} 
        style={{ 
          width: '400px', 
          height: '400px',
          border: '1px solid #999'
        }}
      />
      
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