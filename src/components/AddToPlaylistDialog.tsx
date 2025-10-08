import React, { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import {
  addItemsToPlaylist,
  addTrackToPlaylist,
  getPlaylistInfo,
  getPlaylistItems,
  addToFavorites,
  removeFromFavorites,
  checkIsFavorite,
  removeItemsFromPlaylist,
} from "@/lib/jellyfin";
import { isCollectionDownloaded, downloadTrack } from "@/lib/downloads";
import { localDb } from "@/lib/database";
import { hybridData } from "@/lib/sync";
import { logger } from "@/lib/logger";
import { ListMusic, Loader2, Heart, Circle, CircleDot } from "lucide-react";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import BlurHashImage from "@/components/BlurHashImage";
import { APP_EVENTS, FavoriteStateChangedDetail } from "@/constants/events";

interface AddToPlaylistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trackId: string;
  trackName?: string;
}

export default function AddToPlaylistDialog({
  open,
  onOpenChange,
  trackId,
  trackName,
}: AddToPlaylistDialogProps) {
  const [playlists, setPlaylists] = useState<BaseItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [playlistContains, setPlaylistContains] = useState<
    Record<string, boolean>
  >({});
  // Staged membership (what the user intends after toggling)
  const [stagedContains, setStagedContains] = useState<Record<string, boolean>>(
    {}
  );
  // Optional map of playlistId -> entryId for this track (when it exists)
  const [entryIdMap, setEntryIdMap] = useState<Record<string, string | null>>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [favoritePlaylistId, setFavoritePlaylistId] = useState<string | null>(
    null
  );
  const [trackIsFavorite, setTrackIsFavorite] = useState<boolean>(false);
  const [stagedFavorite, setStagedFavorite] = useState<boolean>(false);
  const FavoriteStatusIcon = stagedFavorite ? CircleDot : Circle;
  let favoriteStatusIconClass = "w-5 h-5 transition-colors";
  if (stagedFavorite !== trackIsFavorite) {
    favoriteStatusIconClass += stagedFavorite
      ? " text-green-600"
      : " text-red-600";
  } else {
    favoriteStatusIconClass += stagedFavorite
      ? " text-primary"
      : " text-muted-foreground";
  }
  const emitFavoriteEvent = (isFavorite: boolean) => {
    if (!trackId) return;
    try {
      window.dispatchEvent(
        new CustomEvent<FavoriteStateChangedDetail>(
          APP_EVENTS.favoriteStateChanged,
          {
            detail: { trackId, isFavorite },
          }
        )
      );
    } catch (error) {
      logger.error("Failed to dispatch favorite state change", error);
    }
  };

  // Get auth data from localStorage
  const authData = JSON.parse(localStorage.getItem("authData") || "{}");
  const serverAddress = authData.serverAddress || "";

  // Helper function to get playlist image
  const getPlaylistImage = (playlist: BaseItemDto, size: number = 150) => {
    if (playlist.ImageTags?.Primary && serverAddress && playlist.Id) {
      return `${serverAddress}/Items/${playlist.Id}/Images/Primary?maxWidth=${size}&quality=90`;
    }
    return null;
  };

  // Helper function to get playlist blur hash
  const getPlaylistBlurHash = (playlist: BaseItemDto) => {
    const primaryImageTag = playlist.ImageTags?.Primary;
    if (!primaryImageTag || !playlist.ImageBlurHashes?.Primary) {
      return undefined;
    }
    return playlist.ImageBlurHashes.Primary[primaryImageTag];
  };

  const primePlaylistCache = useCallback(
    async (playlistsData: BaseItemDto[]) => {
      try {
        if (!playlistsData.length) return;
        await localDb.initialize();
        try {
          await localDb.savePlaylists(playlistsData);
        } catch (saveError) {
          logger.warn("Failed to cache playlists metadata", saveError);
        }

        let tracksBuffer: BaseItemDto[] = [];
        for (const playlist of playlistsData) {
          if (!playlist.Id) continue;
          try {
            const items = await getPlaylistItems(playlist.Id);
            const normalized = (items || []).filter((item) => item?.Id);
            const totalTicks = normalized.reduce(
              (acc, item) => acc + (item.RunTimeTicks || 0),
              0
            );
            const entries = normalized.map((item, index) => ({
              playlistItemId:
                ((item as any).PlaylistItemId as string | undefined) ||
                `${playlist.Id}:${item.Id}:${index}`,
              trackId: item.Id!,
              sortIndex: index,
            }));
            await localDb.replacePlaylistItems(playlist.Id, entries);
            await localDb.updatePlaylistStats(
              playlist.Id,
              normalized.length,
              totalTicks
            );
            const audioTracks = normalized.filter(
              (item) => item.Type === "Audio" && item.Id
            );
            if (audioTracks.length) {
              tracksBuffer.push(...audioTracks);
              if (tracksBuffer.length >= 200) {
                await localDb.saveTracks(tracksBuffer);
                tracksBuffer = [];
              }
            }
          } catch (error) {
            logger.warn(
              `Failed to prime playlist cache for ${playlist.Name || playlist.Id}`,
              error
            );
          }
        }

        if (tracksBuffer.length) {
          await localDb.saveTracks(tracksBuffer);
        }
      } catch (error) {
        logger.warn("Prime playlist cache failed", error);
      }
    },
    []
  );

  useEffect(() => {
    if (open) {
      loadPlaylists();
    }
  }, [open]);

  const loadPlaylists = async () => {
    setLoading(true);
    try {
      // Use hybrid data service for better performance
      const playlistsData = await hybridData.getPlaylists();
      setPlaylists(playlistsData);

      // Identify a favourite playlist by name heuristics
      const fav = playlistsData.find(
        (p) =>
          (p.Name || "").toLowerCase().includes("favourite") ||
          (p.Name || "").toLowerCase().includes("favorite")
      );
      setFavoritePlaylistId(fav?.Id || null);

      const containsMap: Record<string, boolean> = {};
      const entryIds: Record<string, string | null> = {};

      if (trackId) {
        try {
          await localDb.initialize();
          let membership: Record<string, { playlistItemId: string | null }> =
            {};
          const hasCachedItems = await localDb.hasPlaylistItemsCached();

          if (hasCachedItems) {
            membership = await localDb.getTrackPlaylistMembership(trackId);
          } else if (playlistsData.length) {
            const remoteMembership: Record<
              string,
              { playlistItemId: string | null }
            > = {};
            const tracksToCache: BaseItemDto[] = [];

            await Promise.all(
              playlistsData.slice(0, 25).map(async (pl) => {
                if (!pl.Id) return;
                try {
                  const items = await getPlaylistItems(pl.Id);
                  const match = items.find((item: any) => item.Id === trackId);
                  if (match) {
                    remoteMembership[pl.Id] = {
                      playlistItemId: match.PlaylistItemId || null,
                    };
                  }

                  const normalized = (items || []).filter((item) => item?.Id);
                  const totalTicks = normalized.reduce(
                    (acc, item) => acc + (item.RunTimeTicks || 0),
                    0
                  );
                  const entries = normalized.map((item, index) => ({
                    playlistItemId:
                      ((item as any).PlaylistItemId as string | undefined) ||
                      `${pl.Id}:${item.Id}:${index}`,
                    trackId: item.Id!,
                    sortIndex: index,
                  }));
                  await localDb.replacePlaylistItems(pl.Id, entries);
                  await localDb.updatePlaylistStats(
                    pl.Id,
                    normalized.length,
                    totalTicks
                  );

                  const audioTracks = normalized.filter(
                    (item) => item.Type === "Audio" && item.Id
                  );
                  if (audioTracks.length) {
                    tracksToCache.push(...audioTracks);
                  }
                } catch (error) {
                  logger.warn(
                    `Failed to fetch playlist items for ${pl.Name || pl.Id}`,
                    error
                  );
                }
              })
            );

            if (tracksToCache.length) {
              await localDb.saveTracks(tracksToCache);
            }

            try {
              await localDb.savePlaylists(playlistsData);
            } catch (saveError) {
              logger.warn(
                "Failed to persist playlist metadata locally",
                saveError
              );
            }

            membership = remoteMembership;

            // Prime the rest of the cache asynchronously for future loads
            void primePlaylistCache(playlistsData);
          }

          for (const playlist of playlistsData) {
            if (!playlist.Id) continue;
            const info = membership[playlist.Id];
            containsMap[playlist.Id] = !!info;
            entryIds[playlist.Id] = info?.playlistItemId ?? null;
          }
        } catch (error) {
          logger.warn("Unable to resolve playlist membership", error);
          for (const playlist of playlistsData) {
            if (!playlist.Id) continue;
            containsMap[playlist.Id] = false;
            entryIds[playlist.Id] = null;
          }
        }
      }

      if (!trackId) {
        for (const playlist of playlistsData) {
          if (!playlist.Id) continue;
          containsMap[playlist.Id] = false;
          entryIds[playlist.Id] = null;
        }
      }

      setPlaylistContains(containsMap);
      setStagedContains(containsMap);
      setEntryIdMap(entryIds);

      // Check favourite status of track
      try {
        const auth = JSON.parse(localStorage.getItem("authData") || "{}");
        if (auth.serverAddress && auth.accessToken && trackId) {
          const favStatus = await checkIsFavorite(
            auth.serverAddress,
            auth.accessToken,
            trackId
          );
          setTrackIsFavorite(favStatus);
          setStagedFavorite(favStatus);
        }
      } catch {}
    } catch (error) {
      logger.error("Failed to load playlists:", error);
    } finally {
      setLoading(false);
    }
  };

  // Toggle staged membership
  const togglePlaylist = (playlistId: string) => {
    setStagedContains((prev) => ({
      ...prev,
      [playlistId]: !prev[playlistId],
    }));
  };

  const isDirty = React.useMemo(() => {
    const keys = Object.keys(stagedContains);
    const playlistChanged = keys.some(
      (k) => stagedContains[k] !== playlistContains[k]
    );
    const favoriteChanged = stagedFavorite !== trackIsFavorite;
    return playlistChanged || favoriteChanged;
  }, [stagedContains, playlistContains, stagedFavorite, trackIsFavorite]);

  const applyChanges = async () => {
    if (!isDirty) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
    const playlistsToRefresh = new Set<string>();
    try {
      const toAdd: string[] = [];
      const toRemove: string[] = [];
      for (const pid of Object.keys(stagedContains)) {
        const want = stagedContains[pid];
        const had = playlistContains[pid];
        if (want && !had) toAdd.push(pid);
        if (!want && had) toRemove.push(pid);
      }
      // Process additions
      await Promise.all(
        toAdd.map(async (pid) => {
          try {
            await addItemsToPlaylist(pid, [trackId]);
            playlistsToRefresh.add(pid);
            // If favourite playlist, also favourite the track
            if (
              favoritePlaylistId &&
              pid === favoritePlaylistId &&
              !trackIsFavorite
            ) {
              const auth = JSON.parse(localStorage.getItem("authData") || "{}");
              if (auth.serverAddress && auth.accessToken) {
                await addToFavorites(
                  auth.serverAddress,
                  auth.accessToken,
                  trackId
                );
                setTrackIsFavorite(true);
                setStagedFavorite(true);
                emitFavoriteEvent(true);
              }
            }
            // If playlist is downloaded, auto-download this track
            try {
              if (await isCollectionDownloaded(pid)) {
                const auth = JSON.parse(
                  localStorage.getItem("authData") || "{}"
                );
                const url = `${auth.serverAddress}/Audio/${trackId}/stream?static=true&api_key=${auth.accessToken}`;
                await downloadTrack({ trackId, name: trackName, url });
              }
            } catch {}
            // Update local counts optimistically
            setPlaylists((prev) =>
              prev.map((p) =>
                p.Id === pid ? { ...p, ChildCount: (p.ChildCount || 0) + 1 } : p
              )
            );
          } catch (e) {
            logger.error(`Failed adding to playlist ${pid}`, e);
          }
        })
      );
      // Process removals
      await Promise.all(
        toRemove.map(async (pid) => {
          try {
            let entryId = entryIdMap[pid];
            if (!entryId) {
              // Fetch to find the entry id
              const items = await getPlaylistItems(pid);
              const it = items.find((it: any) => it.Id === trackId);
              entryId = it?.PlaylistItemId || null;
            }
            if (entryId) {
              await removeItemsFromPlaylist(pid, [entryId]);
              playlistsToRefresh.add(pid);
              setPlaylists((prev) =>
                prev.map((p) =>
                  p.Id === pid
                    ? { ...p, ChildCount: Math.max(0, (p.ChildCount || 1) - 1) }
                    : p
                )
              );
            }
          } catch (e) {
            logger.error(`Failed removing from playlist ${pid}`, e);
          }
        })
      );

      if (stagedFavorite !== trackIsFavorite) {
        const auth = JSON.parse(localStorage.getItem("authData") || "{}");
        if (auth.serverAddress && auth.accessToken) {
          if (stagedFavorite) {
            await addToFavorites(auth.serverAddress, auth.accessToken, trackId);
          } else {
            await removeFromFavorites(
              auth.serverAddress,
              auth.accessToken,
              trackId
            );
          }
          setTrackIsFavorite(stagedFavorite);
          emitFavoriteEvent(stagedFavorite);
        }
      }
      // Notify other views to refresh
      try {
        window.dispatchEvent(new CustomEvent("syncUpdate"));
      } catch {}

      if (playlistsToRefresh.size > 0) {
        const targetPlaylists = playlists.filter(
          (pl) => pl.Id && playlistsToRefresh.has(pl.Id)
        );
        if (targetPlaylists.length) {
          await primePlaylistCache(targetPlaylists);
          if (trackId) {
            try {
              await localDb.initialize();
              const refreshedMembership =
                await localDb.getTrackPlaylistMembership(trackId);
              setPlaylistContains((prev) => {
                const next = { ...prev };
                for (const pl of targetPlaylists) {
                  if (!pl.Id) continue;
                  next[pl.Id] = !!refreshedMembership[pl.Id];
                }
                return next;
              });
              setEntryIdMap((prev) => {
                const next = { ...prev };
                for (const pl of targetPlaylists) {
                  if (!pl.Id) continue;
                  next[pl.Id] =
                    refreshedMembership[pl.Id]?.playlistItemId ?? null;
                }
                return next;
              });
            } catch (error) {
              logger.warn(
                "Failed to update local membership state after changes",
                error
              );
            }
          }
        }
      }
      if (playlistsToRefresh.size > 0) {
        try {
          playlistsToRefresh.forEach((pid) => {
            window.dispatchEvent(
              new CustomEvent("playlistItemsUpdated", {
                detail: { playlistId: pid },
              })
            );
          });
        } catch (error) {
          logger.warn("Failed to broadcast playlist updates", error);
        }
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-5 sm:p-6">
        <DialogHeader>
          <DialogTitle>Add to Playlist</DialogTitle>
          <DialogDescription>
            {trackName
              ? `Add "${trackName}" to a playlist`
              : "Add track to a playlist"}
          </DialogDescription>
        </DialogHeader>
        <div className="py-2 overflow-hidden">
          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="flex items-center space-x-3">
                  <Skeleton className="h-12 w-12 rounded" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : playlists.length > 0 ? (
            <div className="max-h-64 overflow-y-auto pr-2">
              <div className="space-y-2">
                {/* Synthetic Favourites entry (Jellyfin favourites aren't a real playlist) */}
                <Card
                  key="__favorites__"
                  className={`transition-colors cursor-pointer hover:bg-accent ${stagedFavorite ? "border border-primary/30 bg-primary/5" : ""}`}
                  onClick={() => {
                    if (!trackId) return;
                    setStagedFavorite((prev) => !prev);
                  }}
                  role="button"
                  aria-pressed={stagedFavorite}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded flex-shrink-0 overflow-hidden">
                        <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center">
                          <Heart className="w-6 h-6 text-primary fill-primary" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-foreground truncate">
                          Favourites
                        </h4>
                      </div>
                      <div className="ml-auto flex-shrink-0">
                        <FavoriteStatusIcon
                          className={favoriteStatusIconClass}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {playlists.map((playlist) => {
                  const original = playlistContains[playlist.Id || ""];
                  const desired = stagedContains[playlist.Id || ""];
                  const contains = desired; // reflect staged state
                  const isFavList = favoritePlaylistId === playlist.Id;
                  const PlaylistStatusIcon = contains ? CircleDot : Circle;
                  let playlistStatusIconClass = "w-5 h-5 transition-colors";
                  if (desired !== original) {
                    playlistStatusIconClass += desired
                      ? " text-green-600"
                      : " text-red-600";
                  } else {
                    playlistStatusIconClass += contains
                      ? " text-primary"
                      : " text-muted-foreground";
                  }
                  return (
                    <Card
                      key={playlist.Id}
                      className={`cursor-pointer transition-colors ${contains ? "hover:bg-accent" : "hover:bg-accent"}`}
                      onClick={() => togglePlaylist(playlist.Id!)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 rounded flex-shrink-0 overflow-hidden">
                            {getPlaylistImage(playlist) ? (
                              <BlurHashImage
                                src={getPlaylistImage(playlist)!}
                                blurHash={getPlaylistBlurHash(playlist)}
                                alt={playlist.Name || "Playlist"}
                                className="w-full h-full object-cover"
                                width={48}
                                height={48}
                              />
                            ) : (
                              <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center">
                                <ListMusic className="w-6 h-6 text-primary" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="font-medium text-foreground truncate">
                                {playlist.Name}
                              </h4>
                              {isFavList && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                  Fav
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {playlist.ChildCount || 0} tracks
                            </p>
                          </div>
                          <div className="ml-auto flex-shrink-0">
                            <PlaylistStatusIcon
                              className={playlistStatusIconClass}
                              aria-hidden="true"
                            />
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <ListMusic className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <h3 className="text-lg font-medium text-foreground mb-1">
                No playlists
              </h3>
              <p className="text-muted-foreground text-sm">
                Create a playlist first to add tracks to it.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2 flex items-center justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {isDirty && (
            <Button onClick={applyChanges} disabled={saving}>
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Saving
                </span>
              ) : (
                "Done"
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
