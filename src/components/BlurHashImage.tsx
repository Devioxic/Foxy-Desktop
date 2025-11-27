import React, { useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { decode } from "blurhash";

interface BlurHashImageProps {
  src: string;
  blurHash?: string;
  alt: string;
  className?: string;
  width?: number;
  height?: number;
}

const BlurHashImage: React.FC<BlurHashImageProps> = ({
  src,
  blurHash,
  alt,
  className = "",
  width = 32,
  height = 32,
}) => {
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

  useEffect(() => {
    setImageLoaded(false);
    setImageError(false);
  }, [src]);

  useEffect(() => {
    if (!blurHash || !canvasRef.current) return;
    try {
      const w = Math.max(1, Math.min(64, Math.round(width / 4)));
      const h = Math.max(1, Math.min(64, Math.round(height / 4)));
      const pixels = decode(blurHash, w, h);
      const ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;
      const scaledW = w * dpr;
      const scaledH = h * dpr;
      canvasRef.current.width = scaledW;
      canvasRef.current.height = scaledH;
      ctx.scale(dpr, dpr);
      const imageData = ctx.createImageData(w, h);
      imageData.data.set(pixels);
      ctx.putImageData(imageData, 0, 0);
      // Smooth upscale via CSS sizing
    } catch (error) {
      logger.warn("Failed to decode blur hash:", error);
    }
  }, [blurHash, width, height, dpr]);

  const handleImageLoad = () => {
    setImageLoaded(true);
  };

  const handleImageError = () => {
    setImageError(true);
    setImageLoaded(false);
  };

  return (
    <div
      className={`relative ${className}`}
      style={{ width: "100%", height: "100%" }}
    >
      {blurHash && !imageLoaded && !imageError && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: imageLoaded ? 0 : 1, background: "#eee" }}
        />
      )}

      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        onLoad={handleImageLoad}
        onError={handleImageError}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          imageLoaded ? "opacity-100" : "opacity-0"
        }`}
        style={{
          opacity: imageLoaded ? 1 : 0,
        }}
      />

      {!blurHash && !imageLoaded && !imageError && (
        <div className="absolute inset-0 bg-gradient-to-br from-gray-100 to-gray-200 animate-pulse" />
      )}
    </div>
  );
};

export default BlurHashImage;
