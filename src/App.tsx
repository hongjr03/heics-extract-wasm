import { useState, useEffect, useRef, useCallback } from 'react';
import { Upload, Download, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Toaster } from "@/components/ui/toaster";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';

type OutputFormat = 'gif' | 'apng' | 'webp';

const formatInfo: Record<OutputFormat, { label: string; ext: string; mime: string; desc: string }> = {
  gif: { label: 'GIF', ext: 'gif', mime: 'image/gif', desc: '256 colors, wide support' },
  apng: { label: 'APNG', ext: 'png', mime: 'image/png', desc: 'Lossless, full color' },
  webp: { label: 'WebP', ext: 'webp', mime: 'image/webp', desc: 'Best compression' },
};

function App() {
  const [ready, setReady] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState('');
  const [outputFormat, setOutputFormat] = useState<OutputFormat>('gif');
  const [scale128, setScale128] = useState(false);
  const [fps10, setFps10] = useState(false);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const downloadLinkRef = useRef<HTMLAnchorElement | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const loadFFmpeg = async () => {
      try {
        const ffmpeg = new FFmpeg();
        ffmpegRef.current = ffmpeg;

        ffmpeg.on('log', ({ message }) => {
          console.log('[FFmpeg]', message);
        });

        // Load FFmpeg core from CDN
        const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
        await ffmpeg.load({
          coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
          wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });

        setReady(true);
        console.log("FFmpeg WASM loaded");
      } catch (err) {
        console.error("Failed to load FFmpeg", err);
        setError("Failed to load FFmpeg WASM module.");
        toast({
          variant: "destructive",
          title: "System Error",
          description: "Could not load video processing engine.",
        });
      }
    };

    loadFFmpeg();
  }, [toast]);

  const handleConvert = useCallback(async (selectedFile: File, format: OutputFormat, shouldScale: boolean, shouldLimitFps: boolean) => {
    if (!selectedFile || !ffmpegRef.current) return;

    setConverting(true);
    setOutputUrl(null);
    setError(null);
    setProgress(0);

    try {
      const ffmpeg = ffmpegRef.current;
      const inputFileName = 'input.heics';
      const formatConfig = formatInfo[format];
      const outputFileName = `output.${formatConfig.ext}`;

      // Build filter parts
      const scaleFilterPart = shouldScale ? ",scale='min(128,iw)':min'(128,ih)':force_original_aspect_ratio=decrease" : '';
      const fpsFilterPart = shouldLimitFps ? ',fps=10' : '';
      const combinedFilter = `${scaleFilterPart}${fpsFilterPart}`;

      // Write file to virtual FS
      setProgressLabel('Loading file...');
      setProgress(10);
      await ffmpeg.writeFile(inputFileName, await fetchFile(selectedFile));

      setProgressLabel('Converting...');
      setProgress(30);

      let exitCode = -1;

      if (format === 'gif') {
        exitCode = await ffmpeg.exec([
          '-i', inputFileName,
          '-filter_complex',
          `[0:v:2][0:v:3]alphamerge${combinedFilter},split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=dither=none`,
          '-gifflags', '+transdiff',
          '-y',
          outputFileName
        ]);

        if (exitCode !== 0) {
          exitCode = await ffmpeg.exec([
            '-i', inputFileName,
            '-filter_complex',
            `[0:v:0][0:v:1]alphamerge${combinedFilter},split[s0][s1];[s0]palettegen=reserve_transparent=1[p];[s1][p]paletteuse=dither=none`,
            '-gifflags', '+transdiff',
            '-y',
            outputFileName
          ]);
        }

        if (exitCode !== 0) {
          let vfFilter = 'split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse';
          if (shouldScale) vfFilter = "scale='min(128,iw)':min'(128,ih)':force_original_aspect_ratio=decrease," + vfFilter;
          if (shouldLimitFps) vfFilter = 'fps=10,' + vfFilter;
          exitCode = await ffmpeg.exec([
            '-i', inputFileName,
            '-vf', vfFilter,
            '-y',
            outputFileName
          ]);
        }
      } else if (format === 'apng') {
        exitCode = await ffmpeg.exec([
          '-i', inputFileName,
          '-filter_complex',
          `[0:v:2][0:v:3]alphamerge${combinedFilter}`,
          '-f', 'apng',
          '-plays', '0',
          '-y',
          outputFileName
        ]);

        if (exitCode !== 0) {
          exitCode = await ffmpeg.exec([
            '-i', inputFileName,
            '-filter_complex',
            `[0:v:0][0:v:1]alphamerge${combinedFilter}`,
            '-f', 'apng',
            '-plays', '0',
            '-y',
            outputFileName
          ]);
        }

        if (exitCode !== 0) {
          const filters: string[] = [];
          if (shouldLimitFps) filters.push('fps=10');
          if (shouldScale) filters.push("scale='min(128,iw)':min'(128,ih)':force_original_aspect_ratio=decrease");
          const args = ['-i', inputFileName];
          if (filters.length > 0) args.push('-vf', filters.join(','));
          args.push('-f', 'apng', '-plays', '0', '-y', outputFileName);
          exitCode = await ffmpeg.exec(args);
        }
      } else if (format === 'webp') {
        exitCode = await ffmpeg.exec([
          '-i', inputFileName,
          '-filter_complex',
          `[0:v:2][0:v:3]alphamerge${combinedFilter}`,
          '-c:v', 'libwebp',
          '-lossless', '1',
          '-loop', '0',
          '-y',
          outputFileName
        ]);

        if (exitCode !== 0) {
          exitCode = await ffmpeg.exec([
            '-i', inputFileName,
            '-filter_complex',
            `[0:v:0][0:v:1]alphamerge${combinedFilter}`,
            '-c:v', 'libwebp',
            '-lossless', '1',
            '-loop', '0',
            '-y',
            outputFileName
          ]);
        }

        if (exitCode !== 0) {
          const filters: string[] = [];
          if (shouldLimitFps) filters.push('fps=10');
          if (shouldScale) filters.push("scale='min(128,iw)':min'(128,ih)':force_original_aspect_ratio=decrease");
          const args = ['-i', inputFileName];
          if (filters.length > 0) args.push('-vf', filters.join(','));
          args.push('-c:v', 'libwebp', '-lossless', '1', '-loop', '0', '-y', outputFileName);
          exitCode = await ffmpeg.exec(args);
        }
      }

      console.log('Conversion exit code:', exitCode);
      setProgress(80);

      if (exitCode !== 0) {
        throw new Error(`Conversion failed`);
      }

      // Read output
      setProgressLabel('Finalizing...');
      const data = await ffmpeg.readFile(outputFileName);
      const uint8Data = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
      const blob = new Blob([uint8Data.buffer], { type: formatConfig.mime });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setProgress(100);

      // Auto download
      const downloadName = selectedFile.name.replace(/\.[^/.]+$/, "") + "." + formatConfig.ext;
      const link = document.createElement('a');
      link.href = url;
      link.download = downloadName;
      link.click();

      toast({
        title: "Done!",
        description: `Your ${formatConfig.label} has been downloaded.`,
      });

      // Cleanup
      try {
        await ffmpeg.deleteFile(inputFileName);
        await ffmpeg.deleteFile(outputFileName);
      } catch (e) {
        // Cleanup errors are not critical
      }

    } catch (err: any) {
      console.error("Conversion failed", err);
      setError("Conversion failed. The file might be corrupted or incompatible.");
      toast({
        variant: "destructive",
        title: "Conversion Failed",
        description: err.message || "An unexpected error occurred.",
      });
    } finally {
      setConverting(false);
      setProgressLabel('');
    }
  }, [toast]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!ready || converting) return;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const selectedFile = e.dataTransfer.files[0];
      if (!selectedFile.name.toLowerCase().endsWith('.heic') && !selectedFile.name.toLowerCase().endsWith('.heics')) {
        toast({
          variant: "destructive",
          title: "Invalid File",
          description: "Please upload a .heic or .heics file.",
        });
        return;
      }
      setFile(selectedFile);
      setOutputUrl(null);
      setError(null);
      // Auto-start conversion
      handleConvert(selectedFile, outputFormat, scale128, fps10);
    }
  }, [ready, converting, outputFormat, scale128, fps10, handleConvert, toast]);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (!ready || converting) return;

    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      if (!selectedFile.name.toLowerCase().endsWith('.heic') && !selectedFile.name.toLowerCase().endsWith('.heics')) {
        toast({
          variant: "destructive",
          title: "Invalid File",
          description: "Please upload a .heic or .heics file.",
        });
        return;
      }
      setFile(selectedFile);
      setOutputUrl(null);
      setError(null);
      // Auto-start conversion
      handleConvert(selectedFile, outputFormat, scale128, fps10);
    }
    // Reset input
    e.target.value = '';
  }, [ready, converting, outputFormat, scale128, fps10, handleConvert, toast]);

  const reset = () => {
    setFile(null);
    setOutputUrl(null);
    setError(null);
    setProgress(0);
  };

  const format = formatInfo[outputFormat];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center justify-center p-2 sm:p-4 font-sans selection:bg-primary/20">
      <div className="absolute inset-0 bg-[linear-gradient(to_right,hsl(var(--border)/0.3)_1px,transparent_1px),linear-gradient(to_bottom,hsl(var(--border)/0.3)_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none"></div>

      {/* Full-screen drop zone */}
      <div
        onDrop={!outputUrl ? onDrop : undefined}
        onDragOver={!outputUrl ? onDragOver : undefined}
        onClick={() => !converting && !outputUrl && document.getElementById('file-upload')?.click()}
        className={cn(
          "z-10 w-full h-[calc(100vh-16px)] sm:h-[calc(100vh-32px)] border-2 border-dashed rounded-2xl transition-all flex flex-col items-center justify-center gap-6 sm:gap-8",
          ready && !converting && !outputUrl ? "border-border hover:border-muted-foreground cursor-pointer hover:bg-accent/30" : "border-border/50",
          (converting || outputUrl) && "cursor-default"
        )}
      >
        {/* Header - hide when done */}
        {!outputUrl && (
          <div className="text-center space-y-2 sm:space-y-3">
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tighter bg-gradient-to-br from-foreground to-muted-foreground bg-clip-text text-transparent">
              HEICS Converter
            </h1>
            <p className="text-muted-foreground text-base sm:text-lg">Convert animated Live Photos to GIF, APNG, or WebP with transparency</p>
          </div>
        )}

        {/* Format Selection - hide when done */}
        {!outputUrl && (
          <div className="flex flex-col items-center gap-2 sm:gap-3">
            <div className="flex flex-wrap gap-2 justify-center">
              {(Object.keys(formatInfo) as OutputFormat[]).map((fmt) => (
                <button
                  key={fmt}
                  onClick={(e) => { e.stopPropagation(); setOutputFormat(fmt); }}
                  disabled={converting}
                  className={cn(
                    "px-3 py-2 sm:px-4 rounded-lg border transition-all text-sm font-medium",
                    outputFormat === fmt
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-secondary/50 text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                  )}
                >
                  {formatInfo[fmt].label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2 justify-center">
              <button
                onClick={(e) => { e.stopPropagation(); setScale128(!scale128); }}
                disabled={converting}
                className={cn(
                  "px-2 py-1.5 sm:px-3 rounded-md border transition-all text-xs font-medium",
                  scale128
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/30 text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                )}
              >
                {scale128 ? "✓ " : ""}128px
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setFps10(!fps10); }}
                disabled={converting}
                className={cn(
                  "px-2 py-1.5 sm:px-3 rounded-md border transition-all text-xs font-medium",
                  fps10
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-secondary/30 text-muted-foreground hover:border-muted-foreground hover:text-foreground"
                )}
              >
                {fps10 ? "✓ " : ""}10fps
              </button>
            </div>
          </div>
        )}

        {/* Status Area */}
        {!ready && (
          <div className="flex items-center gap-2 sm:gap-3 text-muted-foreground">
            <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" />
            <span>Loading converter engine...</span>
          </div>
        )}

        {ready && !converting && !outputUrl && (
          <div className="flex flex-col items-center gap-3 sm:gap-4">
            <div className="p-4 sm:p-6 rounded-full bg-secondary/50 border border-border">
              <Upload className="w-8 h-8 sm:w-12 sm:h-12 text-muted-foreground" />
            </div>
            <div className="text-center">
              <p className="font-medium text-foreground">Drop HEICS file here or click to browse</p>
              <p className="text-sm text-muted-foreground mt-1">Supports .heic, .heics Live Photo stickers</p>
            </div>
          </div>
        )}

        {converting && (
          <div className="flex flex-col items-center gap-3 sm:gap-4 w-full max-w-sm sm:max-w-md">
            <div className="flex items-center gap-2 sm:gap-3 text-foreground">
              <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin text-primary" />
              <span>{progressLabel}</span>
            </div>
            <Progress value={progress} className="h-2 w-full" />
            <p className="text-sm text-muted-foreground">{file?.name}</p>
          </div>
        )}

        {outputUrl && !converting && (
          <div className="flex flex-col items-center gap-4 sm:gap-6 animate-in fade-in zoom-in duration-300">
            <div className="flex items-center gap-2 sm:gap-3 text-green-600 dark:text-green-400">
              <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6" />
              <span className="text-base sm:text-lg font-medium">Conversion Complete!</span>
            </div>

            <div className="relative rounded-xl overflow-hidden border border-border bg-center w-full max-w-sm sm:max-w-md">
              <div className="absolute inset-0 opacity-20 bg-[linear-gradient(45deg,hsl(var(--muted-foreground))_25%,transparent_25%,transparent_75%,hsl(var(--muted-foreground))_75%,hsl(var(--muted-foreground))),linear-gradient(45deg,hsl(var(--muted-foreground))_25%,transparent_25%,transparent_75%,hsl(var(--muted-foreground))_75%,hsl(var(--muted-foreground)))] bg-[length:16px_16px] bg-[position:0_0,8px_8px]"></div>
              <img src={outputUrl} alt={`Converted ${format.label}`} className="relative z-10 max-w-full max-h-[200px] sm:max-h-[300px] object-contain" />
            </div>

            <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
              <Button asChild>
                <a ref={downloadLinkRef} href={outputUrl} download={file?.name.replace(/\.[^/.]+$/, "") + "." + format.ext}>
                  <Download className="w-4 h-4 mr-2" /> Download Again
                </a>
              </Button>
              <Button variant="outline" onClick={reset}>
                Convert Another
              </Button>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 sm:p-4 flex items-center gap-2 sm:gap-3 text-destructive w-full max-w-sm sm:max-w-md">
            <AlertCircle className="w-4 h-4 sm:w-5 sm:h-5 flex-shrink-0" />
            <div>
              <p className="font-medium">Conversion Failed</p>
              <p className="text-sm opacity-80 mt-1">{error}</p>
            </div>
          </div>
        )}
        {/* Footer - inside drop zone, hide when done */}
        {!outputUrl && (
          <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-2 text-center">
            {ready ? (
              <Badge variant="outline" className="bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20">
                Engine Ready
              </Badge>
            ) : (
              <Badge variant="secondary" className="animate-pulse">Loading...</Badge>
            )}
            <span className="text-muted-foreground/50 text-sm hidden sm:inline">•</span>
            <span className="text-muted-foreground text-xs sm:text-sm">All processing happens locally in your browser</span>
          </div>
        )}

        <input
          id="file-upload"
          type="file"
          className="hidden"
          accept=".heic,.heics"
          onChange={handleFileSelect}
        />
      </div>

      <Toaster />
    </div>
  );
}

export default App;
