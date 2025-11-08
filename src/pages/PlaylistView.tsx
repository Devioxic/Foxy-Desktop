import React, { useState, useEffect, useCallback, useRef } from "react";
import { APP_EVENTS, FavoriteStateChangedDetail } from "@/constants/events";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import { logger } from "@/lib/logger";
import MusicPlayer from "@/components/MusicPlayer";
import Sidebar from "@/components/Sidebar";
import TrackList from "@/components/TrackList";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { Track as MusicTrack } from "@/contexts/MusicContext";
import BackButton from "@/components/BackButton";
import { formatDuration, resolvePrimaryImageUrl } from "@/utils/media";
import {
  Play,
  Star,
  Music,
  Shuffle,
  Plus,
  Loader2,
  ListPlus,
  ListMusic,
  Download,
  MoreVertical,
  SkipForward,
  Trash2,
  ListMusic as QueueIcon,
} from "lucide-react";
import {
  isCollectionDownloaded,
  downloadPlaylistById,
  removePlaylistDownloads,
} from "@/lib/downloads";
import {
  showLoading,
  dismissToast,
  showSuccess,
  showError,
} from "@/utils/toast";
import {
  findArtistByName,
  getCurrentUser,
  getServerInfo,
  addToFavorites,
  removeFromFavorites,
  checkIsFavorite,
  deletePlaylist,
  getItemsUserDataMap,
} from "@/lib/jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { useAuthData } from "@/hooks/useAuthData";
import { Dropdown } from "@/components/Dropdown";
import { hybridData } from "@/lib/sync";
import { useOfflineModeContext } from "@/contexts/OfflineModeContext";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

interface Track extends BaseItemDto {
  AlbumArtist?: string;
  Album?: string;
  RunTimeTicks?: number;
  IndexNumber?: number;
  Artists?: string[];
  ProductionYear?: number;
  ParentIndexNumber?: number;
  LocalImages?: { Primary?: string };
}

interface PlaylistInfo extends BaseItemDto {
  ChildCount?: number;
  CumulativeRunTimeTicks?: number;
}

const PlaylistView = () => {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();
  const { authData } = useAuthData();
  const { currentTrack, isPlaying, addToQueue, playQueue, addToQueueNext } =
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
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const spinnerPlaylistRef = useRef<string | null>(null);
  const downloadsRefreshTimeout = useRef<number | null>(null);

  const handleLyricsToggle = (show: boolean) => {
    setShowLyrics(show);
  };

  const { isOffline } = useOfflineModeContext();

  const loadPlaylistData = useCallback(
    async (options: { showSpinner?: boolean } = {}) => {
      const { showSpinner = false } = options;
      if (showSpinner) {
        setLoading(true);
      }
      try {
        const hasAuth = Boolean(authData.accessToken && authData.serverAddress);
        if (!playlistId) {
          return;
        }

        if (!hasAuth && !isOffline) {
          navigate("/login");
          return;
        }

        const [info, items] = await Promise.all([
          hybridData.getPlaylistById(playlistId),
          hybridData.getPlaylistTracks(playlistId),
        ]);

        const playlistItems: Track[] = Array.isArray(items)
          ? (items as Track[])
          : [];

        const runtimeTicks = playlistItems.reduce(
          (acc: number, track: Track) => acc + (track.RunTimeTicks || 0),
          0
        );

        const normalizedInfo: PlaylistInfo | null = info
          ? {
              ...(info as PlaylistInfo),
              ChildCount: playlistItems.length,
              CumulativeRunTimeTicks:
                runtimeTicks > 0
                  ? runtimeTicks
                  : info.CumulativeRunTimeTicks || 0,
            }
          : null;

        setTracks(playlistItems);
        setPlaylistInfo(normalizedInfo);

        const initialTrackFavoriteMap: Record<string, boolean> = {};
        const missingFavoriteIds: string[] = [];

        for (const track of playlistItems) {
          if (!track?.Id) continue;
          const userFavorite = (track as any)?.UserData?.IsFavorite;
          if (typeof userFavorite === "boolean") {
            initialTrackFavoriteMap[track.Id] = userFavorite;
          } else {
            missingFavoriteIds.push(track.Id);
          }
        }

        if (!isOffline && hasAuth) {
          let playlistFavoriteSet = false;
          if (typeof (info as any)?.UserData?.IsFavorite === "boolean") {
            setIsFavorite(Boolean((info as any).UserData.IsFavorite));
            playlistFavoriteSet = true;
          }

          if (!playlistFavoriteSet) {
            try {
              const favoriteStatus = await checkIsFavorite(
                authData.serverAddress,
                authData.accessToken,
                playlistId
              );
              setIsFavorite(favoriteStatus);
            } catch (error) {
              logger.error("Error checking favorite status:", error);
            }
          }

          if (missingFavoriteIds.length > 0) {
            try {
              const favoriteMap = await getItemsUserDataMap(missingFavoriteIds);
              for (const id of missingFavoriteIds) {
                initialTrackFavoriteMap[id] = favoriteMap[id] ?? false;
              }
            } catch (error) {
              logger.warn("Failed to resolve favorite states in bulk", error);
            }
          }
        } else {
          setIsFavorite(false);
        }

        setTrackFavorites(initialTrackFavoriteMap);
      } catch (error) {
        logger.error("Failed to load playlist data", error);
        if (isOffline) {
          setPlaylistInfo(null);
          setTracks([]);
        }
      } finally {
        setLoading(false);
      }
    },
    [
      playlistId,
      isOffline,
      navigate,
      authData.accessToken,
      authData.serverAddress,
    ]
  );

  useEffect(() => {
    if (!playlistId) return;

    const shouldShowSpinner = spinnerPlaylistRef.current !== playlistId;
    loadPlaylistData({ showSpinner: shouldShowSpinner });
    if (shouldShowSpinner) {
      spinnerPlaylistRef.current = playlistId;
    }

    const handleDownloadsUpdate = () => {
      if (downloadsRefreshTimeout.current) {
        window.clearTimeout(downloadsRefreshTimeout.current);
      }
      downloadsRefreshTimeout.current = window.setTimeout(() => {
        downloadsRefreshTimeout.current = null;
        loadPlaylistData();
      }, 300);
    };

    window.addEventListener("downloadsUpdate", handleDownloadsUpdate);
    return () => {
      window.removeEventListener("downloadsUpdate", handleDownloadsUpdate);
      if (downloadsRefreshTimeout.current) {
        window.clearTimeout(downloadsRefreshTimeout.current);
        downloadsRefreshTimeout.current = null;
      }
    };
  }, [playlistId, loadPlaylistData]);

  const handleToggleDownload = async () => {
    if (!playlistId) return;
    if (downloading) return;
    setDownloading(true);
    const id = showLoading(
      isDownloaded ? "Removing downloads..." : "Downloading playlist..."
    );
    try {
      if (isDownloaded) {
        await removePlaylistDownloads(playlistId);
        setIsDownloaded(false);
        showSuccess("Removed playlist downloads");
      } else {
        const res = await downloadPlaylistById(playlistId, playlistInfo?.Name);
        setIsDownloaded(true);
        showSuccess(
          `Downloaded ${res.downloaded} tracks${res.failed ? `, ${res.failed} failed` : ""}`
        );
      }
    } catch (e: any) {
      showError(e?.message || "Download failed");
    } finally {
      dismissToast(id as any);
      setDownloading(false);
    }
  };

  const convertToMusicTrack = (track: Track): MusicTrack => ({
    Id: track.Id!,
    Name: track.Name || "Unknown Track",
    Artist: track.Artists?.[0] || track.AlbumArtist,
    AlbumArtist: track.AlbumArtist,
    Album: track.Album,
    ImageTags: track.ImageTags,
    LocalImages: (track as any)?.LocalImages,
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

  const handlePlayNextAll = () => {
    // Insert all playlist tracks after current track preserving order
    // If nothing playing, behave like Play All
    if (!tracks.length) return;
    if (!currentTrack) {
      handlePlayAll();
      return;
    }
    tracks.forEach((t) => {
      addToQueueNext(convertToMusicTrack(t));
    });
  };

  const handleConfirmDelete = async () => {
    if (!playlistInfo?.Id) return;
    try {
      await deletePlaylist(playlistInfo.Id);
      try {
        const { localDb } = await import("@/lib/database");
        await localDb.initialize();
        await localDb.deletePlaylist(playlistInfo.Id);
        window.dispatchEvent(new CustomEvent("syncUpdate"));
      } catch (cacheErr) {
        logger.warn("Failed updating local cache after delete", cacheErr);
      }
      showSuccess("Playlist deleted");
      navigate(-1);
    } catch (err: any) {
      logger.error("Failed to delete playlist", err);
      showError(err?.message || "Failed to delete playlist");
    } finally {
      setDeleteOpen(false);
    }
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
      logger.error("Error toggling favorite:", error);
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
      logger.error("Failed to toggle track favorite:", error);
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
      logger.error("Error finding artist:", error);
      navigate(
        `/artist/${encodeURIComponent(artistName)}${
          searchParams.get("q")
            ? `?q=${encodeURIComponent(searchParams.get("q") || "")}`
            : ""
        }`
      );
    }
  };

  useEffect(() => {
    if (!playlistId) return undefined;
    const handleRefresh = (e: Event) => {
      try {
        const { playlistId: pid } = (e as CustomEvent).detail || {};
        if (pid === playlistId) {
          loadPlaylistData();
        }
      } catch {}
    };

    window.addEventListener("playlistItemRemoved", handleRefresh as any);
    window.addEventListener("playlistItemsUpdated", handleRefresh as any);

    return () => {
      window.removeEventListener("playlistItemRemoved", handleRefresh as any);
      window.removeEventListener("playlistItemsUpdated", handleRefresh as any);
    };
  }, [playlistId, loadPlaylistData]);

  const imageUrl = playlistInfo
    ? resolvePrimaryImageUrl({
        item: playlistInfo as any,
        serverAddress: authData.serverAddress,
        accessToken: authData.accessToken || undefined,
        size: 300,
      })
    : null;

  useEffect(() => {
    setImageError(false);
  }, [imageUrl]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
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
    const description = isOffline
      ? "This playlist hasn't been downloaded yet. Head to Downloads to sync it for offline listening."
      : "The playlist you're looking for doesn't exist or has been removed.";
    return (
      <div className="min-h-screen bg-background">
        <Sidebar activeSection="playlists" />
        <div className="ml-64 p-6 pb-28">
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <ListMusic className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-foreground mb-2">
                Playlist not found
              </h2>
              <p className="text-muted-foreground">{description}</p>
              <div className="flex justify-center gap-3 mt-4">
                <Button onClick={() => navigate(-1)}>Go Back</Button>
                {isOffline && (
                  <Button
                    variant="outline"
                    onClick={() => navigate("/downloads")}
                  >
                    View Downloads
                  </Button>
                )}
              </div>
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

  const showPlaceholder = !imageUrl || imageError;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar activeSection="playlists" />
      <div className="ml-64 p-6 pb-28">
        {/* Back Button */}
        <BackButton />

        {/* Playlist Header */}
        <div className="flex gap-8 mb-8">
          <div className="flex-shrink-0">
            <div className="w-64 h-64 rounded-lg shadow-lg overflow-hidden">
              {showPlaceholder ? (
                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/30">
                  <ListMusic className="w-16 h-16 text-primary" />
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
              <h1 className="text-4xl font-bold text-foreground mb-4 leading-tight">
                {playlistInfo.Name}
              </h1>
            </div>

            <div className="flex items-center gap-4 text-sm text-muted-foreground">
              <span>{tracks.length} tracks</span>
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
                className="bg-primary hover:bg-primary/90 px-8"
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
                className="p-1 text-muted-foreground hover:text-primary hover:bg-accent"
                title={isDownloaded ? "Remove download" : "Download"}
              >
                {downloading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                ) : (
                  <Download
                    className={`w-4 h-4 ${
                      isDownloaded ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                )}
              </Button>
              {/* Playlist actions dropdown */}
              <Dropdown
                open={dropdownOpen}
                onOpenChange={setDropdownOpen}
                trigger={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 text-muted-foreground hover:text-primary hover:bg-accent"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Playlist options"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                }
                actions={[
                  {
                    id: "download",
                    label: isDownloaded ? "Remove download" : "Download",
                    icon: downloading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download
                        className={`w-4 h-4 ${isDownloaded ? "text-primary" : ""}`}
                      />
                    ),
                    onSelect: () => handleToggleDownload(),
                    disabled: downloading,
                  },
                  {
                    id: "add-all",
                    label: "Add all to queue",
                    icon: <QueueIcon className="w-4 h-4" />,
                    onSelect: handleAddAllToQueue,
                    disabled: tracks.length === 0,
                  },
                  {
                    id: "play-next",
                    label: "Play next",
                    icon: <SkipForward className="w-4 h-4" />,
                    onSelect: handlePlayNextAll,
                    disabled: tracks.length === 0,
                  },
                  playlistInfo?.Id
                    ? ({ separator: true, id: "sep" } as any)
                    : ({} as any),
                  playlistInfo?.Id
                    ? {
                        id: "delete",
                        label: "Delete",
                        destructive: true,
                        icon: <Trash2 className="w-4 h-4" />,
                        onSelect: () => setDeleteOpen(true),
                      }
                    : ({} as any),
                ].filter((a) => (a as any).label || (a as any).separator)}
              />
              <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Delete playlist?</DialogTitle>
                    <DialogDescription>
                      This action cannot be undone. This will permanently delete
                      the playlist.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteOpen(false);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleConfirmDelete();
                      }}
                    >
                      Delete
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>

        {/* Track List - Hidden when lyrics are open */}
        {!showLyrics && (
          <div className="bg-card rounded-xl shadow-sm border border-border">
            <div className="p-4">
              <h3 className="text-base font-semibold text-card-foreground mb-3">
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
                playlistId={playlistId!}
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
