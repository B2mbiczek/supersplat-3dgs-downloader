# SuperSplat 3DGS Downloader

A lightweight, autonomous, cross-platform Node.js utility to download and convert SuperSplat 3D Gaussian Splatting scenes directly into standard `.ply` files—even when the direct download button is disabled in the web interface.

## Features
- **Smart URL & CDN Resolution**: Automatically normalizes `superspl.at/scene/...` and `superspl.at/s?id=...` links, raw scene IDs, or direct CloudFront URLs.
- **Multi-Format Architecture Detection**: Supports **Streamed SOG** (`lod-meta.json`), **Standard SOG** (`meta.json`), and direct single-file models (`.sog`, `.compressed.ply`, `.ply`, `.splat`).
- **Exact Manifest Parsing**: Fetches only the exact assets listed in scene manifests instead of brute-forcing chunk grids, resulting in fast, error-free downloads.
- **Bypass UI Restrictions**: Allows programmatic access and conversion of public scenes even when direct download is disabled in the web interface.
- **Automated Conversion & Cleanup**: Uses `@playcanvas/splat-transform` under the hood to compile assets into a clean `.ply` output file and automatically removes temporary files afterward.

## Prerequisites
- **Node.js v18.0.0** or higher ([Download Node.js LTS](https://nodejs.org/))

## Usage

### Windows
1. Download or clone this repository into a local folder.
2. Double-click **`start.bat`** *(dependencies install automatically on the first run)*.
3. Paste the SuperSplat scene link or ID when prompted.
4. The final `model_<id>_<version>.ply` file will be saved directly in the project root directory.

### macOS / Linux
```bash
chmod +x start.sh
./start.sh

## License

MIT
