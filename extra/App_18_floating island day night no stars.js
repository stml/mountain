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

// Marker locations (decimal degrees)
// Marathonas: 37°43'17.5"N 23°27'42.6"E
const MARATHONAS = { lat: 37.72153, lon: 23.46183, color: 0xff0000 };
// Ktima: 37°43'04.2"N 23°29'02.8"E  
const KTIMA = { lat: 37.71783, lon: 23.48411, color: 0x0000ff };

// Major stars - Right Ascension (hours), Declination (degrees), magnitude
const BRIGHT_STARS = [
  // Winter stars
  { name: 'Sirius', ra: 6.75, dec: -16.72, mag: -1.46 },
  { name: 'Canopus', ra: 6.40, dec: -52.70, mag: -0.72 },
  { name: 'Rigel', ra: 5.24, dec: -8.20, mag: 0.13 },
  { name: 'Betelgeuse', ra: 5.92, dec: 7.41, mag: 0.42 },
  { name: 'Aldebaran', ra: 4.60, dec: 16.51, mag: 0.85 },
  { name: 'Capella', ra: 5.28, dec: 46.00, mag: 0.08 },
  { name: 'Procyon', ra: 7.65, dec: 5.22, mag: 0.34 },
  { name: 'Pollux', ra: 7.76, dec: 28.03, mag: 1.14 },
  { name: 'Castor', ra: 7.58, dec: 31.89, mag: 1.58 },
  // Summer stars
  { name: 'Vega', ra: 18.62, dec: 38.78, mag: 0.03 },
  { name: 'Altair', ra: 19.85, dec: 8.87, mag: 0.77 },
  { name: 'Deneb', ra: 20.69, dec: 45.28, mag: 1.25 },
  { name: 'Antares', ra: 16.49, dec: -26.43, mag: 0.96 },
  // Circumpolar / year-round
  { name: 'Arcturus', ra: 14.26, dec: 19.18, mag: -0.05 },
  { name: 'Spica', ra: 13.42, dec: -11.16, mag: 0.97 },
  { name: 'Regulus', ra: 10.14, dec: 11.97, mag: 1.36 },
  { name: 'Polaris', ra: 2.53, dec: 89.26, mag: 1.98 },
  { name: 'Fomalhaut', ra: 22.96, dec: -29.62, mag: 1.16 },
  // Ursa Major (Big Dipper)
  { name: 'Dubhe', ra: 11.06, dec: 61.75, mag: 1.79 },
  { name: 'Merak', ra: 11.03, dec: 56.38, mag: 2.37 },
  { name: 'Alioth', ra: 12.90, dec: 55.96, mag: 1.77 },
  { name: 'Alkaid', ra: 13.79, dec: 49.31, mag: 1.86 },
  // Orion's belt
  { name: 'Alnitak', ra: 5.68, dec: -1.94, mag: 1.77 },
  { name: 'Alnilam', ra: 5.60, dec: -1.20, mag: 1.69 },
  { name: 'Mintaka', ra: 5.53, dec: -0.30, mag: 2.23 },
  // Southern Cross (partially visible from Aegina)
  { name: 'Acrux', ra: 12.44, dec: -63.10, mag: 0.76 },
  { name: 'Mimosa', ra: 12.80, dec: -59.69, mag: 1.25 },
  // Others
  { name: 'Achernar', ra: 1.63, dec: -57.24, mag: 0.46 },
  { name: 'Hadar', ra: 14.06, dec: -60.37, mag: 0.61 },
];

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
  const [skyColor, setSkyColor] = useState('#87ceeb');
  const [sceneReady, setSceneReady] = useState(false);
  const lightRef = useRef(null);
  const sceneRef = useRef(null);
  const terrainRef = useRef(null);
  const seaRef = useRef(null);
  const starMaterialRef = useRef(null);
  const starsRef = useRef(null);

  // Update light position and sky color when dateTime changes
  useEffect(() => {
    const sun = calculateSunPosition(dateTime, AEGINA_LAT, AEGINA_LON);
    const distance = 20;
    
    // Update light position if available
    if (lightRef.current) {
      // Convert spherical to terrain-local coordinates
      // In terrain's local space (before -90° X rotation):
      // X = east-west, Y = north-south, Z = up
      const x = distance * Math.cos(sun.elevation) * Math.sin(sun.azimuth);
      const y = distance * Math.cos(sun.elevation) * Math.cos(sun.azimuth);
      const z = distance * Math.sin(sun.elevation);
      
      lightRef.current.position.set(x, y, Math.max(0.5, z));
    
      // Dim light when sun is low/below horizon
      const intensity = Math.max(0, Math.min(1, sun.elevation / (Math.PI / 6)));
      lightRef.current.intensity = 0.5 + intensity * 0.8;
    }
    
    // Calculate sky color based on sun elevation
    const elevDegrees = sun.elevation * (180 / Math.PI);
    let r, g, b;
    
    if (elevDegrees < -6) {
      // Night - black
      r = 10; g = 10; b = 30;
    } else if (elevDegrees < 0) {
      // Deep twilight - transition from black to deep pink/red
      const t = (elevDegrees + 6) / 6; // 0 at -6°, 1 at 0°
      r = 10 + t * 80;
      g = 10 + t * 30;
      b = 30 + t * 50;
    } else if (elevDegrees < 10) {
      // Dawn/dusk - pinky red to orange
      const t = elevDegrees / 10; // 0 at horizon, 1 at 10°
      r = 90 + t * 45;  // 90 -> 135
      g = 40 + t * 80;  // 40 -> 120
      b = 80 + t * 70;  // 80 -> 150
    } else if (elevDegrees < 25) {
      // Transition to day - orange/pink to sky blue
      const t = (elevDegrees - 10) / 15; // 0 at 10°, 1 at 25°
      r = 135 + t * (135 - 135); // stay at 135 then drop
      g = 120 + t * (206 - 120);
      b = 150 + t * (235 - 150);
      r = 135 * (1 - t) + 135 * t;
      g = 120 * (1 - t) + 206 * t;
      b = 150 * (1 - t) + 235 * t;
    } else {
      // Full day - sky blue
      r = 135; g = 206; b = 235;
    }
    
    const hexColor = `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
    setSkyColor(hexColor);
    
    if (sceneRef.current) {
      sceneRef.current.background = new THREE.Color(hexColor);
    }
    
    // Fade stars based on sun elevation
    let starOpacity = 0;
    if (elevDegrees < -6) {
      starOpacity = 1; // Full night - stars fully visible
    } else if (elevDegrees < 0) {
      starOpacity = 1 - (elevDegrees + 6) / 6; // Fade out during twilight
    }
    
    // Update star positions and opacity
    if (starsRef.current) {
      const radius = 50;
      const dayOfYear = Math.floor((dateTime - new Date(dateTime.getFullYear(), 0, 0)) / 86400000);
      const hour = dateTime.getHours() + dateTime.getMinutes() / 60;
      const LST = (100.46 + 0.985647 * dayOfYear + AEGINA_LON + 15 * hour) % 360;
      
      starsRef.current.children.forEach((sprite, i) => {
        const star = BRIGHT_STARS[i];
        const raRad = (star.ra * 15 - LST) * (Math.PI / 180);
        const decRad = star.dec * (Math.PI / 180);
        const latRad = AEGINA_LAT * (Math.PI / 180);
        
        const sinAlt = Math.sin(decRad) * Math.sin(latRad) + 
                       Math.cos(decRad) * Math.cos(latRad) * Math.cos(raRad);
        const altitude = Math.asin(sinAlt);
        
        const cosAz = (Math.sin(decRad) - Math.sin(altitude) * Math.sin(latRad)) / 
                      (Math.cos(altitude) * Math.cos(latRad));
        let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
        if (Math.sin(raRad) > 0) azimuth = 2 * Math.PI - azimuth;
        
        const x = radius * Math.cos(altitude) * Math.sin(azimuth);
        const y = radius * Math.sin(altitude);
        const z = radius * Math.cos(altitude) * Math.cos(azimuth);
        
        sprite.position.set(x, y, z);
        
        // Hide stars below horizon, otherwise apply global opacity
        sprite.material.opacity = altitude > 0 ? starOpacity : 0;
      });
    }
  }, [dateTime, sceneReady]);

  useEffect(() => {
    if (!threeRef.current) return;

    const container = threeRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    // Calculate initial sky color based on current time
    const initialSunCalc = calculateSunPosition(dateTime, AEGINA_LAT, AEGINA_LON);
    const initialElevDeg = initialSunCalc.elevation * (180 / Math.PI);
    let initR, initG, initB;
    if (initialElevDeg < -6) {
      initR = 10; initG = 10; initB = 30;
    } else if (initialElevDeg < 0) {
      const t = (initialElevDeg + 6) / 6;
      initR = 10 + t * 80; initG = 10 + t * 30; initB = 30 + t * 50;
    } else if (initialElevDeg < 10) {
      const t = initialElevDeg / 10;
      initR = 90 + t * 45; initG = 40 + t * 80; initB = 80 + t * 70;
    } else if (initialElevDeg < 25) {
      const t = (initialElevDeg - 10) / 15;
      initR = 135 * (1 - t) + 135 * t; initG = 120 * (1 - t) + 206 * t; initB = 150 * (1 - t) + 235 * t;
    } else {
      initR = 135; initG = 206; initB = 235;
    }
    const initHex = `#${Math.round(initR).toString(16).padStart(2, '0')}${Math.round(initG).toString(16).padStart(2, '0')}${Math.round(initB).toString(16).padStart(2, '0')}`;
    scene.background = new THREE.Color(initHex);
    setSkyColor(initHex);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 500);
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
          // Land - green gradient based on elevation (brighter, more contrast)
          const t = (elevation - minElev) / (maxElev - minElev);
          const lightness = 0.55 - t * 0.30; // 0.55 -> 0.25 (brighter range)
          const saturation = 0.55 + t * 0.35; // 0.55 -> 0.90 (more saturated)
          color.setHSL(115 / 360, saturation, lightness);
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
    
    // Helper to convert lat/lon to 3D position in terrain's local coordinates
    const latLonToPosition = (lat, lon) => {
      const lonNorm = (lon - minLon) / (maxLon - minLon);
      const latNorm = (lat - minLat) / (maxLat - minLat);
      
      const x = (lonNorm - 0.5) * planeWidth;
      const y = (latNorm - 0.5) * planeHeight;
      
      // Get elevation at this point
      const col = Math.floor(lonNorm * (cols - 1));
      const row = Math.floor((1 - latNorm) * (rows - 1));
      let elevation = 0;
      if (row >= 0 && row < rows && col >= 0 && col < cols) {
        elevation = elevations[row][col];
        if (elevation < 0) elevation = 0;
      }
      const z = elevation / ELEVATION_SCALE + 0.15; // Above terrain
      
      return { x, y, z };
    };
    
    // Create markers
    const createMarker = (location) => {
      const pos = latLonToPosition(location.lat, location.lon);
      const markerGeometry = new THREE.SphereGeometry(0.03, 16, 16);
      const markerMaterial = new THREE.MeshBasicMaterial({ color: location.color });
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.position.set(pos.x, pos.y, pos.z);
      return marker;
    };
    
    const marathonasMarker = createMarker(MARATHONAS);
    terrain.add(marathonasMarker);
    
    const ktimaMarker = createMarker(KTIMA);
    terrain.add(ktimaMarker);
    
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
    
    // Create star field
    const createStarField = () => {
      const starsGroup = new THREE.Group();
      const radius = 50; // Distance of star sphere
      
      // Calculate Local Sidereal Time (simplified)
      const dayOfYear = Math.floor((dateTime - new Date(dateTime.getFullYear(), 0, 0)) / 86400000);
      const hour = dateTime.getHours() + dateTime.getMinutes() / 60;
      const LST = (100.46 + 0.985647 * dayOfYear + AEGINA_LON + 15 * hour) % 360;
      
      // Calculate initial star opacity
      let initialOpacity = 0;
      if (initialElevDeg < -6) {
        initialOpacity = 1;
      } else if (initialElevDeg < 0) {
        initialOpacity = 1 - (initialElevDeg + 6) / 6;
      }
      
      // Create a canvas texture for star glow
      const canvas = document.createElement('canvas');
      canvas.width = 32;
      canvas.height = 32;
      const ctx = canvas.getContext('2d');
      const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
      gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
      gradient.addColorStop(0.3, 'rgba(255, 255, 255, 0.8)');
      gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 32, 32);
      const starTexture = new THREE.CanvasTexture(canvas);
      
      const starMaterial = new THREE.SpriteMaterial({
        map: starTexture,
        transparent: true,
        opacity: initialOpacity,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending
      });
      starMaterialRef.current = starMaterial;
      
      BRIGHT_STARS.forEach(star => {
        const raRad = (star.ra * 15 - LST) * (Math.PI / 180);
        const decRad = star.dec * (Math.PI / 180);
        const latRad = AEGINA_LAT * (Math.PI / 180);
        
        const sinAlt = Math.sin(decRad) * Math.sin(latRad) + 
                       Math.cos(decRad) * Math.cos(latRad) * Math.cos(raRad);
        const altitude = Math.asin(sinAlt);
        
        const cosAz = (Math.sin(decRad) - Math.sin(altitude) * Math.sin(latRad)) / 
                      (Math.cos(altitude) * Math.cos(latRad));
        let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz)));
        if (Math.sin(raRad) > 0) azimuth = 2 * Math.PI - azimuth;
        
        // Convert to Cartesian (Y is up)
        const x = radius * Math.cos(altitude) * Math.sin(azimuth);
        const y = radius * Math.sin(altitude);
        const z = radius * Math.cos(altitude) * Math.cos(azimuth);
        
        const sprite = new THREE.Sprite(starMaterial.clone());
        sprite.position.set(x, y, z);
        
        // Size based on magnitude (brighter = larger)
        const size = Math.max(1.5, 4 - star.mag * 0.6);
        sprite.scale.set(size, size, 1);
        
        // Store altitude for visibility updates
        sprite.userData = { star, altitude };
        
        starsGroup.add(sprite);
      });
      
      return starsGroup;
    };
    
    const stars = createStarField();
    starsRef.current = stars;
    scene.add(stars);
    
    // Directional light (sun) - attached to terrain so it rotates with it
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
    terrain.add(light);
    
    // Light target also needs to be attached to terrain
    terrain.add(light.target);
    light.target.position.set(0, 0, 0);
    
    // Set initial sun position (in terrain-local coordinates)
    const initialSun = calculateSunPosition(dateTime, AEGINA_LAT, AEGINA_LON);
    const distance = 20;
    light.position.set(
      distance * Math.cos(initialSun.elevation) * Math.sin(initialSun.azimuth),
      distance * Math.cos(initialSun.elevation) * Math.cos(initialSun.azimuth),
      Math.max(0.5, distance * Math.sin(initialSun.elevation))
    );
    
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
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
    
    // Signal that scene is ready for sky color calculation
    setSceneReady(true);

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
      if (starsRef.current) {
        starsRef.current.children.forEach(sprite => {
          sprite.material.dispose();
        });
      }
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
          backgroundColor: skyColor
        }}
      />
      
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