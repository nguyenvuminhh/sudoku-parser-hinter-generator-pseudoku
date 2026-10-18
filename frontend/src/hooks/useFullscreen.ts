"use client";

import { useEffect, useState } from "react";

type WebkitDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function fullscreenElement() {
  return document.fullscreenElement || (document as WebkitDocument).webkitFullscreenElement;
}

function supportsStandardFullscreen() {
  return document.fullscreenEnabled !== false && typeof document.documentElement.requestFullscreen === "function";
}

function supportsWebkitFullscreen() {
  return (document as WebkitDocument).webkitFullscreenEnabled !== false &&
    typeof (document.documentElement as WebkitElement).webkitRequestFullscreen === "function";
}

export function useFullscreen() {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [standalone, setStandalone] = useState(false);

  useEffect(() => {
    const modes = ["standalone", "fullscreen"].map(mode => window.matchMedia?.(`(display-mode: ${mode})`));
    function sync() {
      setSupported(supportsStandardFullscreen() || supportsWebkitFullscreen());
      setActive(Boolean(fullscreenElement()));
      setStandalone((modes.some(mode => mode?.matches) && !fullscreenElement()) ||
        (navigator as Navigator & { standalone?: boolean }).standalone === true);
    }
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    modes.forEach(mode => mode?.addEventListener("change", sync));
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
      modes.forEach(mode => mode?.removeEventListener("change", sync));
    };
  }, []);

  async function toggle() {
    if (fullscreenElement()) {
      if (typeof document.exitFullscreen === "function") await document.exitFullscreen();
      else await (document as WebkitDocument).webkitExitFullscreen?.();
    } else if (supportsStandardFullscreen()) {
      await document.documentElement.requestFullscreen({ navigationUI: "hide" });
    } else if (supportsWebkitFullscreen()) {
      await (document.documentElement as WebkitElement).webkitRequestFullscreen!();
    } else {
      throw new Error("Fullscreen is unavailable");
    }
    setActive(Boolean(fullscreenElement()));
  }

  return { supported, active, standalone, toggle };
}
