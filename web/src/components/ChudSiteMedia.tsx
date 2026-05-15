import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const GIF_SRC = "/chuddance1.gif";
const DEFAULT_VOLUME = 0.42;
const MUSIC_FADE_MS = 1100;
const BGM_ID = "chud-bgm";

declare global {
  interface Window {
    __CHUD_BGM_USER_MUTED?: boolean;
  }
}

function clampVolume(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function getBgm(): HTMLAudioElement | null {
  return document.getElementById(BGM_ID) as HTMLAudioElement | null;
}

interface Props {
  children: ReactNode;
}

export function ChudSiteMedia({ children }: Props) {
  const [revealed, setRevealed] = useState(false);
  const [musicOn, setMusicOn] = useState(true);
  const [gifKey, setGifKey] = useState(0);
  const [mounted, setMounted] = useState(false);
  const gifRef = useRef<HTMLImageElement>(null);
  const gifAnimatingRef = useRef(true);
  const fadeRef = useRef<number | null>(null);
  const fadeStartRef = useRef(0);
  const playInFlightRef = useRef(false);
  const targetVolumeRef = useRef(DEFAULT_VOLUME);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const preload = new Image();
    preload.src = GIF_SRC;
  }, []);

  const fadeAudioIn = useCallback(() => {
    const audio = getBgm();
    if (!audio || window.__CHUD_BGM_USER_MUTED) return;
    const target = targetVolumeRef.current;
    audio.muted = false;
    fadeStartRef.current = performance.now();
    const tick = () => {
      const a = getBgm();
      if (!a) return;
      const elapsed = performance.now() - fadeStartRef.current;
      const t = Math.min(1, Math.max(0, elapsed / MUSIC_FADE_MS));
      a.volume = clampVolume(t * target);
      if (t < 1) fadeRef.current = requestAnimationFrame(tick);
    };
    if (fadeRef.current != null) cancelAnimationFrame(fadeRef.current);
    fadeRef.current = requestAnimationFrame(tick);
  }, []);

  const startMusic = useCallback(async () => {
    if (window.__CHUD_BGM_USER_MUTED) return;
    const audio = getBgm();
    if (!audio || playInFlightRef.current) return;
    if (!audio.paused) return;

    playInFlightRef.current = true;
    audio.loop = true;
    audio.muted = false;
    audio.volume = 0;

    try {
      if (audio.readyState < 2) audio.load();
      await audio.play();
      audio.muted = false;
      fadeAudioIn();
    } catch {
      try {
        audio.muted = true;
        await audio.play();
        audio.muted = false;
        fadeAudioIn();
      } catch {
        audio.muted = false;
      }
    } finally {
      playInFlightRef.current = false;
    }
  }, [fadeAudioIn]);

  const freezeGif = useCallback(() => {
    const img = gifRef.current;
    if (!img || !gifAnimatingRef.current) return;

    const freeze = () => {
      const el = gifRef.current;
      if (!el || el.naturalWidth < 2) return;
      const canvas = document.createElement("canvas");
      canvas.width = el.naturalWidth;
      canvas.height = el.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(el, 0, 0);
      try {
        el.src = canvas.toDataURL("image/png");
        gifAnimatingRef.current = false;
      } catch {
        /* ignore */
      }
    };

    if (img.complete && img.naturalWidth >= 2) freeze();
    else img.addEventListener("load", freeze, { once: true });
  }, []);

  const resumeGif = useCallback(() => {
    gifAnimatingRef.current = true;
    setGifKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const revealId = requestAnimationFrame(() => setRevealed(true));
    return () => cancelAnimationFrame(revealId);
  }, []);

  useEffect(() => {
    window.__CHUD_BGM_USER_MUTED = false;
    const audio = getBgm();
    if (!audio) return;

    if (audio.paused) void startMusic();

    const onReady = () => {
      if (!window.__CHUD_BGM_USER_MUTED) void startMusic();
    };
    audio.addEventListener("canplaythrough", onReady);

    return () => {
      audio.removeEventListener("canplaythrough", onReady);
      if (fadeRef.current != null) cancelAnimationFrame(fadeRef.current);
    };
  }, [startMusic]);

  const toggleMusic = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const audio = getBgm();
      if (!audio) return;

      if (musicOn) {
        window.__CHUD_BGM_USER_MUTED = true;
        audio.pause();
        if (fadeRef.current != null) cancelAnimationFrame(fadeRef.current);
        freezeGif();
        setMusicOn(false);
      } else {
        window.__CHUD_BGM_USER_MUTED = false;
        audio.muted = false;
        audio.volume = clampVolume(targetVolumeRef.current);
        void audio.play();
        resumeGif();
        setMusicOn(true);
      }
    },
    [musicOn, freezeGif, resumeGif]
  );

  const cornerControl = (
    <button
      type="button"
      className={["chud-dance-widget", musicOn ? "" : "chud-dance-widget-paused"].join(" ")}
      onClick={toggleMusic}
      aria-label={musicOn ? "pause chud music" : "play chud music"}
    >
      <img
        key={gifKey}
        ref={gifRef}
        className="chud-dance-gif"
        src={GIF_SRC}
        alt=""
        draggable={false}
        loading="eager"
        decoding="async"
      />
      {!musicOn && <span className="chud-dance-strike" aria-hidden />}
    </button>
  );

  return (
    <div className="site-media-root">
      <div className={`site-black-veil ${revealed ? "site-black-veil-out" : ""}`} aria-hidden />

      {mounted ? createPortal(cornerControl, document.body) : null}

      <div className="site-content">{children}</div>
    </div>
  );
}
