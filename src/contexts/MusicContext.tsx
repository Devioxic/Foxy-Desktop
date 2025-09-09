import React, {
  createContext,
  useRef,
  useEffect,
  useState,
  useContext,
} from "react";
import { logger } from "@/lib/logger";
import {
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  getAudioStreamInfo,
  getTrackNormalizationInfo,
} from "@/lib/jellyfin";
import { getLocalUrlForTrack } from "@/lib/downloads";

export interface Track {
  Id: string;
  Name: string;
  Artist?: string;
  AlbumArtist?: string;
  Album?: string;
  ImageTags?: { Primary?: string };
  RunTimeTicks?: number;
  MediaSources?: Array<{
    Path: string;
    AudioCodec?: string;
    AudioChannels?: number;
    SampleRate?: number; // Hz
    BitsPerSample?: number;
    TranscodingUrl?: string;
  }>;
}

export type RepeatMode = "off" | "all" | "one";

interface MusicContextType {
  // Player state
  currentTrack: Track | null;
  isPlaying: boolean;
  isPaused: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number; // retained internally though speed UI removed
  quality: string;
  currentSrc: string;
  // Audio effects settings
  normalizeEnabled: boolean;
  setNormalizeEnabled: (v: boolean) => void;
  crossfadeSeconds: number;
  setCrossfadeSeconds: (s: number) => void;

  // Queue management
  queue: Track[];
  currentIndex: number;
  repeatMode: RepeatMode;
  isShuffled: boolean;

  // Player controls
  play: (track?: Track) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  next: () => void;
  previous: () => void;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  setQuality: (q: string) => void;

  // Queue controls
  addToQueue: (track: Track) => void;
  addToQueueNext: (track: Track) => void;
  playNow: (track: Track) => void;
  playQueue: (tracks: Track[], startIndex?: number) => void;
  removeFromQueue: (index: number) => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  jumpToTrack: (index: number) => void;
  clearQueue: () => void;
  shuffleQueue: () => void;
  toggleShuffle: () => void;
  toggleRepeat: () => void;

  // Auth
  serverAddress: string;
  accessToken: string;
}

const MusicContext = createContext<MusicContextType | undefined>(undefined);

export const useMusicPlayer = () => {
  const context = useContext(MusicContext);
  if (!context) {
    throw new Error("useMusicPlayer must be used within a MusicProvider");
  }
  return context;
};

interface MusicProviderProps {
  children: React.ReactNode;
}

export const MusicProvider: React.FC<MusicProviderProps> = ({ children }) => {
  // Two audio elements for overlap crossfade
  const audioARef = useRef<HTMLAudioElement>(new Audio());
  const audioBRef = useRef<HTMLAudioElement>(new Audio());
  // Allow Web Audio processing when streaming from server
  audioARef.current.crossOrigin = "anonymous";
  audioBRef.current.crossOrigin = "anonymous";
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(1);
  const [playbackRate, setPlaybackRateState] = useState(1);
  const [queue, setQueue] = useState<Track[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [repeatMode, setRepeatMode] = useState<RepeatMode>("off");
  const [isShuffled, setIsShuffled] = useState(false);
  const [originalQueue, setOriginalQueue] = useState<Track[]>([]);
  const [quality, setQualityState] = useState<string>(
    () => localStorage.getItem("playback_quality") || "auto"
  );
  // 👇 Add this inside MusicProvider, after your useState declarations
useEffect(() => {
  if (!currentTrack) {
    window.rpc?.clear?.();
    return;
  }

  window.rpc.update({
    title: currentTrack.Name,                                 // song title
    artist: currentTrack.Artist || currentTrack.AlbumArtist,  // prefer Artist, fallback AlbumArtist
    album: currentTrack.Album || "",                          // album name if available
    durationMs: duration * 1000,                              // seconds → ms
    positionMs: currentTime * 1000,                           // seconds → ms
    isPaused: isPaused,
    publicUrl: undefined,                                     // Jellyfin URL if you want later
  });
}, [currentTrack?.Id, isPaused, currentTime, duration]);

  const [currentSrc, setCurrentSrc] = useState<string>("");
  const lastProgressReportRef = useRef<number>(0);
  // Effects settings
  const [normalizeEnabled, setNormalizeEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("playback_normalize") === "true";
    } catch {
      return false;
    }
  });
  // Gapless is always on; no user setting
  const [crossfadeSeconds, setCrossfadeSeconds] = useState<number>(() => {
    try {
      const v = parseInt(localStorage.getItem("playback_crossfade") || "0", 10);
      return isNaN(v) ? 0 : Math.max(0, Math.min(10, v));
    } catch {
      return 0;
    }
  });

  // Persist effect settings
  useEffect(() => {
    try {
      localStorage.setItem("playback_normalize", String(normalizeEnabled));
    } catch {}
  }, [normalizeEnabled]);
  // no persistence for gapless (always on)
  useEffect(() => {
    try {
      localStorage.setItem("playback_crossfade", String(crossfadeSeconds));
    } catch {}
  }, [crossfadeSeconds]);

  // Web Audio graph
  const audioCtxRef = useRef<AudioContext | null>(null);
  const srcNodeARef = useRef<MediaElementAudioSourceNode | null>(null);
  const srcNodeBRef = useRef<MediaElementAudioSourceNode | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const gainARef = useRef<GainNode | null>(null);
  const gainBRef = useRef<GainNode | null>(null);
  // Track per-stream normalization gain (linear scalar), applied on top of fade curve
  const normGainARef = useRef<number>(1);
  const normGainBRef = useRef<number>(1);
  const fadingOutRef = useRef<boolean>(false);
  const pendingFadeInRef = useRef<boolean>(false);
  const crossfadeAdvancedRef = useRef<boolean>(false);
  // When user explicitly skips/previous/jumps, don't crossfade — cut immediately
  const manualAdvanceRef = useRef<boolean>(false);
  // If crossfade starts late, carry the effective fade duration to the next play()
  const pendingFadeDurationRef = useRef<number>(0);
  const prefetchedNextIdRef = useRef<string | null>(null);
  const useARef = useRef<boolean>(true); // which element is active now

  // Get auth data from localStorage
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const serverAddress = authData.serverAddress || "";
  const accessToken = authData.accessToken || "";

  const audioA = audioARef.current;
  const audioB = audioBRef.current;
  const audio = useARef.current ? audioA : audioB;
  // Keep track of which track is assigned to each element for accurate timing/fallbacks
  const trackARef = useRef<Track | null>(null);
  const trackBRef = useRef<Track | null>(null);
  // Live state refs to avoid stale closures inside media event handlers
  const isPlayingRef = useRef(isPlaying);
  const crossfadeSecondsRef = useRef(crossfadeSeconds);
  const queueRef = useRef(queue);
  const currentIndexRef = useRef(currentIndex);
  const repeatModeRef = useRef(repeatMode);
  const currentTrackRef = useRef(currentTrack);
  const serverAddressRef = useRef(serverAddress);
  const accessTokenRef = useRef(accessToken);
  // Monotonic token to ensure only the latest play() updates UI/state
  const playTokenRef = useRef(0);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);
  useEffect(() => {
    crossfadeSecondsRef.current = crossfadeSeconds;
  }, [crossfadeSeconds]);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);
  useEffect(() => {
    currentTrackRef.current = currentTrack;
  }, [currentTrack]);
  useEffect(() => {
    serverAddressRef.current = serverAddress;
  }, [serverAddress]);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  // Initialize Web Audio
  useEffect(() => {
    try {
      const AC: any =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = new AC();
      audioCtxRef.current = ctx;

      const srcA = ctx.createMediaElementSource(audioA);
      const srcB = ctx.createMediaElementSource(audioB);
      srcNodeARef.current = srcA;
      srcNodeBRef.current = srcB;

      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 6;
      comp.ratio.value = 3;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      compressorRef.current = comp;

      const master = ctx.createGain();
      master.gain.value = volume;
      masterGainRef.current = master;

      const gainA = ctx.createGain();
      const gainB = ctx.createGain();
      gainA.gain.value = 0.0001;
      gainB.gain.value = 0.0001;
      gainARef.current = gainA;
      gainBRef.current = gainB;

      // Connect chain based on normalization
      // Desired graph:
      //  - Without normalize: srcA -> gainA -> master -> destination; srcB -> gainB -> master -> destination
      //  - With normalize:    srcA -> gainA -> compressor -> master -> destination
      //                       srcB -> gainB -> compressor -> master -> destination
      const connect = () => {
        try {
          srcA.disconnect();
        } catch {}
        try {
          srcB.disconnect();
        } catch {}
        try {
          comp.disconnect();
        } catch {}
        try {
          gainA.disconnect();
        } catch {}
        try {
          gainB.disconnect();
        } catch {}
        try {
          master.disconnect();
        } catch {}

        // Always connect sources to their own gains first
        srcA.connect(gainA);
        srcB.connect(gainB);

        if (normalizeEnabled) {
          // Sum both per-stream gains into the compressor, then to master
          gainA.connect(comp);
          gainB.connect(comp);
          comp.connect(master);
        } else {
          // Bypass compressor; send per-stream gains directly to master
          gainA.connect(master);
          gainB.connect(master);
        }

        master.connect(ctx.destination);
      };
      connect();

      return () => {
        try {
          srcA.disconnect();
        } catch {}
        try {
          srcB.disconnect();
        } catch {}
        try {
          comp.disconnect();
        } catch {}
        try {
          gainA.disconnect();
        } catch {}
        try {
          gainB.disconnect();
        } catch {}
        try {
          master.disconnect();
        } catch {}
        try {
          ctx.close();
        } catch {}
      };
    } catch (e) {
      logger.warn("Web Audio init failed; effects disabled", e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-connect graph on normalize toggle
  useEffect(() => {
    const ctx = audioCtxRef.current;
    const srcA = srcNodeARef.current;
    const srcB = srcNodeBRef.current;
    const comp = compressorRef.current;
    const gainA = gainARef.current;
    const gainB = gainBRef.current;
    const master = masterGainRef.current;
    if (!ctx || !srcA || !srcB || !master || !comp || !gainA || !gainB) return;
    try {
      srcA.disconnect();
    } catch {}
    try {
      srcB.disconnect();
    } catch {}
    try {
      comp.disconnect();
    } catch {}
    try {
      gainA.disconnect();
    } catch {}
    try {
      gainB.disconnect();
    } catch {}
    try {
      master.disconnect();
    } catch {}
    // Always connect sources to their own gains first
    srcA.connect(gainA);
    srcB.connect(gainB);

    if (normalizeEnabled) {
      // Sum both per-stream gains into the compressor, then to master
      gainA.connect(comp);
      gainB.connect(comp);
      comp.connect(master);
    } else {
      // Bypass compressor; send per-stream gains directly to master
      gainA.connect(master);
      gainB.connect(master);
    }

    master.connect(ctx.destination);

    // Optionally apply normalization immediately to the active stream
    (async () => {
      try {
        const g = useARef.current ? gainARef.current : gainBRef.current;
        if (!g) return;
        const now = ctx.currentTime;
        if (
          normalizeEnabled &&
          currentTrackRef.current &&
          serverAddressRef.current &&
          accessTokenRef.current
        ) {
          const meta = await getTrackNormalizationInfo(
            serverAddressRef.current,
            accessTokenRef.current,
            currentTrackRef.current.Id
          );
          const norm = computeNormalizationScalar(meta);
          if (useARef.current) normGainARef.current = norm;
          else normGainBRef.current = norm;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(Math.max(0.0001, norm), now);
        } else if (!normalizeEnabled) {
          // Reset normalization scalar to 1
          if (useARef.current) normGainARef.current = 1;
          else normGainBRef.current = 1;
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(1, now);
        }
      } catch {}
    })();
  }, [normalizeEnabled]);

  // Compute a linear gain scalar from normalization metadata.
  // Prefer album gain; fall back to track gain; otherwise use R128 numbers as dB.
  const computeNormalizationScalar = (
    meta: {
      trackGainDb?: number;
      albumGainDb?: number;
      r128Track?: number;
      r128Album?: number;
    } | null
  ): number => {
    if (!meta) return 1;
    const db =
      (typeof meta.albumGainDb === "number" ? meta.albumGainDb : undefined) ??
      (typeof meta.trackGainDb === "number" ? meta.trackGainDb : undefined) ??
      (typeof meta.r128Album === "number" ? meta.r128Album : undefined) ??
      (typeof meta.r128Track === "number" ? meta.r128Track : undefined);
    if (typeof db !== "number" || !isFinite(db)) return 1;
    // ReplayGain is typically negative for loud tracks; convert dB to linear
    const linear = Math.pow(10, db / 20);
    // Clamp to reasonable range to avoid extreme changes
    return Math.max(0.25, Math.min(4, linear));
  };

  // Helper function to update Media Session API
  const updateMediaSession = (track: Track | null) => {
    if ("mediaSession" in navigator && track) {
      const albumArt =
        track.ImageTags?.Primary && serverAddress
          ? `${serverAddress}/Items/${track.Id}/Images/Primary?maxWidth=512&quality=90`
          : undefined;

      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.Name || "Unknown Title",
        artist: track.AlbumArtist || track.Artist || "Unknown Artist",
        album: track.Album || "Unknown Album",
        artwork: albumArt
          ? [
              {
                src: albumArt,
                sizes: "512x512",
                type: "image/jpeg",
              },
            ]
          : undefined,
      });

      // Set playback state
      navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";

      // Try to set experimental playback state properties if supported
      try {
        // @ts-ignore - These are experimental APIs
        if ("setPlaybackState" in navigator.mediaSession) {
          // @ts-ignore
          navigator.mediaSession.setPlaybackState({
            playbackState: isPlaying ? "playing" : "paused",
            // @ts-ignore
            shuffleMode: isShuffled ? "on" : "off",
            // @ts-ignore
            repeatMode:
              repeatMode === "off"
                ? "none"
                : repeatMode === "one"
                  ? "track"
                  : "playlist",
          });
        }
      } catch (error) {
        logger.debug("Extended playback state not supported");
      }
    }
  };

  // Update media session when track, playback state, or shuffle/repeat modes change
  useEffect(() => {
    updateMediaSession(currentTrack);
  }, [currentTrack, isPlaying, serverAddress, isShuffled, repeatMode]);

  // Audio event listeners - basic ones only (hooked on both elements)
  useEffect(() => {
    const handleTimeUpdate = (e: Event) => {
      const el =
        (e.currentTarget as HTMLMediaElement) ||
        (useARef.current ? audioA : audioB);
      // Only accept updates from the active element to avoid UI flicker during overlap
      const activeEl = useARef.current ? audioA : audioB;
      if (el !== activeEl) return;
      const assignedTrack =
        el === audioA ? trackARef.current : trackBRef.current;

      const currentTime = el.currentTime;
      setCurrentTime(currentTime);

      // Crossfade fade-out near the end and optional prefetch
      try {
        // Prefer audio.duration; fall back to track runtime if stream doesn't expose duration
        let dur = el.duration || 0;
        if (!isFinite(dur) || dur <= 0) {
          try {
            if (el.seekable && el.seekable.length > 0) {
              dur = el.seekable.end(el.seekable.length - 1);
            }
          } catch {}
        }
        if (!isFinite(dur) || dur <= 0) {
          try {
            if (el.buffered && el.buffered.length > 0) {
              dur = el.buffered.end(el.buffered.length - 1);
            }
          } catch {}
        }
        if (!isFinite(dur) || dur <= 0) {
          const ticks = assignedTrack?.RunTimeTicks || 0;
          if (ticks > 0) dur = ticks / 10_000_000; // Jellyfin ticks to seconds
        }

        const remain = dur > 0 ? dur - currentTime : Infinity;
        const epsilon = 0.05;
        const cf = crossfadeSecondsRef.current || 0;
        const maxStart = dur > 0 ? Math.max(epsilon, dur - epsilon) : cf;
        const effectiveXfade = Math.min(cf, Math.max(epsilon, maxStart));
        // Start the overlap slightly earlier to guarantee both tracks are audible together
        const advanceLead =
          cf > 0 ? Math.min(0.6, Math.max(0.15, cf * 0.2)) : 0;

        // Debug: log once when within 1s of the crossfade window
        if (
          Number.isFinite(remain) &&
          remain <= effectiveXfade + 1 &&
          remain >= 0 &&
          (window as any).__xf_logged !==
            `${assignedTrack?.Id}-${Math.floor(remain)}`
        ) {
          (window as any).__xf_logged =
            `${assignedTrack?.Id}-${Math.floor(remain)}`;
          logger.debug(
            `XF: timeupdate id=${assignedTrack?.Id} dur=${dur.toFixed(2)}s remain=${remain.toFixed(
              2
            )}s cf=${cf}s eff=${effectiveXfade.toFixed(2)}s`
          );
        }

        // Trigger early overlap advance once; let play() schedule both fades
        if (
          cf > 0 &&
          !crossfadeAdvancedRef.current &&
          !manualAdvanceRef.current &&
          isFinite(remain) &&
          remain <= Math.max(0.05, cf + advanceLead) &&
          remain >= 0 &&
          isPlayingRef.current
        ) {
          // Compute intended fade length; if late, shorten to remaining time
          const fadeLen = Math.max(0.05, Math.min(cf, Math.max(0.05, remain)));
          pendingFadeDurationRef.current = fadeLen;
          logger.info(
            `XF: early advance id=${assignedTrack?.Id} t=${currentTime.toFixed(2)}s remain=${remain.toFixed(
              2
            )}s fade=${fadeLen}s lead=${advanceLead.toFixed(2)}s`
          );
          // Only overlap-advance if a next track actually exists (or repeat all)
          const qNow = queueRef.current;
          const idxNow = currentIndexRef.current;
          const repNow = repeatModeRef.current;
          const hasNext =
            idxNow < qNow.length - 1 || (repNow === "all" && qNow.length > 0);
          if (hasNext) {
            logger.info("XF: triggering next() for overlap");
            crossfadeAdvancedRef.current = true; // set just before advancing
            next();
          } else {
            logger.info("XF: at end of queue; skipping overlap advance");
          }
        }

        // If within window but didn't trigger, log gating flags (debug aid)
        if (
          cf > 0 &&
          Number.isFinite(remain) &&
          remain <= effectiveXfade + advanceLead &&
          remain >= 0 &&
          isPlayingRef.current &&
          (crossfadeAdvancedRef.current || manualAdvanceRef.current)
        ) {
          logger.debug(
            `XF: gated remain=${remain.toFixed(2)}s advanced=${crossfadeAdvancedRef.current} manual=${manualAdvanceRef.current}`
          );
        }

        // Prefetch next for gapless/network warmup
        try {
          const queueNow = queueRef.current;
          const currentIndexNow = currentIndexRef.current;
          const repeatNow = repeatModeRef.current;
          if (queueNow.length > 0) {
            const nextIdx =
              remain <= Math.max(epsilon, effectiveXfade) &&
              currentIndexNow < queueNow.length - 1
                ? currentIndexNow + 1
                : repeatNow === "all"
                  ? 0
                  : -1;
            if (nextIdx >= 0) {
              const nextTrack = queueNow[nextIdx];
              if (nextTrack && prefetchedNextIdRef.current !== nextTrack.Id) {
                const url = getStreamUrl(nextTrack);
                if (url) {
                  prefetchedNextIdRef.current = nextTrack.Id;
                  // Light-touch preflight to warm connection without heavy data
                  fetch(url, { method: "HEAD" }).catch(() => {});
                }
              }
            }
          }
        } catch {}
      } catch {}

      // Throttle progress reporting (every 5s or on near end)
      const currentTrackNow = currentTrackRef.current;
      if (currentTrackNow) {
        const nowMs = Date.now();
        if (
          nowMs - lastProgressReportRef.current > 5000 ||
          currentTime + 3 >= (el.duration || 0)
        ) {
          lastProgressReportRef.current = nowMs;
          reportPlaybackProgress(
            serverAddressRef.current,
            accessTokenRef.current,
            (assignedTrack?.Id || currentTrackNow?.Id) as string,
            currentTime,
            !isPlayingRef.current,
            el.duration || undefined
          );
        }
      }

      // Update Media Session position state
      if (
        "mediaSession" in navigator &&
        "setPositionState" in navigator.mediaSession
      ) {
        try {
          navigator.mediaSession.setPositionState({
            duration: el.duration || 0,
            playbackRate: el.playbackRate,
            position: currentTime,
          });
        } catch (error) {
          // Some browsers might not support all position state features
          logger.warn("Media Session position state update failed:", error);
        }
      }
    };

    const handleDurationChange = (e: Event) => {
      const el =
        (e.currentTarget as HTMLMediaElement) ||
        (useARef.current ? audioA : audioB);
      const activeEl = useARef.current ? audioA : audioB;
      if (el !== activeEl) return;
      let dur = el.duration;
      if (!isFinite(dur) || dur <= 0) {
        const ticks = currentTrack?.RunTimeTicks || 0;
        if (ticks > 0) dur = ticks / 10_000_000; // fallback from metadata
      }
      setDuration(dur || 0);
    };
    const handleLoadedMetadata = (e: Event) => handleDurationChange(e);
    const handleLoadStart = (e?: Event) => {
      const el =
        (e?.currentTarget as HTMLMediaElement) ||
        (useARef.current ? audioA : audioB);
      const activeEl = useARef.current ? audioA : audioB;
      if (el !== activeEl) return;
      setCurrentTime(0);
      // Reset duration to avoid stale UI until we know the new track's duration
      const ticks = currentTrack?.RunTimeTicks || 0;
      setDuration(ticks > 0 ? ticks / 10_000_000 : 0);
    };

    audioA.addEventListener("timeupdate", handleTimeUpdate);
    audioB.addEventListener("timeupdate", handleTimeUpdate);
    audioA.addEventListener("durationchange", handleDurationChange);
    audioB.addEventListener("durationchange", handleDurationChange);
    audioA.addEventListener("loadedmetadata", handleLoadedMetadata);
    audioB.addEventListener("loadedmetadata", handleLoadedMetadata);
    audioA.addEventListener("loadstart", handleLoadStart);
    audioB.addEventListener("loadstart", handleLoadStart);

    return () => {
      audioA.removeEventListener("timeupdate", handleTimeUpdate);
      audioB.removeEventListener("timeupdate", handleTimeUpdate);
      audioA.removeEventListener("durationchange", handleDurationChange);
      audioB.removeEventListener("durationchange", handleDurationChange);
      audioA.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audioB.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audioA.removeEventListener("loadstart", handleLoadStart);
      audioB.removeEventListener("loadstart", handleLoadStart);
    };
  }, []);

  // Helper function to get streaming URL
  const getStreamUrl = (track: Track): string => {
    if (!serverAddress || !accessToken) return "";

    // If user selects Auto, prefer a direct, static stream of the original
    if (!quality || quality === "auto") {
      return `${serverAddress}/Audio/${track.Id}/stream?static=true&api_key=${accessToken}`;
    }

    // For explicit quality, request a universal (transcoded if needed) stream
    // Let Jellyfin decide direct vs transcode using MaxStreamingBitrate.
    const map: Record<string, number> = {
      low: 128000,
      medium: 256000,
      high: 320000,
    };
    const limit = map[quality];

    // Pull optional context
    const userId = (authData && authData.userId) || "";
    const deviceId = (() => {
      try {
        return localStorage.getItem("foxyDeviceId") || "";
      } catch {
        return "";
      }
    })();

    const params: string[] = [
      `api_key=${accessToken}`,
      userId ? `UserId=${encodeURIComponent(userId)}` : "",
      deviceId ? `DeviceId=${encodeURIComponent(deviceId)}` : "",
      limit ? `MaxStreamingBitrate=${limit}` : "",
      // Prefer a broadly supported container/codec to ensure playback when transcoding kicks in
      `Container=mp3`,
      `AudioCodec=mp3`,
      // Ensure progressive HTTP when transcoding (works well with HTML5 Audio)
      `TranscodingContainer=mp3`,
      `TranscodingProtocol=Http`,
    ].filter(Boolean) as string[];

    return `${serverAddress}/Audio/${track.Id}/universal?${params.join("&")}`;
  };

  // Resolve a playable URL, preferring a local downloaded file when available
  const resolveTrackUrl = async (track: Track): Promise<string> => {
    try {
      const local = await getLocalUrlForTrack(track.Id);
      if (local) return local;
    } catch {}
    return getStreamUrl(track);
  };

  const play = async (track?: Track) => {
    try {
      // Bump play token; capture this call's token
      const myToken = ++playTokenRef.current;
      let targetTrack: Track | null = null;
      const qNow = queueRef.current;
      const idxNow = currentIndexRef.current;
      if (track) {
        const existingIndex = qNow.findIndex((t) => t.Id === track.Id);
        if (existingIndex >= 0) {
          setCurrentIndex(existingIndex);
          targetTrack = qNow[existingIndex];
        } else {
          // append track (only for ad-hoc play of items not already in the queue)
          setQueue((prev) => {
            const newQ = [...prev, track];
            setCurrentIndex(newQ.length - 1);
            return newQ;
          });
          targetTrack = track;
        }
      } else if (idxNow >= 0 && idxNow < qNow.length) {
        targetTrack = qNow[idxNow];
      }

      if (!targetTrack) return;

      // If this play is due to a manual skip, hard-stop any existing playback on both elements
      if (manualAdvanceRef.current) {
        try {
          audioA.pause();
          audioB.pause();
        } catch {}
        try {
          const ctx = audioCtxRef.current;
          const gA = gainARef.current;
          const gB = gainBRef.current;
          if (ctx && gA && gB) {
            const now = ctx.currentTime;
            gA.gain.cancelScheduledValues(now);
            gB.gain.cancelScheduledValues(now);
            gA.gain.setValueAtTime(0.0001, now);
            gB.gain.setValueAtTime(0.0001, now);
          }
        } catch {}
      }

      if (!track && audio.src && !audio.paused) {
        // toggle pause? handled elsewhere
      }

      const streamUrl = await resolveTrackUrl(targetTrack);
      if (myToken !== playTokenRef.current) return; // superseded by a newer play()
      if (!streamUrl) return;
      // Choose target element (if currently A, load into B, and vice versa) for overlap
      const useA = useARef.current;
      const targetEl = useA ? audioB : audioA;
      const targetGain = useA ? gainBRef.current : gainARef.current;
      const currentGain = useA ? gainARef.current : gainBRef.current;
      const currentEl = useA ? audioA : audioB;
      const setNormGain = useA
        ? (v: number) => {
            normGainBRef.current = v;
          }
        : (v: number) => {
            normGainARef.current = v;
          };
      // Capture whether this transition is manual before we reset the flag later
      const wasManual = manualAdvanceRef.current;
      targetEl.src = streamUrl;
      // Record which track is on which element
      if (targetEl === audioA) trackARef.current = targetTrack;
      if (targetEl === audioB) trackBRef.current = targetTrack;
      setIsPaused(false);

      // Enrich media sources async
      (async () => {
        try {
          const info = await getAudioStreamInfo(
            serverAddress,
            accessToken,
            targetTrack!.Id
          );
          const detailed = info?.item;
          if (detailed?.MediaSources?.length) {
            setCurrentTrack((prev) =>
              prev && prev.Id === targetTrack!.Id
                ? { ...prev, MediaSources: detailed.MediaSources as any }
                : prev
            );
          }
        } catch {}
      })();

      // Apply per-track normalization gain on the target stream gain node
      let normTargetScalar = 1;
      try {
        const meta = normalizeEnabled
          ? await getTrackNormalizationInfo(
              serverAddress,
              accessToken,
              targetTrack!.Id
            )
          : null;
        normTargetScalar = computeNormalizationScalar(meta);
        setNormGain(normTargetScalar);
        const g = targetGain;
        const ctx = audioCtxRef.current;
        if (g && ctx) {
          const now = ctx.currentTime;
          // Set base to normalized value; fade scheduling below multiplies appropriately
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(
            Math.max(
              0.0001,
              normTargetScalar * (crossfadeSeconds > 0 ? 0.0001 : 1)
            ),
            now
          );
        }
      } catch {}

      // Prepare fade-in on the target element and fade-out current if playing
      try {
        const g = targetGain;
        const ctx = audioCtxRef.current;
        if (g && ctx) {
          const now = ctx.currentTime;
          const manual = wasManual;
          // For manual skips, do not crossfade
          const doFade =
            (pendingFadeDurationRef.current > 0 || crossfadeSeconds > 0) &&
            !manual;
          const fade = Math.max(
            0.05,
            pendingFadeDurationRef.current || crossfadeSeconds
          );
          // Use the last computed normalization scalar for the target/current stream
          const normTarget = useA ? normGainBRef.current : normGainARef.current;
          // If we just computed a scalar for the target element above, prefer it now
          const appliedNormTarget = Math.max(
            0.0001,
            normTargetScalar || normTarget || 1
          );
          const normCurrent = useA
            ? normGainARef.current
            : normGainBRef.current;
          g.gain.cancelScheduledValues(now);
          if (doFade && currentGain) {
            // Equal-power crossfade for better perceived overlap
            const currentStart = Math.max(0.0001, currentGain.gain.value || 1);
            const sampleCount = Math.max(
              128,
              Math.min(2048, Math.floor(fade * 256))
            );
            const curveIn = new Float32Array(sampleCount);
            const curveOut = new Float32Array(sampleCount);
            for (let i = 0; i < sampleCount; i++) {
              const t = i / (sampleCount - 1);
              const theta = (Math.PI / 2) * t;
              // In: sin curve 0->1, Out: cos curve 1->0
              const sinV = Math.sin(theta);
              const cosV = Math.cos(theta);
              // Apply normalization scalar to fade curves
              curveIn[i] = Math.max(0.0001, sinV * appliedNormTarget);
              // currentStart already reflects any prior normalization on the old stream
              curveOut[i] = Math.max(0.0001, cosV * currentStart);
            }
            // Small lead so the new track is audible just before the old fades
            const lead = Math.min(0.1, Math.max(0, fade * 0.1));
            // Schedule target fade-in
            g.gain.setValueCurveAtTime(curveIn, now, fade);
            // Schedule current fade-out with slight delay for perceived overlap
            currentGain.gain.cancelScheduledValues(now);
            currentGain.gain.setValueAtTime(
              Math.max(0.0001, currentStart),
              now
            );
            currentGain.gain.setValueCurveAtTime(
              curveOut,
              now + lead,
              Math.max(0.05, fade - lead)
            );
            logger.info(
              `XF: equal-power crossfade on=${targetEl === audioA ? "A" : "B"} dur=${fade}s lead=${lead.toFixed(2)}s`
            );
          } else {
            // Manual or no-crossfade: snap to new track
            g.gain.setValueAtTime(Math.max(0.0001, appliedNormTarget), now);
            if (isPlaying && currentGain) {
              currentGain.gain.cancelScheduledValues(now);
              currentGain.gain.setValueAtTime(0.0001, now);
              try {
                currentEl.pause();
              } catch {}
              try {
                currentEl.currentTime = 0;
              } catch {}
            }
          }
        }
      } catch {}
      // Reset pending fade length after applying
      pendingFadeDurationRef.current = 0;
      // Reset manual flag after preparing transition
      manualAdvanceRef.current = false;
      try {
        audioCtxRef.current?.resume();
      } catch {}
      try {
        await targetEl.play();
      } catch (err) {
        logger.warn(
          "targetEl.play() failed; resuming audio context and retrying",
          err
        );
        try {
          await audioCtxRef.current?.resume();
        } catch {}
        try {
          await targetEl.play();
        } catch (err2) {
          logger.error("targetEl.play() retry failed", err2);
        }
      }
      if (myToken !== playTokenRef.current) return; // superseded while starting
      // Switch active element after starting
      useARef.current = !useA;
      // Now that the new element is active and playing, update Now Playing
      if (myToken === playTokenRef.current) {
        setCurrentSrc(streamUrl);
        setCurrentTrack(targetTrack);
      }
      // For manual transitions, proactively pause the other element; preserve overlap for crossfade
      if (wasManual) {
        try {
          const otherEl = useARef.current ? audioB : audioA;
          otherEl.pause();
        } catch {}
      }
      // Ensure UI duration resets correctly for the new track
      try {
        let dur = targetEl.duration || 0;
        if (!isFinite(dur) || dur <= 0) {
          const ticks = targetTrack?.RunTimeTicks || 0;
          if (ticks > 0) dur = ticks / 10_000_000;
        }
        if (myToken === playTokenRef.current) {
          setDuration(dur || 0);
          setCurrentTime(0);
        }
        // If metadata isn't loaded yet, update again when it arrives
        if (!isFinite(targetEl.duration) || targetEl.duration <= 0) {
          const onMeta = () => {
            // Only apply if this element is still active
            const activeEl = useARef.current ? audioA : audioB;
            if (activeEl === targetEl && myToken === playTokenRef.current) {
              setDuration(targetEl.duration || dur || 0);
            }
          };
          targetEl.addEventListener("loadedmetadata", onMeta, { once: true });
        }
      } catch {}
      if (myToken === playTokenRef.current) {
        setIsPlaying(true);
        reportPlaybackStart(serverAddress, accessToken, targetTrack.Id, 0);
      }
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }
    } catch (e) {
      logger.error("Error playing track", e);
    }
  };

  const pause = () => {
    audioA.pause();
    audioB.pause();
    setIsPlaying(false);
    setIsPaused(true);
    // Reset any scheduled fades to current volume
    try {
      const g = masterGainRef.current;
      const ctx = audioCtxRef.current;
      if (g && ctx) {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), now);
      }
    } catch {}
    if (currentTrack) {
      const el = useARef.current ? audioA : audioB;
      reportPlaybackProgress(
        serverAddress,
        accessToken,
        currentTrack.Id,
        el.currentTime,
        true,
        duration
      );
    }

    // Update Media Session playback state
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "paused";
    }
  };

  const resume = () => {
    if (!currentTrack) return;
    // If paused, resume without changing the source to avoid restarting
    if (isPaused) {
      try {
        audioCtxRef.current?.resume();
      } catch {}
      const el = useARef.current ? audioA : audioB;
      el.play()
        .then(() => {
          setIsPlaying(true);
          setIsPaused(false);
          if ("mediaSession" in navigator) {
            navigator.mediaSession.playbackState = "playing";
          }
        })
        .catch((e) => {
          logger.warn("Failed to resume playback", e);
        });
      return;
    }
    // If not paused but not playing (e.g., stopped), start normal play
    if (!isPlaying) {
      play();
    }
  };

  const stop = () => {
    audioA.pause();
    audioB.pause();
    audioA.currentTime = 0;
    audioB.currentTime = 0;
    if (currentTrack) {
      reportPlaybackStopped(
        serverAddress,
        accessToken,
        currentTrack.Id,
        currentTime
      );
    }
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentTime(0);

    // Update Media Session playback state
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
    }
  };

  const next = () => {
    // If this next() comes from crossfade, don't mark manual or clear flags
    if (!crossfadeAdvancedRef.current) {
      // Manual skip should not crossfade; clear any crossfade state
      manualAdvanceRef.current = true;
      crossfadeAdvancedRef.current = false;
      fadingOutRef.current = false;
      pendingFadeInRef.current = false;
      pendingFadeDurationRef.current = 0;
    } else {
      // Keep manual=false and preserve pendingFadeDuration for the fade-in
      manualAdvanceRef.current = false;
    }
    const q = queueRef.current;
    const idx = currentIndexRef.current;
    const rep = repeatModeRef.current;
    if (rep === "one") {
      if (idx >= 0 && idx < q.length) {
        play(q[idx]);
      }
      return;
    }
    if (idx < q.length - 1) {
      const nextIdx = idx + 1;
      const nextTrack = q[nextIdx];
      if (nextTrack) {
        currentIndexRef.current = nextIdx; // keep refs in sync for rapid skips
        setCurrentIndex(nextIdx);
        play(nextTrack);
      }
    } else {
      if (rep === "all" && q.length > 0) {
        // Wrap to first; on manual skips pause immediately, but during crossfade preserve overlap
        if (!crossfadeAdvancedRef.current) {
          try {
            audioA.pause();
            audioB.pause();
          } catch {}
        }
        currentIndexRef.current = 0;
        setCurrentIndex(0);
        play(q[0]);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
    }
  };

  const previous = () => {
    manualAdvanceRef.current = true;
    crossfadeAdvancedRef.current = false;
    fadingOutRef.current = false;
    pendingFadeInRef.current = false;
    pendingFadeDurationRef.current = 0;
    const elActive = useARef.current ? audioA : audioB;
    if (elActive.currentTime > 3 && currentIndex >= 0) {
      elActive.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (currentIndex > 0) {
      const newIdx = currentIndex - 1;
      currentIndexRef.current = newIdx;
      setCurrentIndex(newIdx);
      play(queue[newIdx]);
    } else if (repeatMode === "all" && queue.length > 0) {
      // Wrap to last; stop any current element immediately
      try {
        audioA.pause();
        audioB.pause();
      } catch {}
      const newIdx = queue.length - 1;
      currentIndexRef.current = newIdx;
      setCurrentIndex(newIdx);
      play(queue[newIdx]);
    } else if (currentIndex === 0) {
      const el = useARef.current ? audioA : audioB;
      el.currentTime = 0;
      setCurrentTime(0);
    }
  };

  const seek = (time: number) => {
    const el = useARef.current ? audioA : audioB;
    const dur =
      isFinite(el.duration) && el.duration > 0 ? el.duration : duration || 0;
    const clamped = Math.max(0, Math.min(dur > 0 ? dur - 0.05 : time, time));
    el.currentTime = clamped;
    setCurrentTime(clamped);
    if (currentTrack) {
      reportPlaybackProgress(
        serverAddress,
        accessToken,
        currentTrack.Id,
        clamped,
        !isPlaying,
        duration
      );
    }
  };

  const setVolume = (newVolume: number) => {
    const clampedVolume = Math.max(0, Math.min(1, newVolume));
    // Drive Web Audio gain instead of element volume for smooth fades
    audioA.volume = 1;
    audioB.volume = 1;
    try {
      const g = masterGainRef.current;
      const ctx = audioCtxRef.current;
      if (g && ctx) {
        const now = ctx.currentTime;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(clampedVolume, now);
      }
    } catch {}
    setVolumeState(clampedVolume);
  };

  const setPlaybackRate = (rate: number) => {
    const clamped = Math.min(3, Math.max(0.5, rate));
    audioA.playbackRate = clamped;
    audioB.playbackRate = clamped;
    setPlaybackRateState(clamped);
  };

  const setQuality = (q: string) => {
    setQualityState(q);
    try {
      localStorage.setItem("playback_quality", q);
    } catch {}
    // If a track is currently playing, restart it with new quality (unless local file is downloaded)
    (async () => {
      if (currentTrack && isPlaying) {
        const el = useARef.current ? audioA : audioB;
        const pos = el.currentTime;
        const wasPlaying = isPlaying;
        const track = currentTrack;
        // Re-compute URL using new quality, but prefer local downloaded file
        const newUrl = await (async () => {
          const local = await getLocalUrlForTrack(track.Id);
          if (local) return local;
          return getStreamUrl(track);
        })();
        el.src = newUrl;
        setCurrentSrc(newUrl);
        el.currentTime = pos; // keep position best-effort
        // Reset per-stream gain to current normalization scalar (not master volume)
        try {
          const g = useARef.current ? gainARef.current : gainBRef.current;
          const ctx = audioCtxRef.current;
          if (g && ctx) {
            const now = ctx.currentTime;
            g.gain.cancelScheduledValues(now);
            const norm = useARef.current
              ? normGainARef.current
              : normGainBRef.current;
            g.gain.setValueAtTime(Math.max(0.0001, norm || 1), now);
          }
        } catch {}
        if (wasPlaying) {
          try {
            audioCtxRef.current?.resume();
          } catch {}
          el.play().catch(() => {});
        }
      }
    })();
  };

  const addToQueue = (track: Track) => {
    setQueue((prev) => [...prev, track]);
    if (currentIndex === -1) {
      // start playing automatically if first track
      setCurrentIndex(0);
      play(track);
    }
  };

  const addToQueueNext = (track: Track) => {
    setQueue((prev) => {
      if (currentIndex === -1) {
        setCurrentIndex(0);
        play(track);
        return [track];
      }
      const insertPos = currentIndex + 1;
      // If the next item is the same track (by Id), don't insert a duplicate
      if (prev[insertPos] && prev[insertPos].Id === track.Id) {
        return prev;
      }
      const newQ = [
        ...prev.slice(0, insertPos),
        track,
        ...prev.slice(insertPos),
      ];
      return newQ;
    });
  };

  const playNow = (track: Track) => {
    crossfadeAdvancedRef.current = false;
    manualAdvanceRef.current = true;
    const qNow = queueRef.current;
    const idx = qNow.findIndex((t) => t.Id === track.Id);
    if (idx >= 0) {
      setCurrentIndex(idx);
      play(track);
    } else {
      setQueue((prev) => {
        const newQ = [...prev];
        const ins = (currentIndexRef.current ?? -1) + 1;
        newQ.splice(ins, 0, track);
        setCurrentIndex(ins);
        return newQ;
      });
      play(track);
    }
  };

  const playQueue = (tracks: Track[], startIndex: number = 0) => {
    if (!tracks.length) return;
    const clamped = Math.min(Math.max(0, startIndex), tracks.length - 1);
    setQueue(tracks);
    setOriginalQueue(tracks);
    setCurrentIndex(clamped);
    const first = tracks[clamped];
    if (first) {
      (async () => {
        const streamUrl = await resolveTrackUrl(first);
        if (!streamUrl) return;
        audio.src = streamUrl;
        setCurrentSrc(streamUrl);
        setCurrentTrack(first);
        setIsPaused(false);
        // Record which track is on which element for accurate fallback timing
        if (useARef.current) {
          trackARef.current = first;
        } else {
          trackBRef.current = first;
        }
        // Initialize duration with a metadata fallback to prevent stale previous value
        try {
          let dur = audio.duration;
          if (!isFinite(dur) || dur <= 0) {
            const ticks = first?.RunTimeTicks || 0;
            if (ticks > 0) dur = ticks / 10_000_000;
          }
          setDuration(dur || 0);
        } catch {}
        // Prepare fade-in on the active element's stream gain, not master
        try {
          const ctx = audioCtxRef.current;
          const g = useARef.current ? gainARef.current : gainBRef.current;
          if (g && ctx) {
            const now = ctx.currentTime;
            // Compute normalization for the first track if enabled
            let norm = 1;
            if (normalizeEnabled) {
              try {
                const meta = await getTrackNormalizationInfo(
                  serverAddress,
                  accessToken,
                  first.Id
                );
                norm = computeNormalizationScalar(meta);
                if (useARef.current) normGainARef.current = norm;
                else normGainBRef.current = norm;
              } catch {}
            }
            const start = crossfadeSeconds > 0 ? 0.0001 : norm;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(start, now);
            if (crossfadeSeconds > 0) {
              g.gain.linearRampToValueAtTime(
                Math.max(0.0001, norm),
                now + Math.max(0.05, crossfadeSeconds)
              );
            }
          }
        } catch {}
        audio
          .play()
          .then(() => {
            setIsPlaying(true);
            reportPlaybackStart(serverAddress, accessToken, first.Id, 0);
          })
          .catch(() => {});
      })();
    }
  };

  const toggleShuffle = () => {
    const currentId = currentTrack?.Id;
    if (isShuffled) {
      // restore
      if (originalQueue.length) {
        setQueue(originalQueue);
        if (currentId) {
          const idx = originalQueue.findIndex((t) => t.Id === currentId);
          setCurrentIndex(idx >= 0 ? idx : 0);
        }
      }
      setIsShuffled(false);
    } else {
      setOriginalQueue(queue);
      const rest = queue.filter((t) => t.Id !== currentId);
      const shuffled = rest.sort(() => Math.random() - 0.5);
      const newQ = currentId
        ? [queue.find((t) => t.Id === currentId)!, ...shuffled]
        : shuffled;
      setQueue(newQ);
      setCurrentIndex(0);
      setIsShuffled(true);
    }
  };

  const toggleRepeat = () => {
    setRepeatMode((prev) => {
      switch (prev) {
        case "off":
          return "all";
        case "all":
          return "one";
        case "one":
          return "off";
        default:
          return "off";
      }
    });
  };

  const removeFromQueue = (index: number) => {
    setQueue((prev) => {
      const newQ = prev.filter((_, i) => i !== index);
      if (index === currentIndex) {
        if (newQ.length === 0) {
          stop();
          setCurrentIndex(-1);
          setCurrentTrack(null);
        } else {
          const newIdx = index >= newQ.length ? newQ.length - 1 : index;
          setCurrentIndex(newIdx);
          setTimeout(() => play(newQ[newIdx]), 0);
        }
      } else if (index < currentIndex) {
        setCurrentIndex((i) => i - 1);
      }
      return newQ;
    });
  };

  const reorderQueue = (fromIndex: number, toIndex: number) => {
    if (fromIndex === toIndex) return;
    setQueue((prev) => {
      const newQ = [...prev];
      const [moved] = newQ.splice(fromIndex, 1);
      newQ.splice(toIndex, 0, moved);
      if (fromIndex === currentIndex) {
        setCurrentIndex(toIndex);
      } else if (fromIndex < currentIndex && toIndex >= currentIndex) {
        setCurrentIndex((i) => i - 1);
      } else if (fromIndex > currentIndex && toIndex <= currentIndex) {
        setCurrentIndex((i) => i + 1);
      }
      return newQ;
    });
  };

  const jumpToTrack = (index: number) => {
    if (index >= 0 && index < queue.length) {
      crossfadeAdvancedRef.current = false;
      manualAdvanceRef.current = true;
      setCurrentIndex(index);
      play(queue[index]);
    }
  };

  const clearQueue = () => {
    stop();
    setQueue([]);
    setCurrentIndex(-1);
    setCurrentTrack(null);
  };

  const shuffleQueue = () => {
    if (!queue.length) return;
    const currentId = currentTrack?.Id;
    setQueue((prev) => {
      const rest = prev.filter((t) => t.Id !== currentId);
      const shuffled = rest.sort(() => Math.random() - 0.5);
      const newQ = currentId
        ? [prev.find((t) => t.Id === currentId)!, ...shuffled]
        : shuffled;
      setCurrentIndex(currentId ? 0 : 0);
      return newQ;
    });
  };

  // Handle audio ended event (advance or stop)
  useEffect(() => {
    const handleEnded = (e: Event) => {
      const el =
        (e.currentTarget as HTMLMediaElement) ||
        (useARef.current ? audioA : audioB);
      const endedTrack = el === audioA ? trackARef.current : trackBRef.current;
      if (crossfadeAdvancedRef.current) {
        // Already advanced for crossfade; don't flip play state
      } else {
        setIsPlaying(false);
        setIsPaused(false);
        setDuration(0);
      }
      if (!crossfadeAdvancedRef.current) {
        const rep = repeatModeRef.current;
        const idx = currentIndexRef.current;
        const q = queueRef.current;
        if (rep === "one") {
          if (idx >= 0 && idx < q.length) play(q[idx]);
        } else {
          next();
        }
      }
      // No master fade-in here; per-stream gains handle it
      fadingOutRef.current = false;
      pendingFadeInRef.current = false;
      crossfadeAdvancedRef.current = false;
      if (endedTrack) {
        reportPlaybackStopped(
          serverAddress,
          accessToken,
          endedTrack.Id,
          el.duration || el.currentTime
        );
      }
    };
    audioA.addEventListener("ended", handleEnded);
    audioB.addEventListener("ended", handleEnded);
    return () => {
      audioA.removeEventListener("ended", handleEnded);
      audioB.removeEventListener("ended", handleEnded);
    };
  }, [repeatMode, queue, currentIndex, currentTrack]);

  // Setup Media Session API action handlers
  useEffect(() => {
    if ("mediaSession" in navigator) {
      // Set up basic action handlers
      navigator.mediaSession.setActionHandler("play", () => {
        if (isPaused && currentTrack) {
          resume();
        }
      });

      navigator.mediaSession.setActionHandler("pause", () => {
        if (isPlaying) {
          pause();
        }
      });

      navigator.mediaSession.setActionHandler("previoustrack", () => {
        previous();
      });

      navigator.mediaSession.setActionHandler("nexttrack", () => {
        next();
      });

      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined) {
          seek(details.seekTime);
        }
      });

      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        const skipTime = details.seekOffset || 10;
        seek(Math.max(0, currentTime - skipTime));
      });

      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        const skipTime = details.seekOffset || 10;
        seek(Math.min(duration, currentTime + skipTime));
      });
    }
  }, [
    isPlaying,
    isPaused,
    currentTrack,
    currentTime,
    duration,
    toggleShuffle,
    toggleRepeat,
  ]);

  // Hydrate persisted playback settings
  useEffect(() => {
    try {
      const stored = JSON.parse(
        localStorage.getItem("playbackSettings") || "{}"
      );
      if (typeof stored.volume === "number") {
        const vol = Math.max(0, Math.min(1, stored.volume));
        audio.volume = 1;
        try {
          const g = masterGainRef.current;
          const ctx = audioCtxRef.current;
          if (g && ctx) {
            const now = ctx.currentTime || 0;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(vol, now);
          }
        } catch {}
        setVolumeState(vol);
      }
      if (typeof stored.playbackRate === "number") {
        const rate = Math.min(3, Math.max(0.5, stored.playbackRate));
        audio.playbackRate = rate;
        setPlaybackRateState(rate);
      }
    } catch {}
  }, []);

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem(
        "playbackSettings",
        JSON.stringify({ volume, playbackRate })
      );
    } catch {}
  }, [volume, playbackRate]);

  useEffect(() => {
    try {
      const storedQueueRaw = localStorage.getItem("savedQueue");
      if (storedQueueRaw) {
        const saved = JSON.parse(storedQueueRaw) as Partial<Track>[];
        if (Array.isArray(saved) && saved.length) {
          // Minimal track objects are fine; MediaSources will be loaded when played
          const restored = saved
            .filter((t) => t && t.Id)
            .map((t) => ({
              Id: t.Id as string,
              Name: t.Name || "Unknown Title",
              Artist: t.Artist,
              AlbumArtist: t.AlbumArtist,
              Album: t.Album,
              ImageTags: t.ImageTags,
            })) as Track[];
          setQueue(restored);
          setOriginalQueue(restored);
          setCurrentIndex(restored.length ? 0 : -1);
          setCurrentTrack(restored.length ? restored[0] : null);
        }
      }
    } catch (e) {
      logger.warn("Failed to restore saved queue", e);
    }
  }, []);

  // Persist queue whenever it changes
  useEffect(() => {
    try {
      if (!queue.length) {
        localStorage.removeItem("savedQueue");
        return;
      }
      const lightweight = queue.slice(0, 200).map((t) => ({
        Id: t.Id,
        Name: t.Name,
        Artist: t.Artist,
        AlbumArtist: t.AlbumArtist,
        Album: t.Album,
        ImageTags: t.ImageTags,
      }));
      localStorage.setItem("savedQueue", JSON.stringify(lightweight));
    } catch (e) {
      logger.warn("Failed to persist queue", e);
    }
  }, [queue]);

  const value: MusicContextType = {
    currentTrack,
    isPlaying,
    isPaused,
    currentTime,
    duration,
    volume,
    queue,
    currentIndex,
    repeatMode,
    isShuffled,
    play,
    pause,
    resume,
    stop,
    next,
    previous,
    seek,
    setVolume,
    addToQueue,
    addToQueueNext,
    playNow,
    playQueue,
    removeFromQueue,
    reorderQueue,
    jumpToTrack,
    clearQueue,
    shuffleQueue,
    toggleShuffle,
    toggleRepeat,
    serverAddress,
    accessToken,
    playbackRate,
    setPlaybackRate,
    quality,
    setQuality,
    currentSrc,
    // effects
    normalizeEnabled,
    setNormalizeEnabled,
    crossfadeSeconds,
    setCrossfadeSeconds,
  };

  return (
    <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
  );
};
