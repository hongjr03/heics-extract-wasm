#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
FFMPEG_SRC_DIR="${ROOT_DIR}/FFmpeg"
BUILD_DIR="${ROOT_DIR}/build/ffmpeg-wasm-heics"
DIST_DIR="${ROOT_DIR}/dist"

if [[ ! -x "${FFMPEG_SRC_DIR}/configure" ]]; then
  echo "FFmpeg source not found at: ${FFMPEG_SRC_DIR}" >&2
  exit 1
fi

command -v emcc >/dev/null
command -v emar >/dev/null
command -v emranlib >/dev/null

mkdir -p "${BUILD_DIR}" "${DIST_DIR}"

JOBS="${JOBS:-}"
if [[ -z "${JOBS}" ]]; then
  if command -v sysctl >/dev/null; then
    JOBS="$(sysctl -n hw.ncpu)"
  else
    JOBS="4"
  fi
fi

# Optional switches:
#   THREADS=1   -> enable pthreads (requires COOP/COEP on the site)
#   SIMD=0      -> disable wasm simd for compatibility
THREADS="${THREADS:-0}"
SIMD="${SIMD:-1}"

EXTRA_CFLAGS=(
  -O3
  -DNDEBUG
)

EXTRA_LDFLAGS=(
  -O3
  -sUSE_ZLIB=1

  # ESM modular output for modern bundlers
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sEXPORT_NAME=createFFmpeg

  # Keep runtime alive for repeated calls
  -sINVOKE_RUN=0
  -sNO_EXIT_RUNTIME=1
  -sEXIT_RUNTIME=0

  # Filesystem + CLI entry
  -sFORCE_FILESYSTEM=1
  -sEXPORTED_RUNTIME_METHODS=FS,callMain

  # Memory (tune as needed)
  -sINITIAL_MEMORY=536870912
  -sSTACK_SIZE=5242880

  # Make filenames predictable and controllable without patching JS
  -sWASM=1
  -sSINGLE_FILE=0
)

if [[ "${SIMD}" == "1" ]]; then
  EXTRA_CFLAGS+=(-msimd128)
  EXTRA_LDFLAGS+=(-msimd128)
fi

if [[ "${THREADS}" == "1" ]]; then
  # Note: enabling threads requires cross-origin isolation (COOP/COEP) in production.
  EXTRA_CFLAGS+=(-pthread)
  EXTRA_LDFLAGS+=(
    -pthread
    -sUSE_PTHREADS=1
    -sPTHREAD_POOL_SIZE=4
  )
else
  # Be explicit: avoid accidentally pulling in pthreads
  EXTRA_LDFLAGS+=(-sUSE_PTHREADS=0)
fi

cd "${BUILD_DIR}"

if [[ -f Makefile ]]; then
  make distclean || true
fi

"${FFMPEG_SRC_DIR}/configure" \
  --target-os=none \
  --arch=wasm32 \
  --enable-cross-compile \
  --cc=emcc \
  --cxx=em++ \
  --ar=emar \
  --ranlib=emranlib \
  --nm=emnm \
  --disable-autodetect \
  --disable-debug \
  --disable-stripping \
  --disable-doc \
  --disable-network \
  --enable-zlib \
  --disable-ffprobe \
  --disable-ffplay \
  --disable-everything \
  --enable-ffmpeg \
  --enable-avcodec \
  --enable-avformat \
  --enable-avfilter \
  --enable-swscale \
  --enable-avutil \
  --disable-avdevice \
  --disable-swresample \
  --enable-decoder=hevc \
  --enable-parser=hevc \
  --enable-bsf=hevc_mp4toannexb \
  --enable-demuxer=mov \
  --enable-protocol=file \
  --enable-protocol=pipe \
  --enable-filter=alphamerge \
  --enable-filter=format \
  --enable-filter=split \
  --enable-filter=palettegen \
  --enable-filter=paletteuse \
  --enable-filter=fps \
  --enable-filter=scale \
  --enable-encoder=png \
  --enable-encoder=gif \
  --enable-muxer=image2 \
  --enable-muxer=gif \
  --extra-cflags="${EXTRA_CFLAGS[*]}" \
  --extra-ldflags="${EXTRA_LDFLAGS[*]}"

make -j"${JOBS}" ffmpeg

# Build output binary name is typically "ffmpeg" in the build dir.
# Link it into stable front-end artifacts.
cp -f "${BUILD_DIR}/ffmpeg" "${DIST_DIR}/ffmpeg.js"
cp -f "${BUILD_DIR}/ffmpeg.wasm" "${DIST_DIR}/ffmpeg.wasm"

# Sanity checks
test -s "${DIST_DIR}/ffmpeg.js"
test -s "${DIST_DIR}/ffmpeg.wasm"

echo "Built:"
echo "  ${DIST_DIR}/ffmpeg.js"
echo "  ${DIST_DIR}/ffmpeg.wasm"
echo "Options:"
echo "  THREADS=${THREADS} (1 requires COOP/COEP)"
echo "  SIMD=${SIMD} (0 for compatibility)"
