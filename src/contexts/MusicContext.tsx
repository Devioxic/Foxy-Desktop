import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
} from "react";
import {
  reportPlaybackStart,
  reportPlaybackProgress,
  reportPlaybackStopped,
  getAudioStreamInfo,
} from "@/lib/jellyfin";

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
  const audioRef = useRef<HTMLAudioElement>(new Audio());
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
  const lastProgressReportRef = useRef<number>(0);

  // Get auth data from localStorage
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const serverAddress = authData.serverAddress || "";
  const accessToken = authData.accessToken || "";

  const audio = audioRef.current;

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
        console.debug("Extended playback state not supported");
      }
    }
  };

  // Update media session when track, playback state, or shuffle/repeat modes change
  useEffect(() => {
    updateMediaSession(currentTrack);
  }, [currentTrack, isPlaying, serverAddress, isShuffled, repeatMode]);

  // Audio event listeners - basic ones only
  useEffect(() => {
    const handleTimeUpdate = () => {
      const currentTime = audio.currentTime;
      setCurrentTime(currentTime);
      // Throttle progress reporting (every 5s or on near end)
      if (currentTrack) {
        const now = Date.now();
        if (
          now - lastProgressReportRef.current > 5000 ||
          currentTime + 3 >= (audio.duration || 0)
        ) {
          lastProgressReportRef.current = now;
          reportPlaybackProgress(
            serverAddress,
            accessToken,
            currentTrack.Id,
            currentTime,
            !isPlaying,
            audio.duration || undefined
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
            duration: audio.duration || 0,
            playbackRate: audio.playbackRate,
            position: currentTime,
          });
        } catch (error) {
          // Some browsers might not support all position state features
          console.warn("Media Session position state update failed:", error);
        }
      }
    };

    const handleDurationChange = () => setDuration(audio.duration);
    const handleLoadStart = () => setCurrentTime(0);

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("durationchange", handleDurationChange);
    audio.addEventListener("loadstart", handleLoadStart);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("durationchange", handleDurationChange);
      audio.removeEventListener("loadstart", handleLoadStart);
    };
  }, []);

  // Helper function to get streaming URL
  const getStreamUrl = (track: Track): string => {
    if (!serverAddress || !accessToken) return "";

    // Base direct URL
    let baseUrl = `${serverAddress}/Audio/${track.Id}/stream?static=true&api_key=${accessToken}`;

    // Quality limiting (Jellyfin supports MaxStreamingBitrate)
    if (quality && quality !== "auto") {
      const map: Record<string, number> = {
        low: 128000,
        medium: 256000,
        high: 320000,
      };
      const limit = map[quality];
      if (limit) {
        baseUrl += `&MaxStreamingBitrate=${limit}`;
      }
    }
    return baseUrl;
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

      const streamUrl = getStreamUrl(targetTrack);
      if (!streamUrl) return;
      audio.src = streamUrl;
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

      await audio.play();
      setIsPlaying(true);
      reportPlaybackStart(serverAddress, accessToken, targetTrack.Id, 0);
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
      }
    } catch (e) {
      console.error("Error playing track", e);
    }
  };

  const pause = () => {
    audio.pause();
    setIsPlaying(false);
    setIsPaused(true);
    if (currentTrack) {
      reportPlaybackProgress(
        serverAddress,
        accessToken,
        currentTrack.Id,
        audio.currentTime,
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
    if (isPaused && currentTrack) {
      play();
    }
  };

  const stop = () => {
    audio.pause();
    audio.currentTime = 0;
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
    if (audio.currentTime > 3 && currentIndex >= 0) {
      audio.currentTime = 0;
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
      audio.currentTime = 0;
      setCurrentTime(0);
    }
  };

  const seek = (time: number) => {
    audio.currentTime = time;
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
    audio.volume = clampedVolume;
    setVolumeState(clampedVolume);
  };

  const setPlaybackRate = (rate: number) => {
    const clamped = Math.min(3, Math.max(0.5, rate));
    audio.playbackRate = clamped;
    setPlaybackRateState(clamped);
  };

  const setQuality = (q: string) => {
    setQualityState(q);
    try {
      localStorage.setItem("playback_quality", q);
    } catch {}
    // If a track is currently playing, restart it with new quality
    if (currentTrack && isPlaying) {
      const pos = audio.currentTime;
      const wasPlaying = isPlaying;
      const track = currentTrack;
      const newUrl = getStreamUrl(track);
      audio.src = newUrl;
      audio.currentTime = Math.min(pos, audio.duration || pos);
      if (wasPlaying) {
        audio.play().catch(() => {});
      }
    }
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
      const streamUrl = getStreamUrl(first);
      if (streamUrl) {
        audio.src = streamUrl;
        setCurrentTrack(first);
        setIsPaused(false);
        audio.play().then(() => {
          setIsPlaying(true);
          reportPlaybackStart(serverAddress, accessToken, first.Id, 0);
        });
      }
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
      if (repeatMode === "one") {
        if (currentIndex >= 0) play(queue[currentIndex]);
      } else {
        next();
      }
      if (currentTrack) {
        reportPlaybackStopped(
          serverAddress,
          accessToken,
          currentTrack.Id,
          audio.currentTime
        );
      }
    };
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
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
        console.debug("Experimental shuffle/repeat actions not supported");
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
        audio.volume = vol;
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
      console.warn("Failed to restore saved queue", e);
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
      console.warn("Failed to persist queue", e);
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
  };

  return (
    <MusicContext.Provider value={value}>{children}</MusicContext.Provider>
  );
};
