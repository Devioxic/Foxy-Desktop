import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
} from "react";
import { logger } from "@/lib/logger";
import {
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  getAudioStreamInfo,
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
    Container: string;
    DirectStreamUrl?: string;
    Bitrate?: number; // bits per second
    AudioCodec?: string;
    AudioChannels?: number;
    SampleRate?: number; // Hz
    BitsPerSample?: number;
    TranscodingUrl?: string;
    IsDirectStream?: boolean;
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
  const fadingOutRef = useRef<boolean>(false);
  const pendingFadeInRef = useRef<boolean>(false);
  const crossfadeAdvancedRef = useRef<boolean>(false);
  // When user explicitly skips/previous/jumps, don't crossfade — cut immediately
  const manualAdvanceRef = useRef<boolean>(false);
  const prefetchedNextIdRef = useRef<string | null>(null);
  const useARef = useRef<boolean>(true); // which element is active now

  // Get auth data from localStorage
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const serverAddress = authData.serverAddress || "";
  const accessToken = authData.accessToken || "";

  const audioA = audioARef.current;
  const audioB = audioBRef.current;
  const audio = useARef.current ? audioA : audioB;

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
  }, [normalizeEnabled]);

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
    const handleTimeUpdate = () => {
      const el = useARef.current ? audioA : audioB;
      const currentTime = el.currentTime;
      setCurrentTime(currentTime);
      // Crossfade fade-out near the end
      try {
        // Prefer audio.duration; fall back to track runtime if stream doesn't expose duration
        let dur = el.duration || 0;
        if (!isFinite(dur) || dur <= 0) {
          const ticks = currentTrack?.RunTimeTicks || 0;
          if (ticks > 0) dur = ticks / 10_000_000; // Jellyfin ticks to seconds
        }
        const remain = dur > 0 ? dur - currentTime : Infinity;
        if (
          crossfadeSeconds > 0 &&
          !fadingOutRef.current &&
          isFinite(remain) &&
          remain <= crossfadeSeconds + 0.02 &&
          isPlaying
        ) {
          const ctx = audioCtxRef.current;
          const g = useARef.current ? gainARef.current : gainBRef.current;
          if (ctx && g) {
            const now = ctx.currentTime;
            const start = Math.max(0.0001, g.gain.value);
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(start, now);
            g.gain.linearRampToValueAtTime(
              0.0001,
              now + Math.max(0.05, crossfadeSeconds)
            );
            fadingOutRef.current = true;
            pendingFadeInRef.current = true;
          }
        }

        // If fade-out has started, advance to next track just before end to avoid a dead gap
        // If fade window is reached and we haven't advanced, start next now for true overlap
        if (
          crossfadeSeconds > 0 &&
          !crossfadeAdvancedRef.current &&
          isFinite(remain) &&
          remain <= crossfadeSeconds &&
          isPlaying
        ) {
          crossfadeAdvancedRef.current = true;
          next();
        }
      } catch {}

      // Prefetch next for gapless
      try {
        if (queue.length > 0) {
          const nextIdx =
            currentIndex < queue.length - 1
              ? currentIndex + 1
              : repeatMode === "all"
                ? 0
                : -1;
          if (nextIdx >= 0) {
            const nextTrack = queue[nextIdx];
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
      // Throttle progress reporting (every 5s or on near end)
      if (currentTrack) {
        const now = Date.now();
        if (
          now - lastProgressReportRef.current > 5000 ||
          currentTime + 3 >= (el.duration || 0)
        ) {
          lastProgressReportRef.current = now;
          reportPlaybackProgress(
            serverAddress,
            accessToken,
            currentTrack.Id,
            currentTime,
            !isPlaying,
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

    const handleDurationChange = () => {
      const el = useARef.current ? audioA : audioB;
      setDuration(el.duration);
    };
    const handleLoadStart = () => setCurrentTime(0);

    audioA.addEventListener("timeupdate", handleTimeUpdate);
    audioB.addEventListener("timeupdate", handleTimeUpdate);
    audioA.addEventListener("durationchange", handleDurationChange);
    audioB.addEventListener("durationchange", handleDurationChange);
    audioA.addEventListener("loadstart", handleLoadStart);
    audioB.addEventListener("loadstart", handleLoadStart);

    return () => {
      audioA.removeEventListener("timeupdate", handleTimeUpdate);
      audioB.removeEventListener("timeupdate", handleTimeUpdate);
      audioA.removeEventListener("durationchange", handleDurationChange);
      audioB.removeEventListener("durationchange", handleDurationChange);
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
      let targetTrack: Track | null = null;
      if (track) {
        const existingIndex = queue.findIndex((t) => t.Id === track.Id);
        if (existingIndex >= 0) {
          setCurrentIndex(existingIndex);
          targetTrack = queue[existingIndex];
        } else {
          // append track
          setQueue((prev) => {
            const newQ = [...prev, track];
            setCurrentIndex(newQ.length - 1);
            return newQ;
          });
          targetTrack = track;
        }
      } else if (currentIndex >= 0 && currentIndex < queue.length) {
        targetTrack = queue[currentIndex];
      }

      if (!targetTrack) return;

      if (!track && audio.src && !audio.paused) {
        // toggle pause? handled elsewhere
      }

      const streamUrl = await resolveTrackUrl(targetTrack);
      if (!streamUrl) return;
      // Choose target element (if currently A, load into B, and vice versa) for overlap
      const useA = useARef.current;
      const targetEl = useA ? audioB : audioA;
      const targetGain = useA ? gainBRef.current : gainARef.current;
      const currentGain = useA ? gainARef.current : gainBRef.current;
      const currentEl = useA ? audioA : audioB;
      targetEl.src = streamUrl;
      setCurrentSrc(streamUrl);
      setCurrentTrack(targetTrack);
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

      // Prepare fade-in on the target element and fade-out current if playing
      try {
        const g = targetGain;
        const ctx = audioCtxRef.current;
        if (g && ctx) {
          const now = ctx.currentTime;
          const manual = manualAdvanceRef.current;
          const doFade = crossfadeSeconds > 0 && !manual;
          const fade = Math.max(0.05, crossfadeSeconds);
          g.gain.cancelScheduledValues(now);
          g.gain.setValueAtTime(doFade ? 0.0001 : volume, now);
          if (doFade) g.gain.linearRampToValueAtTime(volume, now + fade);
          if (isPlaying && currentGain) {
            currentGain.gain.cancelScheduledValues(now);
            currentGain.gain.setValueAtTime(
              Math.max(0.0001, currentGain.gain.value),
              now
            );
            if (doFade) {
              currentGain.gain.linearRampToValueAtTime(0.0001, now + fade);
              // After fade completes, pause the previous element to avoid both playing
              setTimeout(
                () => {
                  try {
                    currentEl.pause();
                  } catch {}
                },
                Math.ceil(fade * 1000) + 50
              );
            } else {
              // Manual or no-crossfade: silence and pause immediately
              currentGain.gain.setValueAtTime(0.0001, now);
              try {
                currentEl.pause();
              } catch {}
            }
          }
        }
      } catch {}
      // Reset manual flag after preparing transition
      manualAdvanceRef.current = false;
      crossfadeAdvancedRef.current = false;
      try {
        audioCtxRef.current?.resume();
      } catch {}
      await targetEl.play();
      // Switch active element after starting
      useARef.current = !useA;
      setIsPlaying(true);
      reportPlaybackStart(serverAddress, accessToken, targetTrack.Id, 0);
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
    // Only mark manual when not triggered by the crossfade window
    if (!crossfadeAdvancedRef.current) {
      manualAdvanceRef.current = true;
    }
    if (repeatMode === "one") {
      if (currentIndex >= 0) {
        play(queue[currentIndex]);
      }
      return;
    }
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((i) => i + 1);
      const nextTrack = queue[currentIndex + 1];
      if (nextTrack) play(nextTrack);
    } else {
      if (repeatMode === "all" && queue.length > 0) {
        setCurrentIndex(0);
        play(queue[0]);
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
    }
  };

  const previous = () => {
    manualAdvanceRef.current = true;
    const elActive = useARef.current ? audioA : audioB;
    if (elActive.currentTime > 3 && currentIndex >= 0) {
      elActive.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    if (currentIndex > 0) {
      setCurrentIndex((i) => i - 1);
      play(queue[currentIndex - 1]);
    } else if (repeatMode === "all" && queue.length > 0) {
      setCurrentIndex(queue.length - 1);
      play(queue[queue.length - 1]);
    } else if (currentIndex === 0) {
      const el = useARef.current ? audioA : audioB;
      el.currentTime = 0;
      setCurrentTime(0);
    }
  };

  const seek = (time: number) => {
    const el = useARef.current ? audioA : audioB;
    el.currentTime = time;
    setCurrentTime(time);
    if (currentTrack) {
      reportPlaybackProgress(
        serverAddress,
        accessToken,
        currentTrack.Id,
        time,
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
        // Reset gain to current volume
        try {
          const g = useARef.current ? gainARef.current : gainBRef.current;
          const ctx = audioCtxRef.current;
          if (g && ctx) {
            const now = ctx.currentTime;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(volume, now);
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
    const idx = queue.findIndex((t) => t.Id === track.Id);
    if (idx >= 0) {
      setCurrentIndex(idx);
      play(track);
    } else {
      setQueue((prev) => {
        const newQ = [...prev];
        newQ.splice(currentIndex + 1, 0, track);
        setCurrentIndex(currentIndex + 1);
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
        // Prepare fade-in on the active element's stream gain, not master
        try {
          const ctx = audioCtxRef.current;
          const g = useARef.current ? gainARef.current : gainBRef.current;
          if (g && ctx) {
            const now = ctx.currentTime;
            const start = crossfadeSeconds > 0 ? 0.0001 : volume;
            g.gain.cancelScheduledValues(now);
            g.gain.setValueAtTime(start, now);
            if (crossfadeSeconds > 0) {
              g.gain.linearRampToValueAtTime(
                volume,
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
    const handleEnded = () => {
      setIsPlaying(false);
      setIsPaused(false);
      if (crossfadeAdvancedRef.current) {
        // We already advanced early for crossfade; just reset flags
      } else if (repeatMode === "one") {
        if (currentIndex >= 0) play(queue[currentIndex]);
      } else {
        next();
      }
      // No master fade-in here; per-stream gains handle it
      fadingOutRef.current = false;
      pendingFadeInRef.current = false;
      crossfadeAdvancedRef.current = false;
      if (currentTrack) {
        reportPlaybackStopped(
          serverAddress,
          accessToken,
          currentTrack.Id,
          (useARef.current ? audioA : audioB).currentTime
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

      // Try to set experimental shuffle/repeat actions if they exist
      try {
        // @ts-ignore - These are experimental APIs that may not be in all browsers
        if ("setActionHandler" in navigator.mediaSession) {
          // @ts-ignore
          navigator.mediaSession.setActionHandler("shuffle", () => {
            toggleShuffle();
          });
          // @ts-ignore
          navigator.mediaSession.setActionHandler("repeat", () => {
            toggleRepeat();
          });
        }
      } catch (error) {
        logger.debug("Experimental shuffle/repeat actions not supported");
      }
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
