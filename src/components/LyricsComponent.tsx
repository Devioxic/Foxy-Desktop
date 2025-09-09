import React, { useState, useEffect, useRef } from "react";
import { logger } from "@/lib/logger";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { getTrackLyrics, LyricLine, Lyrics } from "@/lib/jellyfin";
import { useAuthData } from "@/hooks/useAuthData";
import { FileText, X, Music, Clock } from "lucide-react";

interface LyricsProps {
  isOpen: boolean;
  onClose: () => void;
}

const LyricsComponent: React.FC<LyricsProps> = ({ isOpen, onClose }) => {
  const { currentTrack, currentTime, seek } = useMusicPlayer();
  const { authData } = useAuthData();
  const [lyrics, setLyrics] = useState<Lyrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeLyricIndex, setActiveLyricIndex] = useState(-1);
  const lyricRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Load lyrics when track changes
  useEffect(() => {
    if (currentTrack?.Id && authData.serverAddress && authData.accessToken) {
      loadLyrics(currentTrack.Id);
    } else {
      setLyrics(null);
      setError(null);
    }
  }, [currentTrack?.Id, authData.serverAddress, authData.accessToken]);

  // Update active lyric based on current time
  useEffect(() => {
    if (!lyrics || !lyrics.isTimeSynced || lyrics.lyrics.length === 0) {
      setActiveLyricIndex(-1);
      return;
    }

    // Find the current lyric line based on playback time
    let newActiveLyricIndex = -1;
    for (let i = lyrics.lyrics.length - 1; i >= 0; i--) {
      if (currentTime >= lyrics.lyrics[i].start) {
        newActiveLyricIndex = i;
        break;
      }
    }

    if (newActiveLyricIndex !== activeLyricIndex) {
      setActiveLyricIndex(newActiveLyricIndex);

      // Auto-scroll to active lyric
      if (newActiveLyricIndex >= 0 && lyricRefs.current[newActiveLyricIndex]) {
        lyricRefs.current[newActiveLyricIndex]?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
    }
  }, [currentTime, lyrics, activeLyricIndex]);

  const loadLyrics = async (trackId: string) => {
    setLoading(true);
    setError(null);
    setLyrics(null);
    setActiveLyricIndex(-1);

    try {
      const trackLyrics = await getTrackLyrics(
        authData.serverAddress,
        authData.accessToken,
        trackId
      );

      if (trackLyrics) {
        setLyrics(trackLyrics);
      } else {
        setError("No lyrics found for this track");
      }
    } catch (error) {
      logger.error("Error loading lyrics:", error);
      setError("Failed to load lyrics");
    } finally {
      setLoading(false);
    }
  };

  const handleLyricClick = (lyricLine: LyricLine) => {
    if (lyrics?.isTimeSynced && lyricLine.start > 0) {
      // Seek to the clicked lyric time
      seek(lyricLine.start);
    }
  };

  const formatTime = (seconds: number): string => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
  };

  // No album art backdrop for lyrics view (kept minimal per design)

  return (
    <div
      className={`fixed z-40 transition-all duration-300 ${
        isOpen
          ? "opacity-100 pointer-events-auto"
          : "opacity-0 pointer-events-none"
      }`}
      style={{
        left: "17.5rem", // ml-64 + margin (16rem + 1.5rem)
        right: "1rem", // slightly tighter margin
        top: "1rem", // slightly tighter top margin
        bottom: "6rem", // closer to player to increase height
      }}
    >
      <div className="relative w-full h-full overflow-hidden rounded-2xl border border-gray-200 shadow-sm bg-white flex flex-col">
        {/* Header */}
        <div className="relative flex items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-gray-500" />
            <h2 className="text-base font-semibold text-gray-900 tracking-tight">
              Lyrics
            </h2>
          </div>
          <div className="flex items-center gap-3">
            {lyrics?.isTimeSynced && (
              <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-pink-100 text-pink-600">
                <Clock className="w-3 h-3 text-pink-600" /> Synced
              </span>
            )}
            <Button
              variant="ghost"
              onClick={onClose}
              className="text-gray-600 hover:text-gray-900 hover:bg-gray-100"
              size="sm"
            >
              <X className="w-4 h-4" />
              <span className="sr-only">Close lyrics</span>
            </Button>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 sm:px-12 pb-16 pt-2">
          {loading && (
            <div className="space-y-3 max-w-3xl mx-auto mt-10">
              {Array.from({ length: 10 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-full" />
              ))}
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-24 max-w-2xl mx-auto">
              <Music className="w-16 h-16 text-gray-300 mx-auto mb-6" />
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                {error}
              </h3>
              <p className="text-gray-600 text-lg">
                This track doesn't have lyrics available
              </p>
            </div>
          )}

          {lyrics && !loading && (
            <div className="relative max-w-3xl mx-auto mt-8">
              <div className="space-y-6">
                {lyrics.lyrics.map((line, index) => {
                  const isActive =
                    lyrics.isTimeSynced && index === activeLyricIndex;
                  return (
                    <div
                      key={index}
                      ref={(el) => (lyricRefs.current[index] = el)}
                      onClick={() => handleLyricClick(line)}
                      className={`group transition-colors duration-200 cursor-pointer select-none text-center leading-snug tracking-wide ${
                        isActive
                          ? "text-primary font-semibold text-2xl sm:text-3xl"
                          : lyrics.isTimeSynced
                            ? "text-muted-foreground hover:text-foreground text-lg sm:text-xl"
                            : "text-foreground text-lg sm:text-xl"
                      }`}
                      style={{
                        transitionProperty: "color",
                      }}
                    >
                      {line.text || (
                        <span className="italic text-muted-foreground">
                          ♪ Instrumental ♪
                        </span>
                      )}
                    </div>
                  );
                })}
                {lyrics.lyrics.length === 0 && (
                  <div className="text-center py-24">
                    <Music className="w-16 h-16 text-muted-foreground mx-auto mb-6" />
                    <p className="text-muted-foreground text-xl">
                      No lyrics to display
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {!currentTrack && !loading && (
            <div className="text-center py-24 max-w-2xl mx-auto">
              <Music className="w-16 h-16 text-gray-300 mx-auto mb-6" />
              <h3 className="text-2xl font-semibold text-gray-900 mb-2">
                No track playing
              </h3>
              <p className="text-gray-600 text-lg">
                Start playing a song to see its lyrics
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LyricsComponent;
