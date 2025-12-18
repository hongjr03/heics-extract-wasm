# heics-extract-wasm

Build a minimal `ffmpeg.wasm` focused on:

- input: `.heics` (HEIF/ISOBMFF via `mov` demuxer)
- decode: `hevc` main track + `hevc` rext (aux/alpha) track
- filters: `alphamerge` (+ minimal GIF palette filters)
- output: PNG sequence or transparent GIF

## Prerequisites

- FFmpeg source checkout at `./FFmpeg` (expects `FFmpeg/configure` to exist and be executable)
- Emscripten toolchain in `PATH` (`emcc`, `emar`, `emranlib`, `emnm`, ...)

## Build

```bash
./scripts/build-ffmpeg-wasm-heics.sh
```

### Optional build switches

- `THREADS=0|1` (default: `0`)

  - `0`: build without WebAssembly pthreads (easier to integrate, fewer runtime constraints)
  - `1`: build with pthreads (requires cross-origin isolation in browsers; see script comments)

- `SIMD=0|1` (default: `1`)

  - `1`: enable wasm SIMD (`-msimd128`)
  - `0`: disable SIMD for wider compatibility

Examples:

```bash
# Default (single-thread, SIMD on)
./scripts/build-ffmpeg-wasm-heics.sh

# Disable SIMD (compat mode)
SIMD=0 ./scripts/build-ffmpeg-wasm-heics.sh

# Enable threads (pthreads build)
THREADS=1 ./scripts/build-ffmpeg-wasm-heics.sh
```

## Artifacts

Build outputs are written to:

- `dist/ffmpeg.js`
- `dist/ffmpeg.wasm`

## ffmpeg command examples (reference)

These commands describe the intended filtergraph and stream mapping for typical HEICS inputs.

### HEICS -> PNG sequence (RGBA)

```bash
ffmpeg -i input.heics \
  -filter_complex "[0:2][0:3]alphamerge,format=rgba[v]" \
  -map "[v]" \
  out_%03d.png
```

### HEICS -> transparent GIF

```bash
ffmpeg -i input.heics \
  -filter_complex "[0:2][0:3]alphamerge,split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse[v]" \
  -map "[v]" \
  -loop 0 \
  out.gif
```

## Notes

- HEICS files often include a 1-fps poster stream; for iMessage stickers the animated color+alpha tracks are commonly stream `0:2` (Main) and `0:3` (Rext/alpha). Use `ffprobe -hide_banner input.heics` to confirm.
- The build is intentionally minimal (`--disable-everything`) and only enables the components required for HEICS (HEVC-in-MOV) decode, alpha merge, and PNG/GIF output.
