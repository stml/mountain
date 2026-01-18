import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import aeginaData from './aegina.json';
import moniData from './moni.json';
import elevationData from './aegina_elevation.json';

// === CONFIGURATION ===
const ELEVATION_SCALE = 800; // Higher = flatter terrain, lower = more exaggerated
const SEA_COLOR = 0x1e90aa; // Aegean blue
const SKY_COLOR = 0x87ceeb; // Light sky blue
const BASE_SPIN_SPEED = 0.00375; // Base rotation speed (75% of original 0.005)
const DAMPING = 0.95; // How quickly spin slows down (0-1, higher = slower decay)
const MIN_TILT = -Math.PI / 2; // Maximum tilt (top-down view)
const MAX_TILT = -0.05; // Minimum tilt (~3 degrees from horizontal, sea-level view)

// Aegina's geographic coordinates
const AEGINA_LAT = 37.75;
const AEGINA_LON = 23.43;

// Calculate sun position based on date/time and location
const calculateSunPosition = (date, lat, lon) => {
  const dayOfYear = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 86400000);
  const hour = date.getHours() + date.getMinutes() / 60;
  
  // Solar declination (angle of sun relative to equator)
  const declination = 23.45 * Math.sin((2 * Math.PI / 365) * (dayOfYear - 81)) * (Math.PI / 180);
  
  // Hour angle (sun's east-west position)
  const solarNoon = 12 - lon / 15; // Approximate solar noon in local time
  const hourAngle = (hour - solarNoon) * 15 * (Math.PI / 180);
  
  const latRad = lat * (Math.PI / 180);
  
  // Solar elevation (altitude above horizon)
  const sinElevation = Math.sin(latRad) * Math.sin(declination) + 
                       Math.cos(latRad) * Math.cos(declination) * Math.cos(hourAngle);
  const elevation = Math.asin(sinElevation);
  
  // Solar azimuth (compass direction)
  const cosAzimuth = (Math.sin(declination) - Math.sin(latRad) * sinElevation) / 
                     (Math.cos(latRad) * Math.cos(elevation));
  let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAzimuth)));
  if (hourAngle > 0) azimuth = 2 * Math.PI - azimuth;
  
  return { elevation, azimuth };
};

const AeginaElevation = () => {
  const threeRef = useRef(null);
  const [dateTime, setDateTime] = useState(new Date());
  const [sunPosition, setSunPosition] = useState({ x: 50, y: 20, visible: true });
  const lightRef = useRef(null);
  const terrainRef = useRef(null);
  const seaRef = useRef(null);

  // Update light position when dateTime changes
  useEffect(() => {
    if (!lightRef.current) return;
    
    const sun = calculateSunPosition(dateTime, AEGINA_LAT, AEGINA_LON);
    const distance = 20;
    
    // Convert spherical to Cartesian (Y is up in Three.js)
    const x = distance * Math.cos(sun.elevation) * Math.sin(sun.azimuth);
    const y = distance * Math.sin(sun.elevation);
    const z = distance * Math.cos(sun.elevation) * Math.cos(sun.azimuth);
    
    lightRef.current.position.set(x, Math.max(0.5, y), z);
    
    // Dim light when sun is low/below horizon
    const intensity = Math.max(0, Math.min(1, sun.elevation / (Math.PI / 6)));
    lightRef.current.intensity = 0.3 + intensity * 0.7;
    
    // Update visual sun position
    // Azimuth: 0 = North, π/2 = East, π = South, 3π/2 = West
    // Map azimuth to screen X: East (morning) = left, West (evening) = right
    const sunX = 50 + Math.sin(sun.azimuth) * 45; // 5% to 95% of screen width
    
    // Elevation: 0 = horizon, π/2 = overhead
    // Map to screen Y: higher elevation = higher on screen (lower Y value)
    const sunY = Math.max(5, 50 - (sun.elevation / (Math.PI / 2)) * 45);
    
    setSunPosition({ x: sunX, y: sunY, visible: sun.elevation > -0.1 });
  }, [dateTime]);

  useEffect(() => {
    if (!threeRef.current) return;

    const container = threeRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(SKY_COLOR);

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
    camera.position.set(0, 2.1, 7);
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
        
        const z = elevation / ELEVATION_SCALE;
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
    
    // Enable shadows
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, cols - 1, rows - 1);
    applyElevationAndColors(geometry, planeWidth, planeHeight);
    
    material = new THREE.MeshPhongMaterial({ 
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: false,
      transparent: true,
      alphaTest: 0.5
    });
    terrain = new THREE.Mesh(geometry, material);
    terrain.rotation.x = -Math.PI / 2;
    terrain.castShadow = false;
    terrain.receiveShadow = true;
    terrainRef.current = terrain;
    scene.add(terrain);
    
    // Sea plane - circular flat plane at zero elevation
    const seaGeometry = new THREE.CircleGeometry(6.25, 64);
    const seaMaterial = new THREE.MeshPhongMaterial({
      color: SEA_COLOR,
      side: THREE.DoubleSide
    });
    const sea = new THREE.Mesh(seaGeometry, seaMaterial);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.01; // Slightly below zero to avoid z-fighting
    sea.receiveShadow = true;
    seaRef.current = sea;
    scene.add(sea);
    
    // Directional light (sun)
    const light = new THREE.DirectionalLight(0xffffff, 1);
    light.castShadow = true;
    light.shadow.mapSize.width = 2048;
    light.shadow.mapSize.height = 2048;
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 50;
    light.shadow.camera.left = -15;
    light.shadow.camera.right = 15;
    light.shadow.camera.top = 15;
    light.shadow.camera.bottom = -15;
    lightRef.current = light;
    scene.add(light);
    
    // Set initial sun position
    const initialSun = calculateSunPosition(dateTime, AEGINA_LAT, AEGINA_LON);
    const distance = 20;
    light.position.set(
      distance * Math.cos(initialSun.elevation) * Math.sin(initialSun.azimuth),
      Math.max(0.5, distance * Math.sin(initialSun.elevation)),
      distance * Math.cos(initialSun.elevation) * Math.cos(initialSun.azimuth)
    );
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.3);
    scene.add(ambientLight);

    // Handle window resize
    const handleResize = () => {
      const newWidth = container.clientWidth;
      const newHeight = container.clientHeight;
      camera.aspect = newWidth / newHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(newWidth, newHeight);
    };
    window.addEventListener('resize', handleResize);

    // Interactive controls
    let isDragging = false;
    let previousMouseX = 0;
    let previousMouseY = 0;
    let spinVelocity = BASE_SPIN_SPEED;
    let tiltVelocity = 0;
    
    const handlePointerDown = (e) => {
      isDragging = true;
      previousMouseX = e.clientX;
      previousMouseY = e.clientY;
      container.style.cursor = 'grabbing';
    };
    
    const handlePointerMove = (e) => {
      if (!isDragging) return;
      
      const deltaX = e.clientX - previousMouseX;
      const deltaY = e.clientY - previousMouseY;
      
      // Update velocities based on drag
      spinVelocity = deltaX * 0.002;
      tiltVelocity = deltaY * 0.002;
      
      // Apply rotation directly while dragging
      terrain.rotation.z += spinVelocity;
      sea.rotation.z += spinVelocity;
      
      // Tilt (limited range)
      const newTiltX = terrain.rotation.x + tiltVelocity;
      if (newTiltX > MIN_TILT && newTiltX < MAX_TILT) {
        terrain.rotation.x = newTiltX;
        sea.rotation.x = newTiltX;
      }
      
      previousMouseX = e.clientX;
      previousMouseY = e.clientY;
    };
    
    const handlePointerUp = () => {
      isDragging = false;
      container.style.cursor = 'grab';
    };
    
    const handleWheel = (e) => {
      e.preventDefault();
      const zoomSpeed = 0.01;
      const newZ = camera.position.z + e.deltaY * zoomSpeed;
      // Clamp zoom range
      camera.position.z = Math.max(2, Math.min(20, newZ));
      camera.position.y = camera.position.z * 0.3; // Lower camera angle
      camera.lookAt(0, 0, 0);
    };
    
    container.style.cursor = 'grab';
    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', handlePointerUp);
    container.addEventListener('pointerleave', handlePointerUp);
    container.addEventListener('wheel', handleWheel, { passive: false });

    // Animation with inertia
    let isRunning = true;
    const animate = () => {
      if (!isRunning) return;
      requestAnimationFrame(animate);
      
      if (!isDragging) {
        // Apply current spin velocity
        terrain.rotation.z += spinVelocity;
        sea.rotation.z += spinVelocity;
        
        // Gradually return spin to base speed
        spinVelocity = spinVelocity * DAMPING + BASE_SPIN_SPEED * (1 - DAMPING);
        
        // Gradually return tilt velocity to zero
        if (Math.abs(tiltVelocity) > 0.0001) {
          terrain.rotation.x += tiltVelocity;
          sea.rotation.x += tiltVelocity;
          
          // Clamp tilt
          terrain.rotation.x = Math.max(MIN_TILT, Math.min(MAX_TILT, terrain.rotation.x));
          sea.rotation.x = terrain.rotation.x;
          
          tiltVelocity *= DAMPING;
        }
      }
      
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      isRunning = false;
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointerleave', handlePointerUp);
      container.removeEventListener('wheel', handleWheel);
      geometry.dispose();
      material.dispose();
      seaGeometry.dispose();
      seaMaterial.dispose();
    };
  }, []);

  const handleSliderChange = (e) => {
    // Slider value: 0 = midnight, 1440 = end of day (minutes)
    const minutes = parseInt(e.target.value);
    const newDate = new Date(dateTime);
    newDate.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    setDateTime(newDate);
  };

  const handleDateChange = (e) => {
    const newDate = new Date(e.target.value);
    newDate.setHours(dateTime.getHours(), dateTime.getMinutes(), 0, 0);
    setDateTime(newDate);
  };

  const resetToNow = () => {
    setDateTime(new Date());
  };

  const formatTime = (date) => {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const sliderValue = dateTime.getHours() * 60 + dateTime.getMinutes();

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div 
        ref={threeRef} 
        style={{ 
          width: '100%', 
          height: '100%',
          backgroundColor: '#87ceeb'
        }}
      />
      
      {/* Sun visual */}
      {sunPosition.visible && (
        <div style={{
          position: 'absolute',
          left: `${sunPosition.x}%`,
          top: `${sunPosition.y}%`,
          transform: 'translate(-50%, -50%)',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          backgroundColor: 'rgba(255, 255, 255, 0.9)',
          boxShadow: '0 0 20px 10px rgba(255, 255, 255, 0.6), 0 0 40px 20px rgba(255, 255, 200, 0.3)',
          pointerEvents: 'none',
          zIndex: 10
        }} />
      )}
      
      {/* Time control panel */}
      <div style={{
        position: 'absolute',
        top: '16px',
        right: '16px',
        background: 'rgba(255, 255, 255, 0.85)',
        borderRadius: '8px',
        padding: '12px',
        fontSize: '12px',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        minWidth: '140px'
      }}>
        <div style={{ marginBottom: '8px', fontWeight: '500', color: '#333' }}>
          {formatTime(dateTime)}
        </div>
        <input
          type="range"
          min="0"
          max="1439"
          value={sliderValue}
          onChange={handleSliderChange}
          style={{ width: '100%', margin: '4px 0', cursor: 'pointer' }}
        />
        <input
          type="date"
          value={dateTime.toISOString().split('T')[0]}
          onChange={handleDateChange}
          style={{ 
            width: '100%', 
            marginTop: '8px', 
            fontSize: '11px',
            padding: '4px',
            border: '1px solid #ddd',
            borderRadius: '4px'
          }}
        />
        <button
          onClick={resetToNow}
          style={{
            width: '100%',
            marginTop: '8px',
            padding: '6px',
            fontSize: '11px',
            background: '#f0f0f0',
            border: '1px solid #ddd',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Reset to Now
        </button>
      </div>
    </div>
  );
};

export default AeginaElevation;