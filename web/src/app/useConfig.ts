import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_CONFIG,
  mergeConfig,
  type Config,
} from "@shared/index.js";

const KEY = "skylight-ar-config-v1";

function load(): Config {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return mergeConfig(DEFAULT_CONFIG, JSON.parse(raw) as Partial<Config>);
  } catch {
    /* ignore corrupt storage */
  }
  return DEFAULT_CONFIG;
}

/**
 * Per-device config persisted to localStorage (the app has no LAN server
 * anymore). `patch` deep-merges a partial config; the returned `config` is the
 * live source of truth.
 */
export function useConfig(): {
  config: Config;
  patch: (p: Partial<Config>) => void;
  setConfig: (c: Config) => void;
  reset: () => void;
  ref: { current: Config };
} {
  const [config, setConfigState] = useState<Config>(load);
  const ref = useRef(config);
  ref.current = config;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(config));
    } catch {
      /* storage full / disabled */
    }
  }, [config]);

  const patch = useCallback((p: Partial<Config>) => {
    setConfigState((c) => mergeConfig(c, p));
  }, []);

  const setConfig = useCallback((c: Config) => setConfigState(c), []);

  const reset = useCallback(() => setConfigState(DEFAULT_CONFIG), []);

  return { config, patch, setConfig, reset, ref };
}
