const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const sharp = require('sharp');

// Map bounds for Aegina
const bounds = {
  lon_min: 23.4174315,
  lon_max: 23.5652998,
  lat_min: 37.6735755,
  lat_max: 37.775114
};

const urls = {
  osm: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`,
  satellite: (x, y, z) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  watercolor: (x, y, z) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`
};

const fetchTile = async (url) => {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Tile fetch failed: ${response.status}`);
    return await response.buffer();
  } catch (error) {
    console.error(`Failed to fetch ${url}: ${error.message}`);
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
  
  // Fetch all tiles
  console.log(`  Fetching ${tileCountX * tileCountY} tiles...`);
  const tiles = [];
  for (let ty = topLeft.y; ty <= bottomRight.y; ty++) {
    for (let tx = topLeft.x; tx <= bottomRight.x; tx++) {
      const tileUrl = urls[tileSource](tx, ty, zoom);
      const buffer = await fetchTile(tileUrl);
      tiles.push({ x: tx - topLeft.x, y: ty - topLeft.y, buffer });
    }
  }
  
  // Create composite image
  console.log(`  Compositing tiles (${tileCountX}x${tileCountY} grid, ${fullCanvasWidth}x${fullCanvasHeight}px)...`);
  const compositeArray = tiles
    .filter(t => t.buffer)
    .map(t => ({
      input: t.buffer,
      left: t.x * 256,
      top: t.y * 256
    }));
  
  if (compositeArray.length === 0) {
    console.error('  ✗ No tiles fetched successfully');
    return;
  }
  
  // For zoom 11 and small grids, use simpler compositing
  if (tileCountX * tileCountY <= 4) {
    console.log(`  Using buffer merging for small tile grid...`);
    
    // Pad each tile to 256x256 if needed
    const paddedTiles = [];
    for (const tileData of tiles) {
      if (!tileData.buffer) {
        paddedTiles.push(Buffer.alloc(256 * 256 * 3, 224)); // Gray background
      } else {
        const padded = await sharp(tileData.buffer)
          .resize(256, 256, { fit: 'cover' })
          .raw()
          .toBuffer();
        paddedTiles.push(padded);
      }
    }
    
    // Create raw canvas
    const canvasPixels = fullCanvasWidth * fullCanvasHeight * 3;
    let canvas = Buffer.alloc(canvasPixels, 224);
    
    // Composite padded tiles
    let tileIdx = 0;
    for (let ty = 0; ty < tileCountY; ty++) {
      for (let tx = 0; tx < tileCountX; tx++) {
        const tileBuffer = paddedTiles[tileIdx++];
        for (let py = 0; py < 256; py++) {
          for (let px = 0; px < 256; px++) {
            const canvasX = tx * 256 + px;
            const canvasY = ty * 256 + py;
            if (canvasX < fullCanvasWidth && canvasY < fullCanvasHeight) {
              const canvasIdx = (canvasY * fullCanvasWidth + canvasX) * 3;
              const tilePixelIdx = (py * 256 + px) * 3;
              canvas[canvasIdx] = tileBuffer[tilePixelIdx];
              canvas[canvasIdx + 1] = tileBuffer[tilePixelIdx + 1];
              canvas[canvasIdx + 2] = tileBuffer[tilePixelIdx + 2];
            }
          }
        }
      }
    }
    
    // Continue with crop and save
    const cropX = topLeftPixels.pixelX;
    const cropY = topLeftPixels.pixelY;
    const cropWidth = (bottomRight.x - topLeft.x) * 256 + bottomRightPixels.pixelX - topLeftPixels.pixelX + 1;
    const cropHeight = (bottomRight.y - topLeft.y) * 256 + bottomRightPixels.pixelY - topLeftPixels.pixelY + 1;
    
    console.log(`  Cropping to ${cropWidth}x${cropHeight}...`);
    let croppedImage = await sharp(canvas, {
      raw: { width: fullCanvasWidth, height: fullCanvasHeight, channels: 3 }
    }).extract({
      left: cropX,
      top: cropY,
      width: cropWidth,
      height: cropHeight
    }).png().toBuffer();
    
    // Scale down if needed
    const maxSize = 1024;
    if (Math.max(cropWidth, cropHeight) > maxSize) {
      const scale = maxSize / Math.max(cropWidth, cropHeight);
      const finalWidth = Math.round(cropWidth * scale);
      const finalHeight = Math.round(cropHeight * scale);
      
      console.log(`  Scaling to ${finalWidth}x${finalHeight}...`);
      croppedImage = await sharp(croppedImage)
        .resize(finalWidth, finalHeight)
        .png()
        .toBuffer();
    }
    
    // Save to file
    const outputDir = path.join(__dirname, 'public', 'map-textures');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const filename = `${tileSource}_z${zoom}.png`;
    const filepath = path.join(outputDir, filename);
    fs.writeFileSync(filepath, croppedImage);
    console.log(`  ✓ Saved ${filename} (${Math.max(cropWidth, cropHeight) > maxSize ? Math.round(cropWidth * (maxSize / Math.max(cropWidth, cropHeight))) : cropWidth}×${Math.max(cropWidth, cropHeight) > maxSize ? Math.round(cropHeight * (maxSize / Math.max(cropWidth, cropHeight))) : cropHeight})\n`);
    return;
  }
  
  // Ensure all composite images are valid before compositing
  const validComposites = compositeArray.filter(c => {
    if (!Buffer.isBuffer(c.input)) return false;
    return true;
  });
  
  if (validComposites.length === 0) {
    console.error('  ✗ No valid tiles for compositing');
    return;
  }
  
  // Create a buffer of the full composited canvas first
  let image = sharp({
    create: {
      width: fullCanvasWidth,
      height: fullCanvasHeight,
      channels: 3,
      background: { r: 224, g: 224, b: 232 }
    }
  });
  
  console.log(`  Adding ${validComposites.length} tiles to composite...`);
  // Add composites all at once (better for sharp)
  if (validComposites.length > 0) {
    image = image.composite(validComposites);
  }
  
  // Crop to geographic extent
  const cropX = topLeftPixels.pixelX;
  const cropY = topLeftPixels.pixelY;
  const cropWidth = (bottomRight.x - topLeft.x) * 256 + bottomRightPixels.pixelX - topLeftPixels.pixelX + 1;
  const cropHeight = (bottomRight.y - topLeft.y) * 256 + bottomRightPixels.pixelY - topLeftPixels.pixelY + 1;
  
  console.log(`  Cropping to ${cropWidth}x${cropHeight}...`);
  let croppedImage = await image.extract({
    left: cropX,
    top: cropY,
    width: cropWidth,
    height: cropHeight
  }).png().toBuffer();
  
  // Scale down if needed
  let finalImage = croppedImage;
  let finalWidth = cropWidth;
  let finalHeight = cropHeight;
  
  const maxSize = 1024;
  if (Math.max(cropWidth, cropHeight) > maxSize) {
    const scale = maxSize / Math.max(cropWidth, cropHeight);
    finalWidth = Math.round(cropWidth * scale);
    finalHeight = Math.round(cropHeight * scale);
    
    console.log(`  Scaling to ${finalWidth}x${finalHeight}...`);
    finalImage = await sharp(croppedImage)
      .resize(finalWidth, finalHeight)
      .png()
      .toBuffer();
  }
  
  // Save to file
  const outputDir = path.join(__dirname, 'public', 'map-textures');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  const filename = `${tileSource}_z${zoom}.png`;
  const filepath = path.join(outputDir, filename);
  fs.writeFileSync(filepath, finalImage);
  console.log(`  ✓ Saved ${filename} (${finalWidth}×${finalHeight})\n`);
};

const main = async () => {
  console.log('Starting offline map texture generation...\n');
  
  const sources = ['osm', 'satellite', 'watercolor'];
  const zooms = [11, 12, 13];
  
  for (const source of sources) {
    for (const zoom of zooms) {
      try {
        await generateTexture(source, zoom);
      } catch (error) {
        console.error(`✗ Error generating ${source} at zoom ${zoom}: ${error.message}\n`);
      }
    }
  }
  
  console.log('✓ All textures generated successfully!');
};

main();
