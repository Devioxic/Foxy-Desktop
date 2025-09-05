import { Dropdown } from "@/components/Dropdown";
import {
  Play,
  Star,
  Music,
  Shuffle,
  Plus,
  Loader2,
  User2,
  Download,
  ListPlus,
  MoreVertical,
  ChevronsRight,
} from "lucide-react";
import React, { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
// Dropdown primitives removed
// AddToPlaylistDialog not used here; album-level add handled via Dialog below
import MusicPlayer from "@/components/MusicPlayer";
import Sidebar from "@/components/Sidebar";
import TrackList from "@/components/TrackList";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { formatDuration, getImageUrl } from "@/utils/media";
import { perf } from "@/utils/performance";
// lucide icons imported above
import {
  isCollectionDownloaded,
  downloadAlbumById,
  removeAlbumDownloads,
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
  getAllPlaylists,
  addItemsToPlaylist,
} from "@/lib/jellyfin";
import { hybridData } from "@/lib/sync";
// Removed IconDropdown usage
import BackButton from "@/components/BackButton";
import { logger } from "@/lib/logger";

interface AlbumTrack {
  Id?: string;
  Name?: string;
  IndexNumber?: number;
  RunTimeTicks?: number;
  Artists?: string[];
  Album?: string;
  AlbumArtist?: string;
  ImageTags?: { Primary?: string };
}

interface AlbumInfo {
  Id?: string;
  Name?: string;
  AlbumArtist?: string;
  Artists?: string[];
  ProductionYear?: number;
  DateCreated?: string;
  ImageTags?: { Primary?: string };
  Overview?: string;
  Genres?: string[];
  RunTimeTicks?: number;
  ChildCount?: number;
}

const AlbumView = () => {
  const { albumId } = useParams<{ albumId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const handleArtistClick = async (artistName: string) => {
    try {
      // Try to find the artist by name to get their ID
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
        // Fallback: navigate with the name (for now)
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
      // Fallback navigation
      navigate(
        `/artist/${encodeURIComponent(artistName)}${
          searchParams.get("q")
            ? `?q=${encodeURIComponent(searchParams.get("q") || "")}`
            : ""
        }`
      );
    }
  };
  const {
    playQueue,
    addToQueue,
    addToQueueNext,
    currentTrack,
    isPlaying,
    queue,
  } = useMusicPlayer();

  const [albumInfo, setAlbumInfo] = useState<AlbumInfo | null>(null);
  const [tracks, setTracks] = useState<AlbumTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState("home");
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [serverInfo, setServerInfo] = useState<any>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isAlbumFavorite, setIsAlbumFavorite] = useState(false);
  const [trackFavorites, setTrackFavorites] = useState<Record<string, boolean>>(
    {}
  );
  const [favoriteLoading, setFavoriteLoading] = useState<
    Record<string, boolean>
  >({});
  const [showLyrics, setShowLyrics] = useState(false);
  const [authData] = useState(() =>
    JSON.parse(localStorage.getItem("authData") || "{}")
  );
  const [isDownloaded, setIsDownloaded] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [addAlbumDialogOpen, setAddAlbumDialogOpen] = useState(false);
  const [allPlaylists, setAllPlaylists] = useState<any[]>([]);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  const handleLyricsToggle = (show: boolean) => {
    setShowLyrics(show);
  };

  // Derive a displayable album artist from available props (handles local DB cases)
  const albumArtistName = React.useMemo(() => {
    const ai: any = albumInfo as any;
    return (
      albumInfo?.AlbumArtist ||
      (Array.isArray(albumInfo?.Artists) ? albumInfo?.Artists[0] : undefined) ||
      ai?.AlbumArtists?.[0]?.Name ||
      ai?.ArtistItems?.[0]?.Name ||
      "Unknown Artist"
    );
  }, [albumInfo]);

  const toggleAlbumFavorite = async () => {
    if (!albumInfo?.Id || !authData.accessToken || !authData.serverAddress)
      return;

    setFavoriteLoading((prev) => ({ ...prev, [albumInfo.Id!]: true }));

    try {
      if (isAlbumFavorite) {
        await removeFromFavorites(
          authData.serverAddress,
          authData.accessToken,
          albumInfo.Id
        );
        setIsAlbumFavorite(false);
      } else {
        await addToFavorites(
          authData.serverAddress,
          authData.accessToken,
          albumInfo.Id
        );
        setIsAlbumFavorite(true);
      }
    } catch (error) {
      logger.error("Failed to toggle album favorite:", error);
    } finally {
      setFavoriteLoading((prev) => ({ ...prev, [albumInfo.Id!]: false }));
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

  useEffect(() => {
    if (albumId) {
      loadAlbumData();
      const onDl = () => loadAlbumData();
      window.addEventListener("downloadsUpdate", onDl);
      return () => window.removeEventListener("downloadsUpdate", onDl);
    }
  }, [albumId]);

  useEffect(() => {
    loadUserInfo();
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const lists = await getAllPlaylists();
        setAllPlaylists(lists || []);
      } catch {}
    })();
  }, []);

  const loadUserInfo = async () => {
    try {
      const [user, server] = await Promise.all<
        [typeof currentUser | null, typeof serverInfo | null]
      >([
        getCurrentUser().catch(() => null as any),
        getServerInfo().catch(() => null as any),
      ]);
      setCurrentUser(user);
      setServerInfo(server);
    } catch (error) {
      logger.error("Failed to load user info", error);
    }
  };

  const loadAlbumData = async () => {
    perf.start("AlbumView.load");
    try {
      if (!albumId) return;
      // Prefer local data when available; hybridData also falls back locally if server fails
      const [albumDetails, albumTracks] = await Promise.all([
        hybridData.getAlbumById(albumId),
        hybridData.getAlbumTracks(albumId),
      ]);

      if (!albumDetails && (!authData.accessToken || !authData.serverAddress)) {
        // If offline and no local album present, bail gracefully
        setAlbumInfo(null);
        setTracks([]);
      } else {
        setAlbumInfo(albumDetails as any);
        setTracks((albumTracks as any) || []);
      }
      if (albumId) {
        try {
          const dl = await isCollectionDownloaded(albumId);
          setIsDownloaded(dl);
        } catch {}
      }

      // Check favorite status for album
      if (albumDetails.Id) {
        const albumFavoriteStatus = await checkIsFavorite(
          authData.serverAddress,
          authData.accessToken,
          albumDetails.Id
        );
        setIsAlbumFavorite(albumFavoriteStatus);
      }

      // Check favorite status for all tracks
      if (Array.isArray(albumTracks) && albumTracks.length > 0) {
        const trackFavoritePromises = (albumTracks as any[]).map(
          async (track: any) => {
            if (track.Id) {
              try {
                const isFavorite = await checkIsFavorite(
                  authData.serverAddress,
                  authData.accessToken,
                  track.Id
                );
                return { id: track.Id, isFavorite };
              } catch (error) {
                logger.error(
                  `Failed to check favorite status for track ${track.Id}:`,
                  error
                );
                return { id: track.Id, isFavorite: false };
              }
            }
            return null;
          }
        );

        const trackFavoriteResults: Array<{
          id: string;
          isFavorite: boolean;
        } | null> = await Promise.all(trackFavoritePromises);
        const trackFavoriteMap: Record<string, boolean> = {};

        trackFavoriteResults.forEach((result) => {
          if (result) {
            trackFavoriteMap[result.id] = result.isFavorite;
          }
        });

        setTrackFavorites(trackFavoriteMap);
      }
    } catch (error) {
      logger.error("Failed to load album data", error);
    } finally {
      perf.end("AlbumView.load");
      setLoading(false);
    }
  };

  const handleToggleDownload = async () => {
    if (!albumInfo?.Id) return;
    if (downloading) return;
    setDownloading(true);
    const id = showLoading(
      isDownloaded ? "Removing downloads..." : "Downloading album..."
    );
    try {
      if (isDownloaded) {
        await removeAlbumDownloads(albumInfo.Id);
        setIsDownloaded(false);
        showSuccess("Removed album downloads");
      } else {
        const res = await downloadAlbumById(albumInfo.Id, albumInfo.Name);
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

  const getAlbumArt = (size: number = 300) => {
    return getImageUrl(albumInfo, authData.serverAddress, size);
  };

  const handlePlayAlbum = () => {
    if (tracks.length > 0) {
      playQueue(tracks as any[], 0);
    }
  };

  const handleShuffleAlbum = () => {
    if (tracks.length > 0) {
      const shuffledTracks = [...tracks].sort(() => Math.random() - 0.5);
      playQueue(shuffledTracks as any[], 0);
    }
  };

  const handleAddAllToQueue = () => {
    tracks.forEach((track) => {
      addToQueue(track as any);
    });
  };
  const handlePlayNextAll = () => {
    if (tracks.length === 0) return;
    if (!currentTrack) {
      // nothing playing — start the album
      return handlePlayAlbum();
    }
    // Insert next maintaining album order: last track should be added first
    const toInsert = [...tracks].reverse();
    toInsert.forEach((t) => addToQueueNext(t as any));
  };
  const handleAddAlbumToPlaylist = async (playlistId: string) => {
    const ids = tracks.map((t) => t.Id!).filter(Boolean) as string[];
    if (!ids.length) return;
    setAddingTo(playlistId);
    try {
      await addItemsToPlaylist(playlistId, ids);
      setAddAlbumDialogOpen(false);
    } catch (e) {
      logger.error("Failed to add album to playlist", e);
    } finally {
      setAddingTo(null);
    }
  };

  const handlePlayTrack = (track: AlbumTrack, index: number) => {
    playQueue(tracks as any[], index);
  };

  const isCurrentTrack = (trackId?: string) => {
    return trackId && currentTrack?.Id === trackId;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <div className="ml-64 px=6 py-8 pb-32">
          <div className="max-w-none mx-auto">
            <LoadingSkeleton type="albumDetail" />
          </div>
        </div>
        <MusicPlayer
          showLyrics={showLyrics}
          onLyricsToggle={handleLyricsToggle}
        />
      </div>
    );
  }

  if (!albumInfo) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <div className="ml-64 flex items-center justify-center h-screen">
          <div className="text-center">
            <Music className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              Album not found
            </h2>
            <p className="text-gray-600 mb-4">
              The album you're looking for doesn't exist.
            </p>
            <Button onClick={() => navigate(-1)}>Go Back</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar
        activeSection={activeSection}
        onSectionChange={setActiveSection}
      />

      {/* Main Content */}
      <div className="ml-64">
        <div className="px-6 py-8 pb-32">
          <div className="max-w-none mx-auto">
            {/* Back Button */}
            <BackButton />

            {/* Album Info */}
            <div className="flex flex-col md:flex-row gap-8 mb-8">
              {/* Album Artwork */}
              <div className="flex-shrink-0">
                <div className="w-64 h-64 rounded-xl overflow-hidden bg-gradient-to-br from-gray-100 to-gray-200 shadow-lg">
                  {getAlbumArt() ? (
                    <img
                      src={getAlbumArt() || undefined}
                      alt={albumInfo.Name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Music className="w-16 h-16 text-gray-400" />
                    </div>
                  )}
                </div>
              </div>

              {/* Album Details */}
              <div className="flex-1 space-y-4">
                <div>
                  <h2 className="text-4xl font-bold text-gray-900 mb-1">
                    {albumInfo.Name || "Unknown Album"}
                  </h2>
                  <button
                    className="inline-flex items-center gap-1 text-sm text-gray-700 hover:text-pink-600 hover:underline cursor-pointer transition-colors"
                    onClick={() => handleArtistClick(albumArtistName)}
                  >
                    <User2 size={14} />
                    {albumArtistName}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                  {albumInfo.ProductionYear && (
                    <span>{albumInfo.ProductionYear}</span>
                  )}
                  <span>•</span>
                  <span>{tracks.length} tracks</span>
                  <span>•</span>
                  <span>
                    {(() => {
                      const totalTicks = tracks.reduce(
                        (sum, track) => sum + (track.RunTimeTicks || 0),
                        0
                      );
                      return formatDuration(totalTicks);
                    })()}
                  </span>
                </div>

                {albumInfo.Genres && albumInfo.Genres.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {albumInfo.Genres.map((genre) => (
                      <Badge key={genre} variant="secondary">
                        {genre}
                      </Badge>
                    ))}
                  </div>
                )}

                {albumInfo.Overview && (
                  <div className="space-y-2">
                    <p className="text-gray-700 max-w-2xl">
                      {showFullDescription
                        ? albumInfo.Overview
                        : albumInfo.Overview.length > 200
                          ? albumInfo.Overview.substring(0, 200) + "..."
                          : albumInfo.Overview}
                    </p>
                    {albumInfo.Overview.length > 200 && (
                      <button
                        onClick={() =>
                          setShowFullDescription(!showFullDescription)
                        }
                        className="text-pink-600 hover:text-pink-700 text-sm font-medium transition-colors"
                      >
                        {showFullDescription ? "Show less" : "Show more"}
                      </button>
                    )}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-3 pt-4">
                  <Button
                    onClick={handlePlayAlbum}
                    className="bg-pink-600 hover:bg-pink-700 px-8"
                  >
                    <Play className="w-5 h-5 mr-2" />
                    Play Album
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleShuffleAlbum}
                    className="px-6"
                  >
                    <Shuffle className="w-5 h-5 mr-2" />
                    Shuffle
                  </Button>

                  {/* Favourite (small icon button) */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={toggleAlbumFavorite}
                    disabled={favoriteLoading[albumInfo.Id || ""]}
                    className="p-1 text-gray-600 hover:text-pink-600 hover:bg-gray-100"
                    title={
                      isAlbumFavorite
                        ? "Remove from favourites"
                        : "Add to favourites"
                    }
                  >
                    {favoriteLoading[albumInfo.Id || ""] ? (
                      <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                    ) : (
                      <Star
                        className={`w-4 h-4 transition-colors ${
                          isAlbumFavorite
                            ? "text-pink-600 fill-pink-600"
                            : "text-gray-600"
                        }`}
                      />
                    )}
                  </Button>

                  {/* Download (small icon button) */}
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

                  {/* Inline buttons + dropdown */}
                  <div className="flex items-center gap-2">
                    <Dropdown
                      open={dropdownOpen}
                      onOpenChange={setDropdownOpen}
                      trigger={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="p-1 text-gray-600 hover:text-pink-600 hover:bg-gray-100"
                          onClick={(e) => e.stopPropagation()}
                          aria-label="Album options"
                        >
                          <MoreVertical className="w-4 h-4" />
                        </Button>
                      }
                      actions={[
                        {
                          id: "fav",
                          label: isAlbumFavorite ? "Unfavourite" : "Favourite",
                          icon: (
                            <Star
                              className={`w-4 h-4 ${
                                isAlbumFavorite
                                  ? "text-pink-600 fill-pink-600"
                                  : ""
                              }`}
                            />
                          ),
                          onSelect: toggleAlbumFavorite,
                          disabled: !!favoriteLoading[albumInfo.Id || ""],
                        },
                        {
                          id: "add-to-playlist",
                          label: "Add to playlist",
                          icon: <ListPlus className="w-4 h-4" />,
                          onSelect: () => setAddAlbumDialogOpen(true),
                          disabled: tracks.length === 0,
                        },
                        {
                          id: "download",
                          label: isDownloaded ? "Remove download" : "Download",
                          icon: downloading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Download
                              className={`w-4 h-4 ${isDownloaded ? "text-pink-600" : ""}`}
                            />
                          ),
                          onSelect: handleToggleDownload,
                          disabled: downloading,
                        },
                        {
                          id: "add-all",
                          label: "Add all to queue",
                          icon: <Plus className="w-4 h-4" />,
                          onSelect: handleAddAllToQueue,
                          disabled: tracks.length === 0,
                        },
                        {
                          id: "play-next",
                          label: "Play next",
                          icon: <ChevronsRight className="w-4 h-4" />,
                          onSelect: handlePlayNextAll,
                          disabled: tracks.length === 0,
                        },
                      ]}
                    />
                  </div>
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
                    albumArtist={albumInfo.AlbumArtist}
                    formatDuration={formatDuration}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={addAlbumDialogOpen} onOpenChange={setAddAlbumDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add album to playlist</DialogTitle>
            <DialogDescription>
              Select a playlist to add all tracks.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-80 overflow-y-auto space-y-1">
            {allPlaylists.map((pl: any) => (
              <button
                key={pl.Id}
                className="w-full text-left px-3 py-2 rounded hover:bg-gray-100 flex items-center justify-between"
                onClick={() => handleAddAlbumToPlaylist(pl.Id)}
                disabled={addingTo === pl.Id}
              >
                <span className="truncate">{pl.Name}</span>
                {addingTo === pl.Id && (
                  <Loader2 className="w-4 h-4 animate-spin text-pink-600" />
                )}
              </button>
            ))}
            {allPlaylists.length === 0 && (
              <div className="text-sm text-gray-500">No playlists found.</div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setAddAlbumDialogOpen(false)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MusicPlayer
        showLyrics={showLyrics}
        onLyricsToggle={handleLyricsToggle}
      />
    </div>
  );
};

export default AlbumView;
