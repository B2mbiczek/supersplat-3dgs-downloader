# SuperSplat 3DGS Downloader

A lightweight, autonomous Node.js utility to download and convert SuperSplat Gaussian Splatting scenes (both standard and streamed architectures) directly into standard `.ply` files.

## Features
- **Smart URL Normalization**: Automatically handles `superspl.at/scene/...` and `superspl.at/s?id=...` formats.
- **Architecture Detection**: Supports both Standard SOG and Streamed SOG (LOD grid) models.
- **Bypass UI Restrictions**: Allows programmatic access and conversion of scenes even when the direct download option is disabled in the web interface by the author.
- **On-the-Fly Decompression**: Seamlessly manages GZIP-compressed manifests and chunks.
- **Automated Conversion**: Uses `@playcanvas/splat-transform` under the hood to compile assets into a clean `.ply` output file.

## Prerequisites
Make sure you have **Node.js** installed on your system.

## Usage

1. Download or clone this repository into a local folder.
2. Open a terminal or command prompt in the project directory.
3. Run the script:
   ```bash
   npm start
   ```
   *(Or simply double-click `start.bat` on Windows)*
4. Paste the SuperSplat scene link or ID when prompted.
5. The raw structured data will be saved locally in `items_structured/`, and the final `.ply` file will appear right in the project root directory.

## License

MIT
