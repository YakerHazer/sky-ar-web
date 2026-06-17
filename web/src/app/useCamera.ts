import { useCallback, useEffect, useRef, useState } from "react";

export type CameraStatus = "idle" | "requesting" | "granted" | "denied" | "unsupported" | "error";

export interface CameraState {
  stream: MediaStream | null;
  status: CameraStatus;
  error?: string;
}

/**
 * Acquire the back ("environment") camera. Mobile browsers require HTTPS + a
 * user gesture for `getUserMedia`; iOS Safari additionally needs it inside the
 * tap handler that starts the experience. The returned stream is attached to a
 * <video> by the caller.
 */
export function useCamera(): CameraState & { request: () => Promise<void> } {
  const [state, setState] = useState<CameraState>({
    stream: null,
    status: typeof navigator === "undefined" || !navigator.mediaDevices ? "unsupported" : "idle",
  });
  const streamRef = useRef<MediaStream | null>(null);

  const request = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({ stream: null, status: "unsupported" });
      return;
    }
    setState((s) => ({ ...s, status: "requesting" }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setState({ stream, status: "granted" });
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        setState({ stream: null, status: "denied", error: err.message });
      } else {
        setState({ stream: null, status: "error", error: err?.message ?? String(e) });
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return { ...state, request };
}
