import React, { useState, useEffect } from "react";
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
  checkIsFavorite,
  removeItemsFromPlaylist,
} from "@/lib/jellyfin";
import { isCollectionDownloaded, downloadTrack } from "@/lib/downloads";
import { localDb } from "@/lib/database";
import { hybridData } from "@/lib/sync";
import { logger } from "@/lib/logger";
import { ListMusic, Plus, Loader2, Heart } from "lucide-react";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import BlurHashImage from "@/components/BlurHashImage";

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
  const [addingToPlaylist, setAddingToPlaylist] = useState<string | null>(null);
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

      // Determine if track already added to each playlist (fetch items lazily in parallel but capped)
      if (trackId) {
        const containsMap: Record<string, boolean> = {};
        const entryIds: Record<string, string | null> = {};
        await Promise.all(
          playlistsData.slice(0, 25).map(async (pl) => {
            try {
              if (!pl.Id) return;
              const items = await getPlaylistItems(pl.Id);
              const it = items.find((it: any) => it.Id === trackId);
              containsMap[pl.Id] = !!it;
              entryIds[pl.Id] = it?.PlaylistItemId || null;
            } catch {}
          })
        );
        setPlaylistContains(containsMap);
        setStagedContains(containsMap);
        setEntryIdMap(entryIds);
      }

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
    return keys.some((k) => stagedContains[k] !== playlistContains[k]);
  }, [stagedContains, playlistContains]);

  const applyChanges = async () => {
    if (!isDirty) {
      onOpenChange(false);
      return;
    }
    setSaving(true);
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
      // Notify other views to refresh
      try {
        window.dispatchEvent(new CustomEvent("syncUpdate"));
      } catch {}
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
        <div className="py-2">
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
                  className={`transition-colors cursor-pointer hover:bg-accent ${trackIsFavorite ? "opacity-70" : ""}`}
                  onClick={() => {
                    if (trackIsFavorite) return; // already favourited
                    (async () => {
                      setAddingToPlaylist("__favorites__");
                      try {
                        const auth = JSON.parse(
                          localStorage.getItem("authData") || "{}"
                        );
                        if (auth.serverAddress && auth.accessToken) {
                          await addToFavorites(
                            auth.serverAddress,
                            auth.accessToken,
                            trackId
                          );
                          setTrackIsFavorite(true);
                        }
                        onOpenChange(false);
                      } catch (e) {
                        logger.error("Failed to favourite track:", e);
                      } finally {
                        setAddingToPlaylist(null);
                      }
                    })();
                  }}
                >
                  <CardContent className="p-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-12 h-12 rounded flex-shrink-0 overflow-hidden">
                        <div className="w-full h-full bg-gradient-to-br from-primary/20 to-primary/30 flex items-center justify-center">
                          <Heart className="w-6 h-6 text-primary fill-primary" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-foreground truncate flex items-center gap-2">
                          Favourites
                          {trackIsFavorite && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                              Added
                            </span>
                          )}
                        </h4>
                        <p className="text-sm text-muted-foreground">
                          Mark this track as favourite
                        </p>
                      </div>
                      {addingToPlaylist === "__favorites__" && (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      )}
                    </div>
                  </CardContent>
                </Card>
                {playlists.map((playlist) => {
                  const isAdding = addingToPlaylist === playlist.Id;
                  const original = playlistContains[playlist.Id || ""];
                  const desired = stagedContains[playlist.Id || ""];
                  const contains = desired; // reflect staged state
                  const isFavList = favoritePlaylistId === playlist.Id;

                  return (
                    <Card
                      key={playlist.Id}
                      className={`cursor-pointer transition-colors ${contains ? "hover:bg-accent" : "hover:bg-accent"}`}
                      onClick={() => !isAdding && togglePlaylist(playlist.Id!)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-center space-x-3">
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
                            <h4 className="font-medium text-foreground truncate flex items-center gap-2">
                              {playlist.Name}
                              {isFavList && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
                                  Fav
                                </span>
                              )}
                              {original && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                  Added
                                </span>
                              )}
                              {desired !== original && (
                                <span
                                  className={`text-[10px] px-1 py-0.5 rounded border ${desired ? "bg-green-100 text-green-700 border-green-200" : "bg-red-100 text-red-700 border-red-200"}`}
                                >
                                  {desired ? "Will add" : "Will remove"}
                                </span>
                              )}
                            </h4>
                            <p className="text-sm text-muted-foreground">
                              {playlist.ChildCount || 0} tracks
                            </p>
                          </div>
                          {isAdding && (
                            <Loader2 className="w-4 h-4 animate-spin text-primary" />
                          )}
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
