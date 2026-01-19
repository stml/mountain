import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import aeginaData from './aegina.json';
import moniData from './moni.json';
import elevationDataLo from './aegina_elevation_lo.json';
import elevationDataMed from './aegina_elevation_med.json';
import elevationDataHi from './aegina_elevation_hi.json';
import {
  ELEVATION,
  getZoomForTerrainDetail,
  getMapBounds
} from './config/geography';

const AeginaElevation = () => {
  const threeRef = useRef(null);
  const cameraStateRef = useRef({ position: null, target: null });
  const texturesCacheRef = useRef({}); // Cache for pre-generated textures
  const [terrainDetail, setTerrainDetail] = useState('Low');
  const [appearance, setAppearance] = useState('Island');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!threeRef.current) return;

    setIsLoading(true);

    // Select elevation data based on terrain detail
    let elevationData;
    if (terrainDetail === 'Low') {
      elevationData = elevationDataLo;
    } else if (terrainDetail === 'Medium') {
      elevationData = elevationDataMed;
    } else if (terrainDetail === 'High') {
      elevationData = elevationDataHi;
    } else { // 'Very High'
      elevationData = elevationDataHi;
    }

    // === HELPER FUNCTIONS FOR MAP TILES ===
    
    // Fetch a single map tile
    const fetchTile = async (x, y, z, tileSource) => {
      const urls = {
        osm: `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
        satellite: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
        watercolor: `https://tiles.stadiamaps.com/tiles/stamen_watercolor/${z}/${x}/${y}.jpg`
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
      // Convert geographic bounds to tile coordinates using Web Mercator projection
      const getTileCoords = (lon, lat, z) => {
        const n = Math.pow(2, z);
        const x = Math.floor(((lon + 180) / 360) * n);
        const latRad = (lat * Math.PI) / 180;
        const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
        return { x, y };
      };
      
      // Get tile pixel coordinates (position within tile)
      const getTilePixelCoords = (lon, lat, z) => {
        const n = Math.pow(2, z);
        const x = ((lon + 180) / 360) * n;
        const latRad = (lat * Math.PI) / 180;
        const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
        
        const tileX = Math.floor(x);
        const tileY = Math.floor(y);
        const pixelX = Math.floor((x - tileX) * 256);
        const pixelY = Math.floor((y - tileY) * 256);
        
        return { tileX, tileY, pixelX, pixelY };
      };
      
      const topLeft = getTileCoords(bounds.lon_min, bounds.lat_max, zoom);
      const bottomRight = getTileCoords(bounds.lon_max, bounds.lat_min, zoom);
      const topLeftPixels = getTilePixelCoords(bounds.lon_min, bounds.lat_max, zoom);
      const bottomRightPixels = getTilePixelCoords(bounds.lon_max, bounds.lat_min, zoom);
      
      // Calculate tile grid size
      const tileCountX = bottomRight.x - topLeft.x + 1;
      const tileCountY = bottomRight.y - topLeft.y + 1;
      
      // Create full tile grid canvas
      const fullCanvasWidth = tileCountX * 256;
      const fullCanvasHeight = tileCountY * 256;
      
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = fullCanvasWidth;
      fullCanvas.height = fullCanvasHeight;
      const fullCtx = fullCanvas.getContext('2d');
      fullCtx.fillStyle = '#e0e0e0';
      fullCtx.fillRect(0, 0, fullCanvas.width, fullCanvas.height);
      
      // Fetch and composite tiles
      for (let ty = topLeft.y; ty <= bottomRight.y; ty++) {
        for (let tx = topLeft.x; tx <= bottomRight.x; tx++) {
          const tile = await fetchTile(tx, ty, zoom, tileSource);
          if (tile) {
            const canvasX = (tx - topLeft.x) * 256;
            const canvasY = (ty - topLeft.y) * 256;
            fullCtx.drawImage(tile, canvasX, canvasY, 256, 256);
          }
        }
      }
      
      // Crop to the actual geographic extent
      const cropX = topLeftPixels.pixelX;
      const cropY = topLeftPixels.pixelY;
      // Width spans from topLeftPixels in tile topLeft to bottomRightPixels in tile bottomRight
      const cropWidth = (bottomRight.x - topLeft.x) * 256 + bottomRightPixels.pixelX - topLeftPixels.pixelX + 1;
      // Height spans from topLeftPixels in tile topLeft to bottomRightPixels in tile bottomRight
      const cropHeight = (bottomRight.y - topLeft.y) * 256 + bottomRightPixels.pixelY - topLeftPixels.pixelY + 1;
      
      const croppedCanvas = document.createElement('canvas');
      croppedCanvas.width = cropWidth;
      croppedCanvas.height = cropHeight;
      const croppedCtx = croppedCanvas.getContext('2d');
      croppedCtx.drawImage(fullCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
      
      // Scale down if needed while maintaining aspect ratio
      let finalCanvas = croppedCanvas;
      const maxSize = 1024;
      if (Math.max(croppedCanvas.width, croppedCanvas.height) > maxSize) {
        const scale = maxSize / Math.max(croppedCanvas.width, croppedCanvas.height);
        const scaledWidth = Math.round(croppedCanvas.width * scale);
        const scaledHeight = Math.round(croppedCanvas.height * scale);
        
        finalCanvas = document.createElement('canvas');
        finalCanvas.width = scaledWidth;
        finalCanvas.height = scaledHeight;
        const scaledCtx = finalCanvas.getContext('2d');
        scaledCtx.drawImage(croppedCanvas, 0, 0, croppedCanvas.width, croppedCanvas.height, 0, 0, scaledWidth, scaledHeight);
      }
      
      // Apply island mask: make pixels outside island bounds transparent
      const maskCtx = finalCanvas.getContext('2d');
      const imageData = maskCtx.getImageData(0, 0, finalCanvas.width, finalCanvas.height);
      const data = imageData.data;
      
      // Map canvas pixels back to geographic coordinates
      const canvasToGeo = (canvasX, canvasY) => {
        // Reverse the scaling that was applied
        let scaledCanvasX = canvasX;
        let scaledCanvasY = canvasY;
        if (finalCanvas !== croppedCanvas) {
          const scaleX = croppedCanvas.width / finalCanvas.width;
          const scaleY = croppedCanvas.height / finalCanvas.height;
          scaledCanvasX = canvasX * scaleX;
          scaledCanvasY = canvasY * scaleY;
        }
        
        // Add back the crop offset to get position in full tile grid
        const fullCanvasX = scaledCanvasX + cropX;
        const fullCanvasY = scaledCanvasY + cropY;
        
        // Convert to tile coordinates
        const tileX = topLeft.x + Math.floor(fullCanvasX / 256);
        const tileY = topLeft.y + Math.floor(fullCanvasY / 256);
        const pixelInTileX = fullCanvasX % 256;
        const pixelInTileY = fullCanvasY % 256;
        
        // Convert tile+pixel to continuous tile coordinates
        const continuousTileX = tileX + pixelInTileX / 256;
        const continuousTileY = tileY + pixelInTileY / 256;
        
        // Convert to geographic coordinates using Web Mercator
        const n = Math.pow(2, zoom);
        const lon = (continuousTileX / n) * 360 - 180;
        const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * continuousTileY / n)));
        const lat = (latRad * 180) / Math.PI;
        
        return { lon, lat };
      };
      
      // Helper to find minimum distance from point to polygon
      const distanceToPolygon = (lon, lat, ring) => {
        let minDist = Infinity;
        for (let i = 0; i < ring.length - 1; i++) {
          const x1 = ring[i][0], y1 = ring[i][1];
          const x2 = ring[i + 1][0], y2 = ring[i + 1][1];
          // Distance from point to line segment
          const dx = x2 - x1, dy = y2 - y1;
          const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)));
          const nearX = x1 + t * dx, nearY = y1 + t * dy;
          const dist = Math.hypot(lon - nearX, lat - nearY);
          minDist = Math.min(minDist, dist);
        }
        return minDist;
      };
      
      // Apply transparency with label buffer: compute on lower resolution then scale up for speed
      const labelBufferDegrees = 0.006; // Twice as wide as before (~600m), enough for typical labels
      
      // Compute mask at lower resolution to speed up calculation
      const maskResolution = Math.min(256, Math.ceil(finalCanvas.width / 4));
      const maskAlphas = new Uint8Array(maskResolution * maskResolution);
      
      for (let my = 0; my < maskResolution; my++) {
        for (let mx = 0; mx < maskResolution; mx++) {
          // Map mask pixel to canvas pixel
          const canvasX = (mx / maskResolution) * finalCanvas.width;
          const canvasY = (my / maskResolution) * finalCanvas.height;
          
          const { lon, lat } = canvasToGeo(canvasX, canvasY);
          const inIsland = isPointInPolygon(lon, lat, aeginaRing) || isPointInPolygon(lon, lat, moniRing);
          
          let alpha = 255;
          if (!inIsland) {
            // Check distance to island boundary
            const distAegina = distanceToPolygon(lon, lat, aeginaRing);
            const distMoni = distanceToPolygon(lon, lat, moniRing);
            const minDist = Math.min(distAegina, distMoni);
            
            // Fade from full opacity at the boundary to transparent at buffer distance
            if (minDist < labelBufferDegrees) {
              alpha = Math.round((1 - minDist / labelBufferDegrees) * 255);
            } else {
              alpha = 0;
            }
          }
          
          maskAlphas[my * maskResolution + mx] = alpha;
        }
      }
      
      // Apply mask to final canvas using interpolated values from lower-res mask
      for (let y = 0; y < finalCanvas.height; y++) {
        for (let x = 0; x < finalCanvas.width; x++) {
          // Map to mask coordinates with interpolation
          const maskX = (x / finalCanvas.width) * maskResolution;
          const maskY = (y / finalCanvas.height) * maskResolution;
          
          const mx0 = Math.floor(maskX);
          const my0 = Math.floor(maskY);
          const mx1 = Math.min(mx0 + 1, maskResolution - 1);
          const my1 = Math.min(my0 + 1, maskResolution - 1);
          
          const fx = maskX - mx0;
          const fy = maskY - my0;
          
          // Bilinear interpolation
          const a00 = maskAlphas[my0 * maskResolution + mx0];
          const a10 = maskAlphas[my0 * maskResolution + mx1];
          const a01 = maskAlphas[my1 * maskResolution + mx0];
          const a11 = maskAlphas[my1 * maskResolution + mx1];
          
          const alpha = Math.round(
            a00 * (1 - fx) * (1 - fy) +
            a10 * fx * (1 - fy) +
            a01 * (1 - fx) * fy +
            a11 * fx * fy
          );
          
          const pixelIndex = (y * finalCanvas.width + x) * 4;
          data[pixelIndex + 3] = alpha;
        }
      }
      
      maskCtx.putImageData(imageData, 0, 0);
      
      const mapTexture = new THREE.CanvasTexture(finalCanvas);
      mapTexture.wrapS = THREE.ClampToEdgeWrapping;
      mapTexture.wrapT = THREE.ClampToEdgeWrapping;
      mapTexture.minFilter = THREE.LinearFilter;
      mapTexture.magFilter = THREE.LinearFilter;
      
      return mapTexture;
    };

    const container = threeRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    // Calculate map tile zoom level based on camera distance from terrain
    const getMapZoomFromCameraDistance = () => {
      if (!camera) return 12;
      // Distance from camera to terrain center (origin)
      const distance = camera.position.length();
      // Map distance to zoom level: closer = higher zoom
      // At distance ~15 or more: zoom 11 (wide view)
      // At distance ~10: zoom 12
      // At distance ~5: zoom 13
      // At distance ~2.5: zoom 14
      // At distance < 2: zoom 15 (street level)
      if (distance > 15) return 11;
      if (distance > 10) return 12;
      if (distance > 5) return 13;
      if (distance > 2.5) return 14;
      return 15;
    };

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87CEEB); // Light sky blue

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    
    // Restore previous camera position if available
    if (cameraStateRef.current.position) {
      camera.position.copy(cameraStateRef.current.position);
      if (cameraStateRef.current.target) {
        camera.lookAt(cameraStateRef.current.target);
      }
    } else {
      camera.position.set(0, 5, 10);
      camera.lookAt(0, 0, 0);
    }

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
    // Use elevation data's own bounds for terrain mapping (don't use COMBINED_BOUNDS)
    const minLon = elevationData.bounds.lon_min;
    const maxLon = elevationData.bounds.lon_max;
    const minLat = elevationData.bounds.lat_min;
    const maxLat = elevationData.bounds.lat_max;
    
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
    
    // Use original plane dimensions (geography config dimensions are for combined bounds, not elevation data)
    const planeWidth = 8;
    const planeHeight = 5.5;
    
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
    
    // Add map texture if not Island appearance - load from pre-generated files
    let updateMapTexture = null;
    
    if (appearance !== 'Island') {
      const mapSource = appearance.toLowerCase() === 'roads' ? 'osm' : 'satellite';
      
      // Use dynamic zoom based on camera distance
      updateMapTexture = () => {
        const zoom = getMapZoomFromCameraDistance();
        const texturePath = `/map-textures/${mapSource}_z${zoom}.png`;
        
        const textureLoader = new THREE.TextureLoader();
        textureLoader.load(
          texturePath,
          (texture) => {
            // Pre-generated texture loaded successfully
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.minFilter = THREE.LinearFilter;
            texture.magFilter = THREE.LinearFilter;
            material.map = texture;
            material.vertexColors = false;
            material.needsUpdate = true;
          },
          undefined,
          () => {
            // Fallback: generate texture dynamically if file not found
            console.log(`Pre-generated texture not found for ${mapSource} zoom ${getMapZoomFromCameraDistance()}, generating dynamically...`);
            (async () => {
              try {
                const mapBounds = getMapBounds('AEGINA');
                const mapTexture = await createMapTexture(mapSource, mapBounds, getMapZoomFromCameraDistance());
                material.map = mapTexture;
                material.vertexColors = false;
                material.needsUpdate = true;
              } catch (error) {
                console.error('Failed to load map texture:', error);
              }
            })();
          }
        );
      };
      
      // Load initial texture
      updateMapTexture();
    }
    
    terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    scene.add(terrain);
    
    // Add infinite water plane
    const waterGeometry = new THREE.PlaneGeometry(1000, 1000);
    const waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x1a5f7a,
      roughness: 0.3,
      metalness: 0.1
    });
    const water = new THREE.Mesh(waterGeometry, waterMaterial);
    water.rotation.x = -Math.PI / 2;
    water.position.z = -0.01; // Slightly below terrain to avoid z-fighting
    scene.add(water);
    
    // Add sky dome for horizon effect
    const skyGeometry = new THREE.SphereGeometry(500, 32, 32);
    const skyMaterial = new THREE.MeshBasicMaterial({
      color: 0x87CEEB,
      side: THREE.BackSide
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    scene.add(sky);
    
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
    
    // Constrain camera to not go below water level
    // maxPolarAngle = π/2 - 1° keeps water visible at horizon
    controls.maxPolarAngle = Math.PI / 2 - Math.PI / 180;

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
    let lastMapZoom = getMapZoomFromCameraDistance();
    
    const animate = () => {
      if (!isRunning) return;
      requestAnimationFrame(animate);
      // Removed auto-rotation - now controlled by OrbitControls
      controls.update();
      
      // Update map zoom if camera distance changed significantly
      if (appearance !== 'Island') {
        const currentZoom = getMapZoomFromCameraDistance();
        if (currentZoom !== lastMapZoom) {
          lastMapZoom = currentZoom;
          // Trigger map texture update (if updateMapTexture is defined)
          if (typeof updateMapTexture === 'function') {
            updateMapTexture();
          }
        }
      }
      
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
      
      // Save camera state for next render
      if (camera) {
        cameraStateRef.current.position = camera.position.clone();
        cameraStateRef.current.target = new THREE.Vector3(0, 0, 0); // Camera typically looks at origin
      }
      
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
          top: '15px',
          left: '15px',
          width: '28px',
          height: '28px',
          borderRadius: '50%',
          border: '2px solid rgba(100, 100, 100, 0.2)',
          borderTop: '2px solid rgba(100, 100, 100, 0.8)',
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
            <option value="Very High">Very High</option>
          </select>
        </div>
      </div>
    </>
  );
};

export default AeginaElevation;