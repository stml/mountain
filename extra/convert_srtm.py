#!/usr/bin/env python3
"""
Convert SRTM elevation data to JSON for Aegina island visualization
Usage: python convert_srtm.py N37E023.tif
"""

import sys
import json
import numpy as np

try:
    import rasterio
    from rasterio.transform import rowcol
except ImportError:
    print("Error: rasterio not installed")
    print("Install with: pip install rasterio")
    sys.exit(1)

def convert_srtm_to_json(input_file, output_file="aegina_elevation.json"):
    """Convert SRTM GeoTIFF to JSON elevation data"""
    
    print(f"Reading {input_file}...")
    
    with rasterio.open(input_file) as src:
        # Read the elevation data
        elevation = src.read(1)
        
        print(f"File bounds: {src.bounds}")
        print(f"Resolution: {src.res}")
        print(f"Size: {src.width} x {src.height}")
        print(f"Transform: {src.transform}")
        
        # EXACT Aegina + Moni bounds from OpenStreetMap
        aegina_lon_min = 23.4174315
        aegina_lon_max = 23.5652998
        aegina_lat_min = 37.6735755
        aegina_lat_max = 37.775114
        
        print(f"\nExtracting Aegina region:")
        print(f"  Lon: {aegina_lon_min} to {aegina_lon_max}")
        print(f"  Lat: {aegina_lat_min} to {aegina_lat_max}")
        
        # Use rasterio's rowcol function for correct coordinate conversion
        # rowcol returns (row, col) from (x=lon, y=lat)
        row_min, col_min = rowcol(src.transform, aegina_lon_min, aegina_lat_max)
        row_max, col_max = rowcol(src.transform, aegina_lon_max, aegina_lat_min)
        
        # Ensure correct ordering
        row_start = min(row_min, row_max)
        row_end = max(row_min, row_max)
        col_start = min(col_min, col_max)
        col_end = max(col_min, col_max)
        
        print(f"  Pixel range: rows {row_start}-{row_end}, cols {col_start}-{col_end}")
        
        # Extract the subset
        elevation_subset = elevation[row_start:row_end, col_start:col_end]
        
        print(f"  Extracted size: {elevation_subset.shape}")
        print(f"  Elevation range in subset: {np.min(elevation_subset)} to {np.max(elevation_subset)}")
        
        # Verify a known point - center of Aegina roughly (Mount Oros area)
        test_lon = 23.49
        test_lat = 37.72
        test_row, test_col = rowcol(src.transform, test_lon, test_lat)
        test_elev = elevation[test_row, test_col]
        print(f"\nTest point ({test_lon}, {test_lat}):")
        print(f"  Pixel: row={test_row}, col={test_col}")
        print(f"  Elevation: {test_elev}m (should be 200-500m for Aegina)")
        
        # Sample every Nth point to reduce file size
        sample_rate = 3
        elevation_sampled = elevation_subset[::sample_rate, ::sample_rate]
        
        print(f"\nSampled size: {elevation_sampled.shape}")
        
        # Calculate the actual geographic bounds of our sampled data
        # Top-left corner of sampled grid
        output_lat_max = src.transform * (col_start, row_start)
        # Bottom-right corner of sampled grid
        output_lat_min = src.transform * (col_end, row_end)
        
        # Build the output data structure
        output_data = {
            "bounds": {
                "lon_min": aegina_lon_min,
                "lon_max": aegina_lon_max,
                "lat_min": aegina_lat_min,
                "lat_max": aegina_lat_max
            },
            "resolution": {
                "rows": elevation_sampled.shape[0],
                "cols": elevation_sampled.shape[1]
            },
            "elevations": elevation_sampled.tolist()
        }
        
        # Write to JSON
        print(f"\nWriting {output_file}...")
        with open(output_file, 'w') as f:
            json.dump(output_data, f)
        
        print(f"Done! Created {output_file}")
        print(f"File size: {len(json.dumps(output_data)) / 1024:.1f} KB")
        print(f"\nElevation stats (sampled):")
        print(f"  Min: {np.min(elevation_sampled):.1f}m")
        print(f"  Max: {np.max(elevation_sampled):.1f}m")
        print(f"  Mean: {np.mean(elevation_sampled):.1f}m")
        
        # Count land vs water
        land_pixels = np.sum(elevation_sampled > 0)
        total_pixels = elevation_sampled.size
        print(f"  Land pixels: {land_pixels}/{total_pixels} ({100*land_pixels/total_pixels:.1f}%)")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert_srtm.py <input_file.tif>")
        print("Example: python convert_srtm.py N37E023.tif")
        sys.exit(1)
    
    input_file = sys.argv[1]
    convert_srtm_to_json(input_file)