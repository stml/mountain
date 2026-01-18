import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import aeginaData from './aegina.json';
import moniData from './moni.json';
import elevationData from './aegina_elevation.json';

// === CONTOUR LINE CONFIGURATION ===
// Set to 0 to disable contour lines, or any positive number for interval in meters
const CONTOUR_INTERVAL = 0; // meters between contour lines
const CONTOUR_THICKNESS = 1.5; // how close (in meters) to contour line to darken

const AeginaElevation = () => {
  const threeRef = useRef(null);

  useEffect(() => {
    if (!threeRef.current) return;

    const container = threeRef.current;
    const width = container.clientWidth;
    const height = container.clientHeight;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe0e0e0);

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
    
    // Elevation data
    const elevations = elevationData.elevations;
    const rows = elevationData.resolution.rows;
    const cols = elevationData.resolution.cols;
    const minLon = elevationData.bounds.lon_min;
    const maxLon = elevationData.bounds.lon_max;
    const minLat = elevationData.bounds.lat_min;
    const maxLat = elevationData.bounds.lat_max;
    
    // Helper function to apply elevation and colors to geometry
    const applyElevationAndColors = (geometry, planeWidth, planeHeight, elevationScale) => {
      const positions = geometry.attributes.position;
      const vertexElevations = [];
      
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
      
      // Apply vertex colors based on elevation
      const colors = [];
      const color = new THREE.Color();
      
      for (let i = 0; i < positions.count; i++) {
        const elevation = vertexElevations[i];
        
        if (elevation <= 0) {
          color.setRGB(0.6, 0.6, 0.6);
        } else {
          const t = (elevation - minElev) / (maxElev - minElev);
          const lightness = 0.65 - t * 0.35;
          const saturation = 0.45 + t * 0.25;
          
          let isContour = false;
          if (CONTOUR_INTERVAL > 0) {
            const distToContour = elevation % CONTOUR_INTERVAL;
            isContour = distToContour < CONTOUR_THICKNESS || 
                        distToContour > (CONTOUR_INTERVAL - CONTOUR_THICKNESS);
          }
          
          if (isContour) {
            color.setHSL(120 / 360, saturation, lightness * 0.4);
          } else {
            color.setHSL(120 / 360, saturation, lightness);
          }
        }
        
        colors.push(color.r, color.g, color.b);
      }
      
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
    
    geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, cols - 1, rows - 1);
    applyElevationAndColors(geometry, planeWidth, planeHeight, 800);
    
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
      terrain.rotation.z += 0.005;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      isRunning = false;
      window.removeEventListener('resize', handleResize);
      geometry.dispose();
      material.dispose();
    };
  }, []);

  return (
    <div 
      ref={threeRef} 
      style={{ 
        width: '100vw', 
        height: '100vh',
        backgroundColor: '#e0e0e0'
      }}
    />
  );
};

export default AeginaElevation;