import React, { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AddToPlaylistDialog from "@/components/AddToPlaylistDialog";
import MusicPlayer from "@/components/MusicPlayer";
import Sidebar from "@/components/Sidebar";
import TrackList from "@/components/TrackList";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { Track as MusicTrack } from "@/contexts/MusicContext";
import BackButton from "@/components/BackButton";
import { formatDuration } from "@/utils/media";
import {
  Play,
  Pause,
  Star,
  MoreVertical,
  ArrowLeft,
  Music,
  Shuffle,
  Plus,
  Loader2,
  ListPlus,
  ListMusic,
  X,
} from "lucide-react";
import {
  getPlaylistItems,
  getPlaylistInfo,
  findArtistByName,
  getCurrentUser,
  getServerInfo,
  addToFavorites,
  removeFromFavorites,
  checkIsFavorite,
  deletePlaylist,
} from "@/lib/jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { useAuthData } from "@/hooks/useAuthData";
import IconDropdown from "@/components/IconDropdown";

interface Track extends BaseItemDto {
  AlbumArtist?: string;
  Album?: string;
  RunTimeTicks?: number;
  IndexNumber?: number;
  Artists?: string[];
  ProductionYear?: number;
  ParentIndexNumber?: number;
}

interface PlaylistInfo extends BaseItemDto {
  ChildCount?: number;
  CumulativeRunTimeTicks?: number;
}

const PlaylistView = () => {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { authData, isAuthenticated } = useAuthData();
  const { currentTrack, isPlaying, playNow, addToQueue, playQueue, queue } =
    useMusicPlayer();
  const [searchParams] = useSearchParams();

  const [playlistInfo, setPlaylistInfo] = useState<PlaylistInfo | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFavorite, setIsFavorite] = useState(false);
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);
  const [trackFavorites, setTrackFavorites] = useState<Record<string, boolean>>(
    {}
  );
  const [favoriteLoading, setFavoriteLoading] = useState<
    Record<string, boolean>
  >({});
  const [showLyrics, setShowLyrics] = useState(false);

  const handleLyricsToggle = (show: boolean) => {
    setShowLyrics(show);
  };

  useEffect(() => {
    if (playlistId) {
      loadPlaylistData();
    }
  }, [playlistId]);

  useEffect(() => {
    if (currentTrack) {
      setPlayingTrackId(isPlaying ? currentTrack.Id || null : null);
    } else {
      setPlayingTrackId(null);
    }
  }, [currentTrack, isPlaying]);

  const loadPlaylistData = async () => {
    setLoading(true);
    try {
      if (!isAuthenticated()) {
        navigate("/login");
        return;
      }

      const [info, items] = await Promise.all([
        getPlaylistInfo(playlistId!),
        getPlaylistItems(playlistId!),
      ]);

      setPlaylistInfo(info);
      setTracks(items as Track[]);

      // Check if playlist is favorited
      try {
        const favoriteStatus = await checkIsFavorite(
          authData.serverAddress,
          authData.accessToken,
          playlistId!
        );
        setIsFavorite(favoriteStatus);
      } catch (error) {
        console.error("Error checking favorite status:", error);
      }

      // Check favorite status for all tracks
      if (items && items.length > 0) {
        const trackFavoritePromises = items.map(async (track) => {
          if (track.Id) {
            try {
              const isFavorite = await checkIsFavorite(
                authData.serverAddress,
                authData.accessToken,
                track.Id
              );
              return { id: track.Id, isFavorite };
            } catch (error) {
              console.error(
                `Failed to check favorite status for track ${track.Id}:`,
                error
              );
              return { id: track.Id, isFavorite: false };
            }
          }
          return null;
        });

        const trackFavoriteResults = await Promise.all(trackFavoritePromises);
        const trackFavoriteMap: Record<string, boolean> = {};

        trackFavoriteResults.forEach((result) => {
          if (result) {
            trackFavoriteMap[result.id] = result.isFavorite;
          }
        });

        setTrackFavorites(trackFavoriteMap);
      }
    } catch (error) {
      console.error("Failed to load playlist data", error);
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

  const handleAddToQueue = (track: Track) => {
    const trackToAdd = convertToMusicTrack(track);
    addToQueue(trackToAdd);
  };

  const handleAddAllToQueue = () => {
    tracks.forEach((track) => {
      const trackToAdd = convertToMusicTrack(track);
      addToQueue(trackToAdd);
    });
  };

  const handleToggleFavorite = async () => {
    try {
      if (isFavorite) {
        await removeFromFavorites(
          authData.serverAddress,
          authData.accessToken,
          playlistId!
        );
        setIsFavorite(false);
      } else {
        await addToFavorites(
          authData.serverAddress,
          authData.accessToken,
          playlistId!
        );
        setIsFavorite(true);
      }
    } catch (error) {
      console.error("Error toggling favorite:", error);
    }
  };

  const toggleTrackFavorite = async (trackId: string) => {
    if (!trackId || !authData.accessToken || !authData.serverAddress) return;

    setFavoriteLoading((prev) => ({ ...prev, [trackId]: true }));

    try {
      const isFavorite = trackFavorites[trackId];
      if (isFavorite) {
        await removeFromFavorites(
          authData.serverAddress,
          authData.accessToken,
          trackId
        );
        setTrackFavorites((prev) => ({ ...prev, [trackId]: false }));
      } else {
        await addToFavorites(
          authData.serverAddress,
          authData.accessToken,
          trackId
        );
        setTrackFavorites((prev) => ({ ...prev, [trackId]: true }));
      }
    } catch (error) {
      console.error("Failed to toggle track favorite:", error);
    } finally {
      setFavoriteLoading((prev) => ({ ...prev, [trackId]: false }));
    }
  };

  const handleArtistClick = async (artistName: string) => {
    try {
      const artist = await findArtistByName(artistName);
      if (artist?.Id) {
        navigate(
          `/artist/${artist.Id}${
            searchParams.get("q")
              ? `?q=${encodeURIComponent(searchParams.get("q") || "")}`
              : ""
          }`
        );
      } else {
        // Fallback: navigate with encoded name
        navigate(
          `/artist/${encodeURIComponent(artistName)}${
            searchParams.get("q")
              ? `?q=${encodeURIComponent(searchParams.get("q") || "")}`
              : ""
          }`
        );
      }
    } catch (error) {
      console.error("Error finding artist:", error);
      navigate(
        `/artist/${encodeURIComponent(artistName)}${
          searchParams.get("q")
            ? `?q=${encodeURIComponent(searchParams.get("q") || "")}`
            : ""
        }`
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar activeSection="playlists" />
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

  if (!playlistInfo) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar activeSection="playlists" />
        <div className="ml-64 p-6 pb-28">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <ListMusic className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Playlist not found
              </h2>
              <p className="text-gray-600">
                The playlist you're looking for doesn't exist or has been
                removed.
              </p>
              <Button onClick={() => navigate(-1)} className="mt-4">
                Go Back
              </Button>
            </div>
          </div>
        </div>
        <MusicPlayer
          showLyrics={showLyrics}
          onLyricsToggle={handleLyricsToggle}
        />
      </div>
    );
  }

  const imageUrl =
    playlistInfo.Id && playlistInfo.ImageTags?.Primary
      ? `${authData.serverAddress}/Items/${playlistInfo.Id}/Images/Primary?maxWidth=300&quality=90`
      : null;

  const showPlaceholder = !imageUrl || imageError;

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar activeSection="playlists" />
      <div className="ml-64 p-6 pb-28">
        {/* Back Button */}
        <BackButton />

        {/* Playlist Header */}
        <div className="flex gap-8 mb-8">
          <div className="flex-shrink-0">
            <div className="w-64 h-64 rounded-lg shadow-lg overflow-hidden">
              {showPlaceholder ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-200 to-rose-200">
                  <ListMusic className="w-16 h-16 text-pink-600" />
                </div>
              ) : (
                <img
                  src={imageUrl}
                  alt={playlistInfo.Name || "Playlist"}
                  className="w-full h-full object-cover"
                  onError={() => setImageError(true)}
                />
              )}
            </div>
          </div>

          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-4 leading-tight">
                {playlistInfo.Name}
              </h1>
            </div>

            <div className="flex items-center gap-4 text-sm text-gray-600">
              {playlistInfo.ChildCount && (
                <span>{playlistInfo.ChildCount} tracks</span>
              )}
              {playlistInfo.CumulativeRunTimeTicks && (
                <>
                  <span>•</span>
                  <span>
                    {formatDuration(playlistInfo.CumulativeRunTimeTicks)}
                  </span>
                </>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-3">
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
              <IconDropdown
                align="start"
                tooltip="More actions"
                menuWidthClass="w-52"
              >
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    if (tracks.length === 0) return;
                    handleAddAllToQueue();
                  }}
                  disabled={tracks.length === 0}
                  className="cursor-pointer"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add all to queue
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!playlistInfo?.Id) return;
                    if (
                      !confirm("Delete this playlist? This cannot be undone.")
                    )
                      return;
                    try {
                      await deletePlaylist(playlistInfo.Id);
                      // Remove from local cache so Playlists page updates instantly
                      try {
                        const { localDb } = await import("@/lib/database");
                        await localDb.initialize();
                        await localDb.deletePlaylist(playlistInfo.Id);
                        // Notify any listeners to refresh
                        window.dispatchEvent(new CustomEvent("syncUpdate"));
                      } catch (cacheErr) {
                        console.warn(
                          "Failed updating local cache after delete",
                          cacheErr
                        );
                      }
                      // Navigate back to playlists
                      navigate(-1);
                    } catch (err) {
                      console.error("Failed to delete playlist", err);
                      alert("Failed to delete playlist");
                    }
                  }}
                  className="cursor-pointer text-red-600 focus:text-red-700"
                >
                  <X className="w-4 h-4 mr-2" />
                  Delete playlist
                </DropdownMenuItem>
              </IconDropdown>
            </div>
          </div>
        </div>

        {/* Track List - Hidden when lyrics are open */}
        {!showLyrics && (
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
      </div>

      <MusicPlayer
        showLyrics={showLyrics}
        onLyricsToggle={handleLyricsToggle}
      />
    </div>
  );
};

export default PlaylistView;
