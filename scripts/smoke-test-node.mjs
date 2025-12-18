import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import createFFmpeg from "../dist/ffmpeg.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const inputPath = path.join(rootDir, "p.heics");
const outGifPath = path.join(rootDir, "dist", "smoke-out.gif");
const outPngDir = path.join(rootDir, "dist", "smoke-frames");

const create = () =>
  createFFmpeg({
    locateFile: (p) => path.join(rootDir, "dist", p),
    print: () => {},
    printErr: () => {},
  });

// Emscripten+ffmpeg is not guaranteed to be safely re-entrant via repeated
// `callMain()` calls in the same instance (input indices can change between
// invocations). Use a fresh module per run.
{
  const ffmpeg = await create();
  ffmpeg.FS.writeFile("in.heics", fs.readFileSync(inputPath));
  ffmpeg.callMain([
    "-y",
    "-i",
    "in.heics",
    "-filter_complex",
    "[0:2][0:3]alphamerge,split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse",
    "-loop",
    "0",
    "out.gif",
  ]);
  fs.writeFileSync(outGifPath, ffmpeg.FS.readFile("out.gif"));
}

{
  const ffmpeg = await create();
  ffmpeg.FS.writeFile("in.heics", fs.readFileSync(inputPath));

  fs.mkdirSync(outPngDir, { recursive: true });

  ffmpeg.callMain([
    "-y",
    "-i",
    "in.heics",
    "-filter_complex",
    "[0:2][0:3]alphamerge,format=rgba",
    // "-frames:v",
    // "10",
    "-start_number",
    "0",
    "out_%03d.png",
  ]);

  const pngNames = ffmpeg.FS.readdir("/")
    .filter((name) => /^out_\d+\.png$/.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const name of pngNames) {
    fs.writeFileSync(path.join(outPngDir, name), ffmpeg.FS.readFile(name));
  }
}

console.log("Wrote:");
console.log(" ", outGifPath);
console.log(" ", outPngDir);
