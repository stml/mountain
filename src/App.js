import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import aeginaData from './aegina.json';
import moniData from './moni.json';
import elevationDataLo from './aegina_elevation_lo.json';
import elevationDataMed from './aegina_elevation_med.json';
import elevationDataHi from './aegina_elevation_hi.json';
import {
  COMBINED_BOUNDS,
  PLANE_DIMENSIONS,
  ELEVATION,
  getZoomForTerrainDetail
} from './config/geography';

const AeginaElevation = () => {
  const threeRef = useRef(null);
  const [terrainDetail, setTerrainDetail] = useState('Low');
  const [appearance, setAppearance] = useState('Island');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!threeRef.current) return;

    setIsLoading(true);

    // Select elevation data based on terrain detail
    let elevationData;
    let detailLevel;
    if (terrainDetail === 'Low') {
      elevationData = elevationDataLo;
      detailLevel = 'Low';
    } else if (terrainDetail === 'Medium') {
      elevationData = elevationDataMed;
      detailLevel = 'Medium';
    } else {
      elevationData = elevationDataHi;
      detailLevel = 'High';
    }

    // === HELPER FUNCTIONS FOR MAP TILES ===
    
    // Fetch a single map tile
    const fetchTile = async (x, y, z, tileSource) => {
      const urls = {
        osm: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        satellite: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        watercolor: `https://tile.stamen.com/watercolor/${z}/${x}/${y}.jpg`
      };
      
      try {
        const response = await fetch(urls[tileSource]);
        if (!response.ok) throw new Error(`Tile fetch failed: ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = e.target.result;
          };
          reader.readAsDataURL(blob);
        });
      } catch (error) {
        console.error(`Failed to fetch tile ${z}/${x}/${y}:`, error);
        return null;
      }
    };
    
    // Create a texture from map tiles
    const createMapTexture = async (tileSource, bounds, zoom) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#e0e0e0';
      ctx.fillRect(0, 0, 512, 512);
      
      // Convert geographic bounds to tile coordinates
      const getTileCoords = (lon, lat, z) => {
        const n = Math.pow(2, z);
        const x = Math.floor(((lon + 180) / 360) * n);
        const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n);
        return { x, y };
      };
      
      const topLeft = getTileCoords(bounds.lon_min, bounds.lat_max, zoom);
      const bottomRight = getTileCoords(bounds.lon_max, bounds.lat_min, zoom);
      
      // Fetch and composite tiles
      const tilesPerSide = Math.ceil(Math.max(bottomRight.x - topLeft.x, bottomRight.y - topLeft.y) + 1);
      const tileSize = Math.floor(512 / tilesPerSide);
      
      for (let ty = topLeft.y; ty <= bottomRight.y; ty++) {
        for (let tx = topLeft.x; tx <= bottomRight.x; tx++) {
          const tile = await fetchTile(tx, ty, zoom, tileSource);
          if (tile) {
            const x = (tx - topLeft.x) * tileSize;
            const y = (ty - topLeft.y) * tileSize;
            ctx.drawImage(tile, x, y, tileSize, tileSize);
          }
        }
      }
      
      return new THREE.CanvasTexture(canvas);
    };

    const container = threeRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Light sky blue

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 5, 10);
    camera.lookAt(0, 0, 0);

    let renderer, geometry, material, terrain;
    
    const existingCanvas = container.querySelector('canvas');
    
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
    
    const isPointInIsland = (lon, lat) => {
      return isPointInPolygon(lon, lat, aeginaRing) || isPointInPolygon(lon, lat, moniRing);
    };
    
    // Elevation data
    const elevations = elevationData.elevations;
    const rows = elevationData.resolution.rows;
    const cols = elevationData.resolution.cols;
    // Use accurate combined bounds from geography config
    const minLon = COMBINED_BOUNDS.lon_min;
    const maxLon = COMBINED_BOUNDS.lon_max;
    const minLat = COMBINED_BOUNDS.lat_min;
    const maxLat = COMBINED_BOUNDS.lat_max;
    
    // Helper function to apply elevation and colors to geometry
    const applyElevationAndColors = (geometry, planeWidth, planeHeight) => {
      const positions = geometry.attributes.position;
      const vertexElevations = [];
      const vertexIsLand = [];
      
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
        
        const inIsland = isPointInIsland(lon, lat);
        
        let elevation = 0;
        
        if (inIsland && row >= 0 && row < rows && col >= 0 && col < cols) {
          elevation = elevations[row][col];
          if (elevation < 0) elevation = 0;
        }
        
        vertexElevations.push(elevation);
        vertexIsLand.push(inIsland);
        
        if (elevation > 0) {
          minElev = Math.min(minElev, elevation);
          maxElev = Math.max(maxElev, elevation);
        }
        
        const z = elevation / ELEVATION.scale;
        positions.setZ(i, z);
      }
      
      // Apply vertex colors based on elevation (RGBA for transparency)
      const colors = [];
      const color = new THREE.Color();
      
      for (let i = 0; i < positions.count; i++) {
        const elevation = vertexElevations[i];
        const isLand = vertexIsLand[i];
        
        if (isLand && elevation > 0) {
          // Land - green gradient based on elevation
          const t = (elevation - minElev) / (maxElev - minElev);
          const lightness = 0.65 - t * 0.35;
          const saturation = 0.45 + t * 0.25;
          color.setHSL(120 / 360, saturation, lightness);
          colors.push(color.r, color.g, color.b, 1); // Opaque
        } else {
          // Outside island - transparent
          colors.push(1, 1, 1, 0); // Fully transparent
        }
      }
      
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
      geometry.computeVertexNormals();
    };
    
    // Use plane dimensions from geography config for accurate aspect ratio
    const planeWidth = PLANE_DIMENSIONS.width;
    const planeHeight = PLANE_DIMENSIONS.height;
    
    if (existingCanvas) {
      renderer = new THREE.WebGLRenderer({ canvas: existingCanvas, antialias: true });
      renderer.setSize(width, height);
    } else {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setSize(width, height);
      container.appendChild(renderer.domElement);
    }
    
    geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, cols - 1, rows - 1);
    
    // Ensure UVs are properly set for texture mapping
    // PlaneGeometry default UVs go from 0-1, which maps correctly to our texture space
    // UV (0,0) = bottom-left, UV (1,1) = top-right
    const uvAttribute = geometry.getAttribute('uv');
    for (let i = 0; i < uvAttribute.count; i++) {
      // UVs are already set correctly by PlaneGeometry, just ensure they're in 0-1 range
      const u = uvAttribute.getX(i);
      const v = uvAttribute.getY(i);
      // Clamp to ensure proper texture mapping
      uvAttribute.setXY(i, Math.max(0, Math.min(1, u)), Math.max(0, Math.min(1, v)));
    }
    uvAttribute.needsUpdate = true;
    
    applyElevationAndColors(geometry, planeWidth, planeHeight);
    
    material = new THREE.MeshPhongMaterial({ 
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false,
      transparent: true,
      alphaTest: 0.5
    });
    
    // Add map texture if not Island appearance
    if (appearance !== 'Island') {
      const mapPromise = (async () => {
        const mapSource = appearance.toLowerCase() === 'roads' ? 'osm' : 
                         appearance.toLowerCase() === 'satellite' ? 'satellite' : 'watercolor';
        // Get zoom level based on terrain detail for consistent map detail
        const zoom = getZoomForTerrainDetail(terrainDetail);
        try {
          // Use accurate combined bounds from geography config
          const mapTexture = await createMapTexture(mapSource, COMBINED_BOUNDS, zoom);
          material.map = mapTexture;
          material.vertexColors = false;
          material.needsUpdate = true;
        } catch (error) {
          console.error('Failed to load map texture:', error);
        }
      })();
    }
    
    terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    scene.add(terrain);
    
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.position.set(5, 10, 5);
    scene.add(light);
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambientLight);

    // Set up OrbitControls for camera manipulation
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0;

    // Handle window resize
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    // Animation
    let isRunning = true;
    const animate = () => {
      if (!isRunning) return;
      requestAnimationFrame(animate);
      // Removed auto-rotation - now controlled by OrbitControls
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Mark loading complete after a small delay to ensure rendering
    const loadingTimer = setTimeout(() => {
      setIsLoading(false);
    }, 100);

    return () => {
      isRunning = false;
      clearTimeout(loadingTimer);
      window.removeEventListener('resize', handleResize);
      geometry.dispose();
      material.dispose();
      controls.dispose();
    };
  }, [terrainDetail, appearance]);

  return (
    <>
      <div 
        ref={threeRef} 
        style={{ 
          width: '100vw', 
          height: '100vh',
          backgroundColor: '#87CEEB',
          margin: 0,
          padding: 0,
          overflow: 'hidden'
        }}
      />
      
      {/* Loading Spinner */}
      {isLoading && (
        <div style={{
          position: 'fixed',
          top: '20px',
          left: '20px',
          width: '40px',
          height: '40px',
          borderRadius: '50%',
          border: '3px solid rgba(0, 0, 0, 0.1)',
          borderTop: '3px solid #333',
          animation: 'spin 0.8s linear infinite',
          zIndex: 1001
        }} />
      )}
      
      <style>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
      
      {/* Control Panel */}
      <div style={{
        position: 'fixed',
        top: '20px',
        right: '20px',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        padding: '20px',
        borderRadius: '8px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
        fontFamily: 'Arial, sans-serif',
        zIndex: 1000,
        minWidth: '250px'
      }}>
        <div style={{ marginBottom: '20px' }}>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: 'bold',
            fontSize: '14px',
            color: '#333'
          }}>
            Appearance
          </label>
          <select
            value={appearance}
            onChange={(e) => setAppearance(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            <option value="Island">Island</option>
            <option value="Roads">Roads</option>
            <option value="Satellite">Satellite</option>
            <option value="Watercolour">Watercolour</option>
          </select>
        </div>
        
        <div>
          <label style={{
            display: 'block',
            marginBottom: '8px',
            fontWeight: 'bold',
            fontSize: '14px',
            color: '#333'
          }}>
            Terrain Detail
          </label>
          <select
            value={terrainDetail}
            onChange={(e) => setTerrainDetail(e.target.value)}
            style={{
              width: '100%',
              padding: '8px',
              borderRadius: '4px',
              border: '1px solid #ddd',
              fontSize: '14px',
              cursor: 'pointer'
            }}
          >
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </select>
        </div>
      </div>
    </>
  );
};

export default AeginaElevation;