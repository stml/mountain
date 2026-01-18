const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const jimp = require('jimp');

// Map bounds for Aegina
const bounds = {
  lon_min: 23.4174315,
  lon_max: 23.5652998,
  lat_min: 37.6735755,
  lat_max: 37.775114
};

// Island rings (simplified for masking)
const aeginaRing = [
  [23.4174315, 37.775114],
  [23.5652998, 37.775114],
  [23.5652998, 37.6735755],
  [23.4174315, 37.6735755]
];

const moniRing = [
  [23.43, 37.72],
  [23.45, 37.72],
  [23.45, 37.70],
  [23.43, 37.70]
];

const urls = {
  osm: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  satellite: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  watercolor: (x, y, z) => `https://tiles.stadiamaps.com/tiles/stamen_watercolor/${z}/${x}/${y}.jpg`
};

const distanceToPolygon = (lon, lat, ring) => {
  let minDist = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0], y1 = ring[i][1];
    const x2 = ring[i + 1][0], y2 = ring[i + 1][1];
    const dx = x2 - x1, dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((lon - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy)));
    const nearX = x1 + t * dx, nearY = y1 + t * dy;
    const dist = Math.hypot(lon - nearX, lat - nearY);
    minDist = Math.min(minDist, dist);
  }
  return minDist;
};

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

const fetchTile = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Tile fetch failed: ${response.status}`);
    return await response.buffer();
  } catch (error) {
    console.error(`Failed to fetch tile: ${error.message}`);
    return null;
  }
};

const generateTexture = async (tileSource, zoom) => {
  console.log(`Generating ${tileSource} at zoom ${zoom}...`);
  
  const getTileCoords = (lon, lat, z) => {
    const n = Math.pow(2, z);
    const x = Math.floor(((lon + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    return { x, y };
  };
  
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
  
  const tileCountX = bottomRight.x - topLeft.x + 1;
  const tileCountY = bottomRight.y - topLeft.y + 1;
  
  const fullCanvasWidth = tileCountX * 256;
  const fullCanvasHeight = tileCountY * 256;
  
  // Create full canvas using jimp
  let fullCanvas = new jimp(fullCanvasWidth, fullCanvasHeight, 0xe0e0e0ff);
  
  // Fetch and composite tiles
  for (let ty = topLeft.y; ty <= bottomRight.y; ty++) {
    for (let tx = topLeft.x; tx <= bottomRight.x; tx++) {
      const tileUrl = urls[tileSource](tx, ty, zoom);
      try {
        const tileImg = await jimp.read(tileUrl);
        const canvasX = (tx - topLeft.x) * 256;
        const canvasY = (ty - topLeft.y) * 256;
        fullCanvas.blit(tileImg, canvasX, canvasY);
      } catch (error) {
        console.error(`  Failed to fetch tile ${tx},${ty}: ${error.message}`);
      }
    }
  }
  
  // Crop to geographic extent
  const cropX = topLeftPixels.pixelX;
  const cropY = topLeftPixels.pixelY;
  const cropWidth = (bottomRight.x - topLeft.x) * 256 + bottomRightPixels.pixelX - topLeftPixels.pixelX + 1;
  const cropHeight = (bottomRight.y - topLeft.y) * 256 + bottomRightPixels.pixelY - topLeftPixels.pixelY + 1;
  
  let croppedCanvas = fullCanvas.clone().crop(cropX, cropY, cropWidth, cropHeight);
  
  // Scale down if needed
  let finalCanvas = croppedCanvas;
  const maxSize = 1024;
  if (Math.max(cropWidth, cropHeight) > maxSize) {
    const scale = maxSize / Math.max(cropWidth, cropHeight);
    const scaledWidth = Math.round(cropWidth * scale);
    const scaledHeight = Math.round(cropHeight * scale);
    finalCanvas = croppedCanvas.clone().resize(scaledWidth, scaledHeight);
  }
  
  // Apply mask (simplified - just apply alpha to edge pixels)
  const maskResolution = 64;
  const canvasToGeo = (canvasX, canvasY) => {
    let scaledCanvasX = canvasX;
    let scaledCanvasY = canvasY;
    if (finalCanvas !== croppedCanvas) {
      const scaleX = croppedCanvas.width / finalCanvas.width;
      const scaleY = croppedCanvas.height / finalCanvas.height;
      scaledCanvasX = canvasX * scaleX;
      scaledCanvasY = canvasY * scaleY;
    }
    const fullCanvasX = scaledCanvasX + cropX;
    const fullCanvasY = scaledCanvasY + cropY;
    const tileX = topLeft.x + Math.floor(fullCanvasX / 256);
    const tileY = topLeft.y + Math.floor(fullCanvasY / 256);
    const pixelInTileX = fullCanvasX % 256;
    const pixelInTileY = fullCanvasY % 256;
    const continuousTileX = tileX + pixelInTileX / 256;
    const continuousTileY = tileY + pixelInTileY / 256;
    const n = Math.pow(2, zoom);
    const lon = (continuousTileX / n) * 360 - 180;
    const latRad = Math.atan(Math.sinh(Math.PI * (1 - 2 * continuousTileY / n)));
    const lat = (latRad * 180) / Math.PI;
    return { lon, lat };
  };
  
  const labelBufferDegrees = 0.006;
  finalCanvas.scan(0, 0, finalCanvas.width, finalCanvas.height, (x, y, idx) => {
    const { lon, lat } = canvasToGeo(x, y);
    const inIsland = isPointInPolygon(lon, lat, aeginaRing) || isPointInPolygon(lon, lat, moniRing);
    
    let alpha = 255;
    if (!inIsland) {
      const distAegina = distanceToPolygon(lon, lat, aeginaRing);
      const distMoni = distanceToPolygon(lon, lat, moniRing);
      const minDist = Math.min(distAegina, distMoni);
      if (minDist < labelBufferDegrees) {
        alpha = Math.round((1 - minDist / labelBufferDegrees) * 255);
      } else {
        alpha = 0;
      }
    }
    
    // Set alpha channel
    finalCanvas.bitmap.data[idx + 3] = alpha;
  });
  
  // Save to file
  const outputDir = path.join(__dirname, 'public', 'map-textures');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const filename = `${tileSource}_z${zoom}.png`;
  const filepath = path.join(outputDir, filename);
  await finalCanvas.write(filepath);
  console.log(`  ✓ Saved ${filename} (${finalCanvas.width}×${finalCanvas.height})`);
};

const main = async () => {
  const mapSources = ['osm', 'satellite', 'watercolor'];
  const zooms = [11, 12, 13];
  
  for (const source of mapSources) {
    for (const zoom of zooms) {
      try {
        await generateTexture(source, zoom);
      } catch (error) {
        console.error(`Failed to generate ${source} zoom ${zoom}:`, error);
      }
    }
  }
  
  console.log('\n✓ All map textures generated successfully!');
};

main();
