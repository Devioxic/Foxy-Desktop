import React, { useState, useEffect } from "react";
import { logger } from "@/lib/logger";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import MusicPlayer from "@/components/MusicPlayer";
import Sidebar from "@/components/Sidebar";
import TrackList from "@/components/TrackList";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { Track as MusicTrack } from "@/contexts/MusicContext";
import { formatDuration } from "@/utils/media";
import {
  Play,
  Star,
  ArrowLeft,
  Music,
  Shuffle,
  Plus,
  Heart,
  ListMusic,
  Loader2,
  Download,
} from "lucide-react";
import {
  getFavorites,
  findArtistByName,
  removeFromFavorites,
  checkIsFavorite,
} from "@/lib/jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { useAuthData } from "@/hooks/useAuthData";
import BackButton from "@/components/BackButton";

interface Track extends BaseItemDto {
  AlbumArtist?: string;
  Album?: string;
  RunTimeTicks?: number;
  IndexNumber?: number;
  Artists?: string[];
  ProductionYear?: number;
  ParentIndexNumber?: number;
}

const FavouritePlaylistView = () => {
  const navigate = useNavigate();
  const { authData, isAuthenticated } = useAuthData();
  const { currentTrack, isPlaying, playNow, addToQueue, playQueue } =
    useMusicPlayer();

  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [trackFavorites, setTrackFavorites] = useState<Record<string, boolean>>(
    {}
  );
  const [favoriteLoading, setFavoriteLoading] = useState<
    Record<string, boolean>
  >({});
  const [showLyrics, setShowLyrics] = useState(false);
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleLyricsToggle = (show: boolean) => {
    setShowLyrics(show);
  };

  useEffect(() => {
    loadFavoriteTracks();
    // Probe favourite collection download state
    (async () => {
      try {
        const { isCollectionDownloaded } = await import("@/lib/downloads");
        const state = await isCollectionDownloaded("favourites");
        setIsDownloaded(state);
      } catch {}
    })();
  }, []);

  const loadFavoriteTracks = async () => {
    setLoading(true);
    try {
      if (!isAuthenticated()) {
        navigate("/login");
        return;
      }

      const favorites = await getFavorites(
        authData.serverAddress,
        authData.accessToken
      );
      setTracks((favorites.Items as Track[]) || []);

      // All tracks are favorites by definition
      const trackFavoriteMap: Record<string, boolean> = {};
      favorites.Items?.forEach((track) => {
        if (track.Id) {
          trackFavoriteMap[track.Id] = true;
        }
      });
      setTrackFavorites(trackFavoriteMap);
    } catch (error) {
      logger.error("Failed to load favorite tracks", error);
    } finally {
      setLoading(false);
    }
  };

  const convertToMusicTrack = (track: Track): MusicTrack => ({
    Id: track.Id!,
    Name: track.Name || "Unknown Track",
    Artist: track.Artists?.[0] || track.AlbumArtist,
    AlbumArtist: track.AlbumArtist,
    Album: track.Album,
    ImageTags: track.ImageTags,
    RunTimeTicks: track.RunTimeTicks,
    MediaSources:
      track.MediaSources?.map((source) => ({
        Path: source.Path || "",
        Container: source.Container || "",
        DirectStreamUrl: (source as any).DirectStreamUrl,
      })) || [],
  });

  const handlePlayTrack = (track: Track, index: number) => {
    // Create a queue starting from the selected track
    const queueFromTrack = tracks.slice(index).map(convertToMusicTrack);
    playQueue(queueFromTrack, 0);
  };

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      const tracksToPlay = tracks.map(convertToMusicTrack);
      playQueue(tracksToPlay, 0);
    }
  };

  const handleShuffle = () => {
    if (tracks.length > 0) {
      const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
      const tracksToPlay = shuffledTracks.map(convertToMusicTrack);
      playQueue(tracksToPlay, 0);
    }
  };

  const handleToggleDownload = async () => {
    try {
      setDownloading(true);
      const { downloadFavourites, removeFavouritesDownloads } = await import(
        "@/lib/downloads"
      );
      if (isDownloaded) {
        await removeFavouritesDownloads();
        setIsDownloaded(false);
      } else {
        await downloadFavourites("Favourites");
        setIsDownloaded(true);
      }
    } catch (e) {
      logger.error("Failed to toggle favourites download", e);
    } finally {
      setDownloading(false);
    }
  };

  const handleAddAllToQueue = () => {
    tracks.forEach((track) => {
      const trackToAdd = convertToMusicTrack(track);
      addToQueue(trackToAdd);
    });
  };

  const toggleTrackFavorite = async (trackId: string) => {
    if (!trackId || !authData.accessToken || !authData.serverAddress) return;

    setFavoriteLoading((prev) => ({ ...prev, [trackId]: true }));

    try {
      // Since this is a favorites playlist, removing from favorites removes from this view
      await removeFromFavorites(
        authData.serverAddress,
        authData.accessToken,
        trackId
      );
      // Reload the favorites list
      loadFavoriteTracks();
    } catch (error) {
      logger.error("Failed to remove track from favorites:", error);
    } finally {
      setFavoriteLoading((prev) => ({ ...prev, [trackId]: false }));
    }
  };

  const handleArtistClick = async (artistName: string) => {
    try {
      const artist = await findArtistByName(artistName);
      if (artist?.Id) {
        navigate(`/artist/${artist.Id}`);
      } else {
        navigate(`/artist/${encodeURIComponent(artistName)}`);
      }
    } catch (error) {
      logger.error("Error finding artist:", error);
      navigate(`/artist/${encodeURIComponent(artistName)}`);
    }
  };

  const formatTotalDuration = (ticks?: number) => {
    if (!ticks) return "0 min";
    const totalSeconds = Math.floor(ticks / 10000000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes} min`;
  };

  const totalDuration = tracks.reduce(
    (acc, track) => acc + (track.RunTimeTicks || 0),
    0
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar activeSection="favourites" />
        <div className="ml-64 p-6">
          <LoadingSkeleton type="playlist" />
        </div>
        <MusicPlayer
          showLyrics={showLyrics}
          onLyricsToggle={handleLyricsToggle}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar activeSection="favourites" />
      <div className="ml-64 p-6 pb-28">
        {/* Back Button */}
        <BackButton />

        {/* Playlist Header */}
        <div className="flex gap-8 mb-8">
          <div className="flex-shrink-0">
            <div className="w-64 h-64 rounded-lg shadow-lg overflow-hidden">
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-200 to-rose-200">
                <Heart className="w-16 h-16 text-pink-600 fill-pink-600" />
              </div>
            </div>
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-4 leading-tight">
                Favourites
              </h1>
              <p className="text-gray-600 text-sm">
                Your favourite tracks, all in one place
              </p>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>{tracks.length} tracks</span>
              {totalDuration > 0 && (
                <>
                  <span>•</span>
                  <span>{formatTotalDuration(totalDuration)}</span>
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-4">
              <Button
                onClick={handlePlayAll}
                disabled={tracks.length === 0}
                className="bg-pink-600 hover:bg-pink-700 px-8"
              >
                <Play className="w-4 h-4 mr-2" />
                Play
              </Button>
              <Button
                variant="outline"
                onClick={handleShuffle}
                disabled={tracks.length === 0}
              >
                <Shuffle className="w-4 h-4 mr-2" />
                Shuffle
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleDownload}
                disabled={downloading}
                className="p-1 text-gray-600 hover:text-pink-600 hover:bg-gray-100"
                title={isDownloaded ? "Remove download" : "Download"}
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                ) : (
                  <Download
                    className={`w-4 h-4 ${
                      isDownloaded ? "text-pink-600" : "text-gray-600"
                    }`}
                  />
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* Track List - Hidden when lyrics are open */}
        {!showLyrics && (
          <>
            {tracks.length === 0 ? (
              <div className="flex items-center justify-center h-64">
                <div className="text-center">
                  <Heart className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    No favourite tracks yet
                  </h2>
                  <p className="text-gray-600 mb-4">
                    Start adding tracks to your favourites by clicking the star
                    icon.
                  </p>
                  <Button onClick={() => navigate("/home")}>
                    Explore Music
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200">
                <div className="p-4">
                  <h3 className="text-base font-semibold text-gray-900 mb-3">
                    Tracks
                  </h3>

                  <TrackList
                    tracks={tracks}
                    currentTrack={currentTrack}
                    isPlaying={isPlaying}
                    onTrackPlay={(index) => {
                      const track = tracks[index];
                      handlePlayTrack(track, index);
                    }}
                    onArtistClick={handleArtistClick}
                    trackFavorites={trackFavorites}
                    favoriteLoading={favoriteLoading}
                    onToggleTrackFavorite={toggleTrackFavorite}
                    showArtistFromTrack={true}
                    formatDuration={formatDuration}
                    usePlaylistIndex
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <MusicPlayer
        showLyrics={showLyrics}
        onLyricsToggle={handleLyricsToggle}
      />
    </div>
  );
};

export default FavouritePlaylistView;
