import { Dropdown } from "@/components/Dropdown";
import { APP_EVENTS, FavoriteStateChangedDetail } from "@/constants/events";
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
import { useOfflineModeContext } from "@/contexts/OfflineModeContext";
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
import { localDb } from "@/lib/database";
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
  const { isOffline } = useOfflineModeContext();

  const handleArtistClick = async (artistName: string) => {
    const querySuffix = searchParams.get("q")
      ? `?q=${encodeURIComponent(searchParams.get("q") || "")}`
      : "";

    if (isOffline) {
      navigate(`/artist/${encodeURIComponent(artistName)}${querySuffix}`);
      return;
    }
    try {
      // Try to find the artist by name to get their ID
      const artist = await findArtistByName(artistName);
      if (artist?.Id) {
        navigate(`/artist/${artist.Id}${querySuffix}`);
      } else {
        // Fallback: navigate with the name (for now)
        navigate(`/artist/${encodeURIComponent(artistName)}${querySuffix}`);
      }
    } catch (error) {
      logger.error("Error finding artist:", error);
      // Fallback navigation
      navigate(`/artist/${encodeURIComponent(artistName)}${querySuffix}`);
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
    if (isOffline) {
      showError("Favourites aren't available offline.");
      return;
    }
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
    if (isOffline) {
      showError("Favourites aren't available offline.");
      return;
    }
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
    if (!albumId) return;
    loadAlbumData();
    const onDl = () => loadAlbumData();
    window.addEventListener("downloadsUpdate", onDl);
    return () => window.removeEventListener("downloadsUpdate", onDl);
  }, [albumId, isOffline]);

  useEffect(() => {
    const trackIds = new Set(
      (tracks || []).map((track) => track.Id).filter(Boolean) as string[]
    );
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<FavoriteStateChangedDetail>;
      if (!detail?.trackId || !trackIds.has(detail.trackId)) return;
      setTrackFavorites((prev) => {
        if (prev[detail.trackId] === detail.isFavorite) {
          return prev;
        }
        return { ...prev, [detail.trackId]: detail.isFavorite };
      });
    };
    window.addEventListener(
      APP_EVENTS.favoriteStateChanged,
      handler as EventListener
    );
    return () => {
      window.removeEventListener(
        APP_EVENTS.favoriteStateChanged,
        handler as EventListener
      );
    };
  }, [tracks]);

  useEffect(() => {
    loadUserInfo();
  }, []);
  useEffect(() => {
    if (isOffline) {
      setAllPlaylists([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const lists = await getAllPlaylists();
        if (!cancelled) {
          setAllPlaylists(lists || []);
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [isOffline]);

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
      if (!albumId) {
        setAlbumInfo(null);
        setTracks([]);
        return;
      }

      setLoading(true);

      let albumDetails: any = null;
      let albumTracks: any[] = [];

      try {
        const results = await Promise.all([
          hybridData.getAlbumById(albumId),
          hybridData.getAlbumTracks(albumId),
        ]);
        albumDetails = results[0];
        albumTracks = Array.isArray(results[1]) ? (results[1] as any[]) : [];
      } catch (error) {
        logger.warn("Hybrid album lookup failed", error);
      }

      if (isOffline) {
        try {
          await localDb.initialize();
          if (!albumDetails) {
            albumDetails = await localDb.getAlbumById(albumId);
          }
          if (!albumTracks.length) {
            const localAlbumTracks = await localDb.getTracksByAlbumId(albumId);
            albumTracks = Array.isArray(localAlbumTracks)
              ? localAlbumTracks
              : [];
          }
        } catch (localError) {
          logger.warn("Offline local album load failed", localError);
        }
      }

      if (!albumDetails && (!authData.accessToken || !authData.serverAddress)) {
        setAlbumInfo(null);
        setTracks([]);
      } else {
        setAlbumInfo((albumDetails as any) || null);
        setTracks(Array.isArray(albumTracks) ? (albumTracks as any) : []);
      }
      if (albumId) {
        try {
          const dl = await isCollectionDownloaded(albumId);
          setIsDownloaded(dl);
        } catch {}
      }

      if (!isOffline && authData.serverAddress && authData.accessToken) {
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
        } else {
          setTrackFavorites({});
        }
      } else {
        setIsAlbumFavorite(false);
        setTrackFavorites({});
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
    if (isOffline && !isDownloaded) {
      showError("Connect to the server to download this album.");
      return;
    }
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
        const fullyDownloaded = await isCollectionDownloaded(albumInfo.Id);
        setIsDownloaded(fullyDownloaded);
        if (res.failed > 0) {
          showError(
            `Downloaded ${res.downloaded} tracks, ${res.failed} failed. The album will appear in Downloads once every track is saved.`
          );
        } else {
          showSuccess(`Downloaded ${res.downloaded} tracks`);
        }
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
    if (isOffline) {
      showError("Playlists aren't available offline.");
      return;
    }
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
      <div className="min-h-screen bg-background">
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
    const description = isOffline
      ? "This album isn't available offline yet. Download it from your library before disconnecting."
      : "The album you're looking for doesn't exist.";
    return (
      <div className="min-h-screen bg-background">
        <Sidebar
          activeSection={activeSection}
          onSectionChange={setActiveSection}
        />
        <div className="ml-64 flex items-center justify-center h-screen">
          <div className="text-center">
            <Music className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Album not found
            </h2>
            <p className="text-muted-foreground mb-4">{description}</p>
            <div className="flex justify-center gap-3">
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
    );
  }

  return (
    <div className="min-h-screen bg-background">
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
                <div className="w-64 h-64 rounded-xl overflow-hidden bg-gradient-to-br from-muted to-muted/50 shadow-lg">
                  {getAlbumArt() ? (
                    <img
                      src={getAlbumArt() || undefined}
                      alt={albumInfo.Name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Music className="w-16 h-16 text-muted-foreground" />
                    </div>
                  )}
                </div>
              </div>

              {/* Album Details */}
              <div className="flex-1 space-y-4">
                <div>
                  <h2 className="text-4xl font-bold text-foreground mb-1">
                    {albumInfo.Name || "Unknown Album"}
                  </h2>
                  <button
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary hover:underline cursor-pointer transition-colors"
                    onClick={() => handleArtistClick(albumArtistName)}
                  >
                    <User2 size={14} />
                    {albumArtistName}
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
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
                    <p className="text-muted-foreground max-w-2xl">
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
                        className="text-primary hover:text-primary/80 text-sm font-medium transition-colors"
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
                    disabled={isOffline || favoriteLoading[albumInfo.Id || ""]}
                    className="p-1 text-muted-foreground hover:text-primary hover:bg-accent"
                    title={
                      isOffline
                        ? "Favourites unavailable offline"
                        : isAlbumFavorite
                          ? "Remove from favourites"
                          : "Add to favourites"
                    }
                  >
                    {favoriteLoading[albumInfo.Id || ""] ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Star
                        className={`w-4 h-4 transition-colors ${
                          isAlbumFavorite
                            ? "text-primary fill-primary"
                            : "text-muted-foreground"
                        }`}
                      />
                    )}
                  </Button>

                  {/* Download (small icon button) */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleToggleDownload}
                    disabled={downloading || (isOffline && !isDownloaded)}
                    className="p-1 text-muted-foreground hover:text-primary hover:bg-accent"
                    title={isDownloaded ? "Remove download" : "Download"}
                  >
                    {downloading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      <Download
                        className={`w-4 h-4 ${
                          isDownloaded
                            ? "text-primary"
                            : "text-muted-foreground"
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
                          className="p-1 text-muted-foreground hover:text-primary hover:bg-accent"
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
                                  ? "text-primary fill-primary"
                                  : ""
                              }`}
                            />
                          ),
                          onSelect: toggleAlbumFavorite,
                          disabled:
                            isOffline || !!favoriteLoading[albumInfo.Id || ""],
                        },
                        {
                          id: "add-to-playlist",
                          label: "Add to playlist",
                          icon: <ListPlus className="w-4 h-4" />,
                          onSelect: () => setAddAlbumDialogOpen(true),
                          disabled: tracks.length === 0 || isOffline,
                        },
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
                          onSelect: handleToggleDownload,
                          disabled: downloading || (isOffline && !isDownloaded),
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
                    albumArtist={albumInfo.AlbumArtist}
                    formatDuration={formatDuration}
                    isOffline={isOffline}
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
            {!isOffline &&
              allPlaylists.map((pl: any) => (
                <button
                  key={pl.Id}
                  className="w-full text-left px-3 py-2 rounded hover:bg-accent flex items-center justify-between"
                  onClick={() => handleAddAlbumToPlaylist(pl.Id)}
                  disabled={addingTo === pl.Id}
                >
                  <span className="truncate">{pl.Name}</span>
                  {addingTo === pl.Id && (
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  )}
                </button>
              ))}
            {isOffline ? (
              <div className="text-sm text-muted-foreground">
                Playlists aren't available offline.
              </div>
            ) : (
              allPlaylists.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No playlists found.
                </div>
              )
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
