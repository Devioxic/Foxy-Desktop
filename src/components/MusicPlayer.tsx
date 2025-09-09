import React, { useState } from "react";
import { logger } from "@/lib/logger";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import AddToPlaylistDialog from "@/components/AddToPlaylistDialog";
import { useMusicPlayer } from "@/contexts/MusicContext";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Music,
  Star,
  Plus,
  Repeat,
  Repeat1,
  Shuffle,
  List,
  GripVertical,
  X,
  Mic,
  Loader2,
  Info,
} from "lucide-react";
import { findArtistByName, findAlbumByName } from "@/lib/jellyfin";
// Add favorite helpers
import {
  addToFavorites,
  removeFromFavorites,
  checkIsFavorite,
} from "@/lib/jellyfin";
import LyricsComponent from "@/components/LyricsComponent";

interface MusicPlayerProps {
  showLyrics?: boolean;
  onLyricsToggle?: (show: boolean) => void;
}

const MusicPlayer: React.FC<MusicPlayerProps> = ({
  showLyrics: externalShowLyrics,
  onLyricsToggle,
}) => {
  const navigate = useNavigate();
  const [showQueue, setShowQueue] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  // Favorite state for current track
  const [isFavorite, setIsFavorite] = useState(false);
  const [favoriteLoading, setFavoriteLoading] = useState(false);

  // Use external state if provided, otherwise use internal state
  const [internalShowLyrics, setInternalShowLyrics] = useState(false);
  const showLyrics =
    externalShowLyrics !== undefined ? externalShowLyrics : internalShowLyrics;

  const toggleLyrics = (show: boolean) => {
    if (onLyricsToggle) {
      onLyricsToggle(show);
    } else {
      setInternalShowLyrics(show);
    }
  };

  const {
    currentTrack,
    isPlaying,
    isPaused,
    currentTime,
    duration,
    volume,
    repeatMode,
    isShuffled,
    queue,
    currentIndex,
    play,
    pause,
    resume,
    next,
    previous,
    seek,
    setVolume,
    toggleRepeat,
    toggleShuffle,
    removeFromQueue,
    reorderQueue,
    jumpToTrack,
    serverAddress,
    accessToken,
    currentSrc,
  } = useMusicPlayer();
  const handleArtistClick = async (artistName: string) => {
    try {
      const original = artistName;
      let attemptNames: string[] = [];
      if (artistName.includes(",")) {
        attemptNames = [
          original,
          ...original
            .split(",")
            .map((p) => p.trim())
            .filter(Boolean),
        ];
      } else if (/&/.test(artistName)) {
        attemptNames = [
          original,
          ...artistName
            .split(/&/)
            .map((p) => p.trim())
            .filter(Boolean),
        ];
      } else {
        attemptNames = [original];
      }

      for (const name of attemptNames) {
        if (!name) continue;
        try {
          const artist = await findArtistByName(name);
          if (artist?.Id) {
            navigate(`/artist/${artist.Id}`);
            return;
          }
        } catch {}
      }
      // Final fallback: use first segment encoded
      const fallback = attemptNames[1] || attemptNames[0] || original;
      navigate(`/artist/${encodeURIComponent(fallback)}`);
    } catch (error) {
      logger.error("Error finding artist:", error);
      navigate(`/artist/${encodeURIComponent(artistName)}`);
    }
  };

  const handleAlbumClick = async (albumName: string, artistName?: string) => {
    try {
      // Try to find the album by name to get its ID
      const album = await findAlbumByName(albumName, artistName);
      if (album?.Id) {
        navigate(`/album/${album.Id}`);
      } else {
        // Fallback: encode and search
        navigate(`/album/${encodeURIComponent(albumName)}`);
      }
    } catch (error) {
      logger.error("Error finding album:", error);
      // Fallback navigation
      navigate(`/album/${encodeURIComponent(albumName)}`);
    }
  };

  const formatTime = (seconds: number): string => {
    if (isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handlePlayPause = () => {
    if (isPlaying) {
      pause();
    } else if (isPaused) {
      // Resume from current position when paused
      resume();
    } else {
      // Start playback (e.g., from stopped/ended)
      play();
    }
  };

  const handleSeek = (value: number[]) => {
    seek(value[0]);
  };

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0] / 100);
  };

  const getAlbumArt = (track: any) => {
    if (track?.ImageTags?.Primary && serverAddress) {
      return `${serverAddress}/Items/${track.Id}/Images/Primary?maxWidth=120&quality=90`;
    }
    return null;
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (draggedIndex !== null && draggedIndex !== dropIndex) {
      reorderQueue(draggedIndex, dropIndex);
    }
    setDraggedIndex(null);
  };

  const handleTrackClick = (index: number) => {
    if (index !== currentIndex) {
      jumpToTrack(index);
    }
  };

  React.useEffect(() => {
    const loadFavorite = async () => {
      if (!currentTrack?.Id || !serverAddress || !accessToken) {
        setIsFavorite(false);
        return;
      }
      try {
        const fav = await checkIsFavorite(
          serverAddress,
          accessToken,
          currentTrack.Id
        );
        setIsFavorite(fav);
      } catch (e) {
        logger.warn("Failed to check favorite status", e);
      }
    };
    loadFavorite();
  }, [currentTrack?.Id, serverAddress, accessToken]);

  const toggleCurrentTrackFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!currentTrack?.Id || !serverAddress || !accessToken || favoriteLoading)
      return;
    setFavoriteLoading(true);
    try {
      if (isFavorite) {
        await removeFromFavorites(serverAddress, accessToken, currentTrack.Id);
        setIsFavorite(false);
      } else {
        await addToFavorites(serverAddress, accessToken, currentTrack.Id);
        setIsFavorite(true);
      }
    } catch (err) {
      logger.error("Failed to toggle favorite", err);
    } finally {
      setFavoriteLoading(false);
    }
  };

  const qualityInfo = React.useMemo(() => {
    // Try to infer from the active URL first
    if (currentSrc) {
      try {
        const url = new URL(currentSrc);
        // Local downloaded file via custom media:/// protocol
        if (url.protocol === "media:") {
          const ms: any = currentTrack?.MediaSources?.[0];
          const codec = (ms?.AudioCodec || "").toString().toUpperCase();
          const containerMs = (ms?.Container || "").toString().toUpperCase();
          const bitrateBps = ms?.Bitrate || ms?.BitRate;
          const bitrateKbps = bitrateBps ? Math.round(bitrateBps / 1000) : null;
          const showCodec =
            codec && containerMs && codec !== containerMs ? codec : null;
          const parts = [
            containerMs || codec || null,
            showCodec,
            bitrateKbps ? `${bitrateKbps}kbps` : null,
          ].filter(Boolean);
          const label = parts.join(" • ") || "Local file";
          return { label, source: "Local" };
        }
        const isUniversal =
          /\/universal$/i.test(url.pathname) ||
          url.pathname.includes("/universal");
        const maxBr = url.searchParams.get("MaxStreamingBitrate");
        const container = (
          url.searchParams.get("Container") || ""
        ).toUpperCase();
        if (isUniversal || maxBr) {
          const kbps = maxBr ? Math.round(parseInt(maxBr, 10) / 1000) : null;
          const parts = [container || null, kbps ? `${kbps}kbps` : null].filter(
            Boolean
          );
          return { label: parts.join(" • "), source: "Transcode" };
        }
        // Direct/static stream
        if (
          url.pathname.includes("/Audio/") &&
          url.searchParams.get("static") === "true"
        ) {
          // Fall through to metadata for details
          // Mark as Direct if no universal params are present
          const ms: any = currentTrack?.MediaSources?.[0];
          const codec = (ms?.AudioCodec || "").toString().toUpperCase();
          const containerMs = (ms?.Container || "").toString().toUpperCase();
          const bitrateBps = ms?.Bitrate || ms?.BitRate;
          const bitrateKbps = bitrateBps ? Math.round(bitrateBps / 1000) : null;
          const showCodec =
            codec && containerMs && codec !== containerMs ? codec : null;
          const parts = [
            containerMs || codec || null,
            showCodec,
            bitrateKbps ? `${bitrateKbps}kbps` : null,
          ].filter(Boolean);
          return { label: parts.join(" • "), source: "Direct" };
        }
      } catch {}
    }
    const ms: any = currentTrack?.MediaSources?.[0];
    if (!ms) return null;
    // Prefer top-level, fall back to first audio MediaStream
    const audioStream = ms.MediaStreams?.find((s: any) => s?.Type === "Audio");
    const bitrateBps =
      ms.Bitrate || ms.BitRate || audioStream?.BitRate || audioStream?.Bitrate;
    const bitrateKbps = bitrateBps ? Math.round(bitrateBps / 1000) : null;
    const sampleRateHz = ms.SampleRate || audioStream?.SampleRate;
    const sr = sampleRateHz ? `${Math.round(sampleRateHz / 1000)}kHz` : null;
    const channels =
      ms.AudioChannels ||
      audioStream?.Channels ||
      audioStream?.ChannelLayout ||
      null;
    const ch = channels ? `${channels}ch` : null;
    const codec = (ms.AudioCodec || audioStream?.Codec || "")
      .toString()
      .toUpperCase();
    const containerMs = (ms.Container || "").toString().toUpperCase();
    const bitDepth =
      ms.BitsPerSample ||
      ms.BitDepth ||
      audioStream?.BitsPerSample ||
      audioStream?.BitDepth;
    const bits = bitDepth ? `${bitDepth}-bit` : null;
    const parts = [
      containerMs || codec || null,
      codec && containerMs && codec !== containerMs ? codec : null,
      bits,
      sr,
      ch,
      bitrateKbps ? `${bitrateKbps}kbps` : null,
    ].filter(Boolean);
    const source = ms.IsDirectStream
      ? "Direct"
      : ms.TranscodingUrl || ms.TranscodeUrl
        ? "Transcode"
        : undefined;
    return { label: parts.join(" • "), source };
  }, [currentTrack?.MediaSources, currentTrack?.Id, currentSrc]);

  if (!currentTrack) {
    return null;
  }

  const albumArt = getAlbumArt(currentTrack);

  return (
    <div className="fixed bottom-0 left-64 right-0 h-[81px] bg-card border-t border-border shadow-sm z-30">
      <div className="grid grid-cols-[auto_1fr_auto] items-center h-full px-2 relative gap-6">
        {/* Track Info */}
        <div className="flex items-center gap-3 flex-shrink-0 w-96 overflow-hidden">
          <div className="w-16 h-16 rounded-md overflow-hidden bg-muted shadow-sm flex-shrink-0">
            {albumArt ? (
              <img
                src={albumArt}
                alt={currentTrack.Name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Music className="w-6 h-6 text-muted-foreground" />
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <div className="flex flex-col flex-1 min-w-0">
              <button
                className="font-medium text-card-foreground text-sm w-full truncate whitespace-nowrap hover:text-primary hover:underline transition-colors text-left"
                onClick={() => {
                  const albumName = currentTrack.Album || "Unknown Album";
                  const artistName =
                    currentTrack.AlbumArtist || currentTrack.Artist;
                  handleAlbumClick(albumName, artistName);
                }}
                title={currentTrack.Name}
              >
                {currentTrack.Name}
              </button>
              <button
                className="text-xs text-muted-foreground hover:text-primary hover:underline transition-colors text-left truncate w-full"
                onClick={() => {
                  const artistName =
                    currentTrack.AlbumArtist ||
                    currentTrack.Artist ||
                    "Unknown Artist";
                  handleArtistClick(artistName);
                }}
                title={
                  currentTrack.AlbumArtist ||
                  currentTrack.Artist ||
                  "Unknown Artist"
                }
              >
                {currentTrack.AlbumArtist ||
                  currentTrack.Artist ||
                  "Unknown Artist"}
              </button>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1 text-muted-foreground hover:text-primary hover:bg-accent cursor-pointer"
                  onClick={toggleCurrentTrackFavorite}
                  disabled={favoriteLoading}
                  title={
                    isFavorite ? "Remove from favourites" : "Add to favourites"
                  }
                >
                  {favoriteLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Star
                      className={`w-4 h-4 transition-colors ${
                        isFavorite
                          ? "text-primary fill-primary"
                          : "text-muted-foreground"
                      }`}
                    />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddToPlaylist(true)}
                  className="p-1 text-muted-foreground hover:text-primary hover:bg-accent cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* Player Controls */}
        <div className="justify-self-center flex flex-col items-center space-y-1.5 px-4 w-full max-w-2xl">
          {/* Control Buttons */}
          <div className="flex items-center space-x-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleShuffle}
              className={`p-1.5 hover:bg-accent ${
                isShuffled
                  ? "text-primary hover:text-primary/80"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={isShuffled ? "Turn off shuffle" : "Turn on shuffle"}
            >
              <Shuffle className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={previous}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Previous track"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
            <Button
              onClick={handlePlayPause}
              className="rounded-full w-9 h-9 bg-primary hover:bg-primary/90 shadow-sm p-0 flex items-center justify-center"
              title={isPlaying ? "Pause" : isPaused ? "Resume" : "Play"}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 text-primary-foreground" />
              ) : (
                <Play className="w-4 h-4 text-primary-foreground ml-0.5" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={next}
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent"
              title="Next track"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleRepeat}
              className={`p-1.5 hover:bg-accent ${
                repeatMode !== "off"
                  ? "text-primary hover:text-primary/80"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              title={
                repeatMode === "off"
                  ? "Turn on repeat"
                  : repeatMode === "all"
                    ? "Repeat one"
                    : "Turn off repeat"
              }
            >
              {repeatMode === "one" ? (
                <Repeat1 className="w-4 h-4" />
              ) : (
                <Repeat className="w-4 h-4" />
              )}
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="flex items-center space-x-2 w-full">
            <span className="text-xs text-muted-foreground w-8 text-right">
              {formatTime(currentTime)}
            </span>
            <div className="group flex-1 relative py-2">
              <Slider
                value={[currentTime]}
                max={duration || 100}
                step={1}
                onValueChange={handleSeek}
                className="flex-1"
              />
            </div>
            <span className="text-xs text-muted-foreground w-8">
              {formatTime(duration)}
            </span>
          </div>
        </div>

        {/* Volume Control, Lyrics, and Queue */}
        <div className="flex items-center space-x-2 flex-shrink-0 w-80 justify-end">
          {qualityInfo && (
            <div className="hidden xl:flex flex-col items-end mr-2 leading-tight">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {qualityInfo.source || "Stream"}
              </span>
              <span
                className="text-xs text-foreground max-w-[140px] truncate"
                title={qualityInfo.label}
              >
                {qualityInfo.label}
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setVolume(volume > 0 ? 0 : 1)}
            className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            {volume === 0 ? (
              <VolumeX className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4" />
            )}
          </Button>
          <div className="group relative py-2 w-28">
            <Slider
              value={[volume * 100]}
              max={100}
              step={1}
              onValueChange={handleVolumeChange}
              className="w-full"
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => toggleLyrics(!showLyrics)}
            className={`p-1 hover:bg-accent ${
              showLyrics
                ? "text-primary hover:text-primary/80"
                : "text-muted-foreground hover:text-foreground"
            }`}
            disabled={!currentTrack}
            title={showLyrics ? "Hide lyrics" : "Show lyrics"}
          >
            <Mic className="w-4 h-4" />
          </Button>
          <Sheet open={showQueue} onOpenChange={setShowQueue}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="p-1 text-muted-foreground hover:text-foreground hover:bg-accent"
                title="Show queue"
              >
                <List className="w-4 h-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-96">
              <SheetHeader>
                <SheetTitle>Queue</SheetTitle>
                <SheetDescription>
                  {queue.length === 0
                    ? "Your queue is empty"
                    : `${queue.length} songs in queue`}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-6 h-[calc(100vh-140px)] overflow-y-auto">
                <div className="space-y-2 pr-2">
                  {queue.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Music className="w-12 h-12 mx-auto mb-3 opacity-50 text-muted-foreground" />
                      <p>No songs in queue</p>
                      <p className="text-sm">
                        Start playing music to see your queue here
                      </p>
                    </div>
                  ) : (
                    queue.map((track, index) => (
                      <div
                        key={`${track.Id}-${index}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, index)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, index)}
                        onClick={() => handleTrackClick(index)}
                        className={`group flex items-center gap-3 p-3 rounded-lg transition-colors cursor-pointer select-none ${
                          index === currentIndex
                            ? "bg-primary/10 border border-primary/20"
                            : "hover:bg-accent"
                        } ${draggedIndex === index ? "opacity-50" : ""}`}
                      >
                        <div className="cursor-grab active:cursor-grabbing flex-shrink-0">
                          <GripVertical className="w-4 h-4 text-muted-foreground" />
                        </div>
                        <div className="w-10 h-10 rounded overflow-hidden bg-muted flex-shrink-0">
                          {track.ImageTags?.Primary && serverAddress ? (
                            <img
                              src={`${serverAddress}/Items/${track.Id}/Images/Primary?maxWidth=40&quality=90`}
                              alt={track.Name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Music className="w-4 h-4 text-muted-foreground" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p
                            className={`text-sm font-medium truncate ${
                              index === currentIndex
                                ? "text-primary"
                                : "text-card-foreground"
                            }`}
                          >
                            {track.Name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate">
                            {track.AlbumArtist ||
                              track.Artist ||
                              "Unknown Artist"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {index === currentIndex && (
                            <div
                              className={`equalizer ${
                                !isPlaying || isPaused ? "paused" : ""
                              }`}
                            >
                              <span className="equalizer-bar" />
                              <span className="equalizer-bar" />
                              <span className="equalizer-bar" />
                            </div>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeFromQueue(index);
                            }}
                            className="p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-3 h-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Add to Playlist Dialog */}
      {currentTrack && (
        <AddToPlaylistDialog
          open={showAddToPlaylist}
          onOpenChange={setShowAddToPlaylist}
          trackId={currentTrack.Id || ""}
          trackName={currentTrack.Name}
        />
      )}

      {/* Lyrics Component */}
      <LyricsComponent
        isOpen={showLyrics}
        onClose={() => toggleLyrics(false)}
      />
    </div>
  );
};

export default MusicPlayer;
