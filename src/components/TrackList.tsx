import React, { useEffect, useMemo, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import AddToPlaylistDialog from "@/components/AddToPlaylistDialog";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { Dropdown } from "@/components/Dropdown";
import {
  Play,
  Star,
  Plus,
  ListPlus,
  Download,
  ChevronsRight,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { findArtistByName } from "@/lib/jellyfin";
import {
  downloadTrack,
  removeDownload,
  getLocalUrlForTrack,
  resolveDownloadRequest,
} from "@/lib/downloads";
import { useNavigate } from "react-router-dom";

// Reusable track list renderer for albums, artists and playlists
interface Track {
  Id?: string;
  Name?: string;
  RunTimeTicks?: number;
  Artists?: string[];
  Album?: string;
  IndexNumber?: number;
  ImageTags?: { Primary?: string };
  LocalImages?: { Primary?: string };
  AlbumArtist?: string;
  Artist?: string;
  MediaSources?: any[];
}

interface TrackListProps {
  tracks: Track[];
  currentTrack?: Track | null;
  isPlaying?: boolean;
  onTrackPlay: (index: number) => void;
  onArtistClick?: (artistName: string) => void;
  showNumbers?: boolean;
  showMoreButton?: boolean;
  showAll?: boolean;
  onShowMoreToggle?: () => void;
  maxInitialTracks?: number;
  trackFavorites?: Record<string, boolean>;
  favoriteLoading?: Record<string, boolean>;
  onToggleTrackFavorite?: (trackId: string) => void;
  showArtistFromTrack?: boolean;
  albumArtist?: string;
  formatDuration: (ticks?: number) => string;
  // When true, render numbers based on list order (playlist position)
  usePlaylistIndex?: boolean;
  // If true, treat every track as already downloaded (skip probe)
  assumeAllDownloaded?: boolean;
  // If present, enables per-track removal from that playlist
  playlistId?: string;
}

const TrackList: React.FC<TrackListProps> = React.memo(
  ({
    tracks,
    currentTrack,
    isPlaying = false,
    onTrackPlay,
    onArtistClick,
    showNumbers = true,
    showMoreButton = false,
    showAll = false,
    onShowMoreToggle,
    maxInitialTracks = 5,
    trackFavorites = {},
    favoriteLoading = {},
    onToggleTrackFavorite,
    showArtistFromTrack = false,
    albumArtist,
    formatDuration,
    usePlaylistIndex = false,
    assumeAllDownloaded = false,
    playlistId,
  }) => {
    const navigate = useNavigate();
    const { queue, playNow, addToQueue, addToQueueNext } = useMusicPlayer();
    const [removing, setRemoving] = useState<Record<string, boolean>>({});
    const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
    const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<{
      id: string;
      name: string;
    } | null>(null);
    // Keep track of which track's dropdown is open to keep trigger visible
    const [openDropdownTrackId, setOpenDropdownTrackId] = useState<
      string | null
    >(null);
    const [downloadedMap, setDownloadedMap] = useState<Record<string, boolean>>(
      {}
    );
    const [dlLoading, setDlLoading] = useState<Record<string, boolean>>({});
    const trackIdsRef = useRef<Set<string>>(new Set());

    const isCurrentTrack = (trackId?: string) =>
      trackId && currentTrack?.Id === trackId;

    // Resolve artist name once per track render depending on context
    const getArtistName = (track: Track) => {
      if (showArtistFromTrack) {
        return track.Artists?.join(", ") || track.Artist || "Unknown Artist";
      }
      return track.Artists?.join(", ") || albumArtist || "Unknown Artist";
    };

    const convertToMusicTrack = (track: Track): any => ({
      Id: track.Id,
      Name: track.Name,
      Artist: track.Artist || track.Artists?.[0],
      AlbumArtist: track.AlbumArtist,
      Artists: track.Artists,
      RunTimeTicks: track.RunTimeTicks,
      ImageTags: track.ImageTags,
      LocalImages: (track as any)?.LocalImages,
      MediaSources: track.MediaSources || [],
    });

    const displayTracks = useMemo(() => {
      return showMoreButton && !showAll
        ? tracks.slice(0, maxInitialTracks)
        : tracks;
    }, [tracks, showMoreButton, showAll, maxInitialTracks]);

    // Download state handling
    const lastIdSignatureRef = useRef<string | null>(null);
    useEffect(() => {
      trackIdsRef.current = new Set(
        tracks.map((t) => t.Id).filter(Boolean) as string[]
      );
    }, [tracks]);
    useEffect(() => {
      const idSignature = tracks.map((t) => t.Id).join(",");
      if (idSignature === lastIdSignatureRef.current) return;
      lastIdSignatureRef.current = idSignature;
      if (assumeAllDownloaded) {
        // Mark all as downloaded synchronously to avoid flicker
        const map: Record<string, boolean> = {};
        tracks.forEach((t) => {
          if (t.Id) map[t.Id] = true;
        });
        setDownloadedMap(map);
        return; // Skip probe
      }
      let cancelled = false;
      (async () => {
        try {
          const pairs = await Promise.all(
            tracks.map(async (t) => {
              if (!t.Id) return null;
              try {
                const url = await getLocalUrlForTrack(t.Id);
                return [t.Id, !!url] as const;
              } catch {
                return [t.Id, false] as const;
              }
            })
          );
          if (cancelled) return;
          setDownloadedMap((prev) => {
            const next = { ...prev } as Record<string, boolean>;
            for (const p of pairs) if (p && p[0]) next[p[0]] = p[1];
            return next;
          });
        } catch {}
      })();
      return () => {
        cancelled = true;
      };
    }, [tracks, assumeAllDownloaded]);

    useEffect(() => {
      const handler = (event: Event) => {
        const detail = (
          event as CustomEvent<{ trackId?: string; downloaded?: boolean }>
        ).detail;
        if (!detail?.trackId) return;
        if (!trackIdsRef.current.has(detail.trackId)) return;
        setDownloadedMap((prev) => {
          const current = prev[detail.trackId];
          if (current === detail.downloaded) return prev;
          return {
            ...prev,
            [detail.trackId!]: Boolean(detail.downloaded),
          };
        });
      };
      window.addEventListener(
        "trackDownloadStatusChanged",
        handler as EventListener
      );
      return () => {
        window.removeEventListener(
          "trackDownloadStatusChanged",
          handler as EventListener
        );
      };
    }, []);

    return (
      <>
        <div className="space-y-1">
          {displayTracks.map((track, index) => (
            <div
              key={`${track.Id ?? "idx"}-${index}`}
              className={`group flex items-center px-3 py-2 rounded-md hover:bg-accent cursor-pointer transition-colors ${
                isCurrentTrack(track.Id) ? "bg-primary/10" : ""
              }`}
              onClick={() => onTrackPlay(index)}
            >
              {/* Track Number / Play Button */}
              <div className="w-10 flex items-center justify-center">
                {isCurrentTrack(track.Id) && isPlaying ? (
                  <div className="equalizer">
                    <span className="equalizer-bar" />
                    <span className="equalizer-bar" />
                    <span className="equalizer-bar" />
                  </div>
                ) : (
                  <>
                    {showNumbers && (
                      <span className="text-xs text-muted-foreground group-hover:hidden">
                        {usePlaylistIndex
                          ? index + 1
                          : track.IndexNumber || index + 1}
                      </span>
                    )}
                    <Play className="w-3 h-3 text-muted-foreground hidden group-hover:block" />
                  </>
                )}
              </div>

              {/* Track Info */}
              <div className="flex-1 min-w-0 px-3">
                <div className="flex items-center gap-2">
                  <h4
                    className={`text-sm font-medium truncate ${
                      isCurrentTrack(track.Id)
                        ? "text-primary"
                        : "text-foreground"
                    }`}
                  >
                    {track.Name}
                  </h4>
                  {trackFavorites[track.Id || ""] && (
                    <Star className="w-3 h-3 text-primary fill-primary flex-shrink-0" />
                  )}
                  {track.Id && downloadedMap[track.Id] && (
                    <Download
                      className="w-3 h-3 text-primary flex-shrink-0"
                      aria-label="Downloaded"
                    />
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  <button
                    className="hover:text-primary hover:underline transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      const name = getArtistName(track);
                      if (onArtistClick) return onArtistClick(name);
                      // Default artist navigation
                      (async () => {
                        try {
                          const artist = await findArtistByName(name);
                          if (artist?.Id) navigate(`/artist/${artist.Id}`);
                          else navigate(`/artist/${encodeURIComponent(name)}`);
                        } catch (err) {
                          navigate(`/artist/${encodeURIComponent(name)}`);
                        }
                      })();
                    }}
                  >
                    {getArtistName(track)}
                  </button>
                </p>
              </div>
              {/* Duration */}
              <div className="w-10 text-right pr-1">
                <span className="text-xs text-muted-foreground">
                  {formatDuration(track.RunTimeTicks)}
                </span>
              </div>

              {/* Inline Add to Playlist button + Dropdown trigger */}
              <div
                className="w-16 flex items-center justify-end gap-1"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {track.Id && track.Name && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-primary hover:bg-accent"
                    aria-label="Add to playlist"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTrackForPlaylist({
                        id: track.Id!,
                        name: track.Name!,
                      });
                      setShowAddToPlaylist(true);
                    }}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                )}
                <div
                  className={`flex justify-end transition-opacity ${
                    openDropdownTrackId === track.Id
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <Dropdown
                    trigger={
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-primary hover:bg-accent"
                        onClick={(e) => e.stopPropagation()}
                        aria-label="Track options"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </Button>
                    }
                    actions={(() => {
                      const actions = [] as any[];
                      // Favourite toggle
                      if (onToggleTrackFavorite && track.Id) {
                        actions.push({
                          id: "fav",
                          label: trackFavorites[track.Id]
                            ? "Remove favourite"
                            : "Add to favourites",
                          icon: (
                            <Star
                              className={`w-4 h-4 ${
                                trackFavorites[track.Id]
                                  ? "text-primary fill-primary"
                                  : ""
                              }`}
                            />
                          ),
                          onSelect: () => onToggleTrackFavorite(track.Id!),
                          disabled: !!favoriteLoading[track.Id],
                        });
                      }
                      // Add to playlist
                      if (track.Id && track.Name) {
                        actions.push({
                          id: "add-to-playlist",
                          label: "Add to playlist",
                          icon: <Plus className="w-4 h-4" />,
                          onSelect: () => {
                            setSelectedTrackForPlaylist({
                              id: track.Id!,
                              name: track.Name!,
                            });
                            setShowAddToPlaylist(true);
                          },
                        });
                      }
                      // Download / remove
                      if (track.Id) {
                        const isDownloaded = downloadedMap[track.Id];
                        actions.push({
                          id: "download",
                          label: isDownloaded ? "Remove download" : "Download",
                          icon: (
                            <Download
                              className={`w-4 h-4 ${
                                isDownloaded ? "text-primary" : ""
                              }`}
                            />
                          ),
                          onSelect: async () => {
                            if (!track.Id) return;
                            setDlLoading((m) => ({ ...m, [track.Id!]: true }));
                            try {
                              const has =
                                downloadedMap[track.Id] ||
                                !!(await getLocalUrlForTrack(track.Id));
                              if (has) {
                                await removeDownload(track.Id);
                                setDownloadedMap((m) => ({
                                  ...m,
                                  [track.Id!]: false,
                                }));
                              } else {
                                const ms = (track as any).MediaSources?.[0];
                                const request = resolveDownloadRequest(
                                  track.Id!,
                                  {
                                    mediaSource: ms,
                                  }
                                );
                                if (!request.url) return;
                                await downloadTrack({
                                  trackId: track.Id,
                                  name: track.Name,
                                  url: request.url,
                                  container:
                                    request.container ??
                                    ms?.Container ??
                                    undefined,
                                  bitrate:
                                    request.bitrate ?? ms?.Bitrate ?? undefined,
                                  track: track as any,
                                });
                                setDownloadedMap((m) => ({
                                  ...m,
                                  [track.Id!]: true,
                                }));
                              }
                            } finally {
                              setDlLoading((m) => ({
                                ...m,
                                [track.Id!]: false,
                              }));
                              try {
                                window.dispatchEvent(
                                  new CustomEvent("downloadsUpdate")
                                );
                              } catch {}
                            }
                          },
                          disabled: !!dlLoading[track.Id],
                        });
                      }
                      // Add to queue
                      actions.push({
                        id: "queue",
                        label: "Add to queue",
                        icon: <ListPlus className="w-4 h-4" />,
                        onSelect: () => {
                          if (track.Id) {
                            if (queue.length === 0) {
                              playNow(convertToMusicTrack(track));
                            } else {
                              addToQueue(convertToMusicTrack(track));
                            }
                          }
                        },
                      });
                      // Play next
                      actions.push({
                        id: "play-next",
                        label: "Play next",
                        icon: <ChevronsRight className="w-4 h-4" />,
                        onSelect: () => {
                          if (track.Id) {
                            addToQueueNext(convertToMusicTrack(track));
                          }
                        },
                      });
                      // Remove from this playlist (when in playlist view)
                      if (playlistId && track.Id) {
                        actions.push({ separator: true } as any);
                        actions.push({
                          id: "remove-from-playlist",
                          label: "Remove from this playlist",
                          destructive: true,
                          icon: <Trash2 className="w-4 h-4" />,
                          onSelect: async () => {
                            try {
                              setRemoving((m) => ({ ...m, [track.Id!]: true }));
                              const { removeItemsFromPlaylist } = await import(
                                "@/lib/jellyfin"
                              );
                              const entryId =
                                (track as any).PlaylistItemId || track.Id!;
                              await removeItemsFromPlaylist(playlistId, [
                                entryId,
                              ]);
                              // Optimistically update UI list if parent provided tracks
                              try {
                                const evt = new CustomEvent(
                                  "playlistItemRemoved",
                                  {
                                    detail: {
                                      playlistId,
                                      trackId: track.Id,
                                      entryId,
                                    },
                                  }
                                );
                                window.dispatchEvent(evt);
                              } catch {}
                            } catch (err) {
                              console.error(
                                "Failed to remove from playlist",
                                err
                              );
                            } finally {
                              setRemoving((m) => ({
                                ...m,
                                [track.Id!]: false,
                              }));
                            }
                          },
                          disabled: !!removing[track.Id],
                        });
                      }
                      return actions;
                    })()}
                    onOpenChange={(open) => {
                      setOpenDropdownTrackId(open ? track.Id || null : null);
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Show More / Less */}
        {showMoreButton && tracks.length > maxInitialTracks && (
          <div className="flex justify-center mt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={onShowMoreToggle}
              className="text-xs"
            >
              {showAll ? "Show Less" : "Show More"}
            </Button>
          </div>
        )}

        {/* Add To Playlist Dialog */}
        <AddToPlaylistDialog
          open={showAddToPlaylist}
          onOpenChange={setShowAddToPlaylist}
          trackId={selectedTrackForPlaylist?.id}
          trackName={selectedTrackForPlaylist?.name}
        />
      </>
    );
  }
);

export default TrackList;
