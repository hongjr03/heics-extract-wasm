# HEICS Converter

Convert animated HEIC/HEICS files (Live Photos) to GIF, APNG, or WebP with transparency support.

## Features

- 🖼️ **Multiple Output Formats**: GIF, APNG (lossless), WebP
- 🔒 **Privacy First**: All processing happens locally in your browser
- ✨ **Transparency Support**: Preserves alpha channel from Live Photos
- ⚡ **Fast**: Uses FFmpeg WebAssembly for client-side conversion
- 🎨 **Auto Dark/Light Mode**: Follows system theme

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Tech Stack

- React + TypeScript
- Vite
- TailwindCSS
- FFmpeg WASM (@ffmpeg/ffmpeg)
- Shadcn/UI Components

## License

MIT
