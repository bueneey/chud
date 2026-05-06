import { useRef, useEffect } from "react";

interface CursorDitherTrailProps {
  trailColor?: string;
  dotSize?: number;
  fadeDuration?: number;
  className?: string;
}

export default function CursorDitherTrail({
  trailColor = "#6b8f62",
  dotSize = 6,
  fadeDuration = 1000,
  className = "w-screen h-screen",
}: CursorDitherTrailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = canvas.clientWidth;
    let height = canvas.clientHeight;
    canvas.width = width;
    canvas.height = height;

    const onResize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener("resize", onResize);

    const int = parseInt(trailColor.replace("#", ""), 16);
    const r = (int >> 16) & 255;
    const g = (int >> 8) & 255;
    const b = int & 255;

    const paintDot = (x: number, y: number) => {
      ctx.fillStyle = `rgba(${r},${g},${b},1)`;
      ctx.fillRect(x, y, dotSize, dotSize);
    };

    let lastTime = performance.now();
    const fadeStep = () => {
      const now = performance.now();
      const delta = now - lastTime;
      lastTime = now;
      const fadeAlpha = delta / fadeDuration;
      ctx.fillStyle = `rgba(0,0,0,${fadeAlpha})`;
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      requestAnimationFrame(fadeStep);
    };
    requestAnimationFrame(fadeStep);

    const onMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - rect.left) / dotSize) * dotSize;
      const y = Math.floor((e.clientY - rect.top) / dotSize) * dotSize;
      paintDot(x, y);
    };
    window.addEventListener("mousemove", onMove);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("resize", onResize);
    };
  }, [trailColor, dotSize, fadeDuration]);

  return (
    <div
      className={className}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: "100%",
          height: "100%",
          display: "block",
        }}
      />
    </div>
  );
}
