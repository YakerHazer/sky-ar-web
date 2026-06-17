import { useEffect, useRef } from "react";
import type { Aircraft, Config, CamView, Tle, SourceStatus } from "@shared/index.js";
import { ArRenderer } from "./renderer.js";

interface Props {
  config: Config;
  stream: MediaStream | null;
  aircraft: Aircraft[];
  status: SourceStatus | null;
  tles: Tle[];
  getView: () => CamView | null;
}

/**
 * The live AR viewport: a full-bleed <video> showing the back-camera feed with a
 * transparent <canvas> on top rendered by `ArRenderer`. Props are kept in refs
 * so the renderer's requestAnimationFrame loop always reads the freshest state
 * without re-subscribing.
 */
export function ArView({ config, stream, aircraft, status, tles, getView }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ArRenderer | null>(null);

  const configRef = useRef(config);
  configRef.current = config;
  const tlesRef = useRef(tles);
  tlesRef.current = tles;

  // Create the renderer once.
  useEffect(() => {
    if (!canvasRef.current) return;
    const r = new ArRenderer(
      canvasRef.current,
      () => configRef.current,
      getView,
      () => tlesRef.current,
    );
    rendererRef.current = r;
    r.start();
    const onResize = () => r.resize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      r.stop();
      rendererRef.current = null;
    };
  }, [getView]);

  // Attach the camera stream to the <video>.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (stream && v.srcObject !== stream) {
      v.srcObject = stream;
      void v.play().catch(() => {
        /* autoplay can throw before the first gesture; ignored */
      });
    }
  }, [stream]);

  // Push each snapshot + feed-health to the renderer.
  useEffect(() => {
    rendererRef.current?.update(aircraft);
  }, [aircraft]);

  useEffect(() => {
    rendererRef.current?.setSourceOk(!!status?.ok);
  }, [status]);

  // Keep the canvas matched to the video's rendered size (the video drives the
  // viewport, not the window).
  useEffect(() => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    const ro = new ResizeObserver(() => rendererRef.current?.resize());
    ro.observe(v);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="ar-viewport">
      <video
        ref={videoRef}
        className="ar-video"
        autoPlay
        muted
        playsInline
      />
      <canvas ref={canvasRef} className="ar-canvas" />
    </div>
  );
}
