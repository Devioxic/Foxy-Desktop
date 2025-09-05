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
  addTrackToPlaylist,
  getPlaylistInfo,
  getPlaylistItems,
  addToFavorites,
  checkIsFavorite,
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
        await Promise.all(
          playlistsData.slice(0, 25).map(async (pl) => {
            try {
              if (!pl.Id) return;
              const items = await getPlaylistItems(pl.Id);
              containsMap[pl.Id] = items.some((it: any) => it.Id === trackId);
            } catch {}
          })
        );
        setPlaylistContains(containsMap);
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

  const handleAddToPlaylist = async (playlistId: string) => {
    if (!playlistId) return;

    setAddingToPlaylist(playlistId);
    try {
      await addTrackToPlaylist(playlistId, trackId);
      setPlaylistContains((m) => ({ ...m, [playlistId]: true }));

      // If this is the favourite playlist and track not yet favourite, favourite it
      if (
        favoritePlaylistId &&
        playlistId === favoritePlaylistId &&
        !trackIsFavorite
      ) {
        try {
          const auth = JSON.parse(localStorage.getItem("authData") || "{}");
          if (auth.serverAddress && auth.accessToken) {
            await addToFavorites(auth.serverAddress, auth.accessToken, trackId);
            setTrackIsFavorite(true);
          }
        } catch {}
      }
      // Try to fetch updated playlist info from server
      try {
        const updated = await getPlaylistInfo(playlistId);
        if (updated) {
          // Update in-memory list so the dialog reflects the new count immediately
          setPlaylists((prev) =>
            prev.map((p) => (p.Id === playlistId ? { ...p, ...updated } : p))
          );

          // Update local DB cache so Playlists page (which uses hybrid data) shows correct ChildCount
          try {
            await localDb.initialize();
            await localDb.savePlaylists([updated]);
          } catch (cacheErr) {}
        }
      } catch (infoErr) {
        // Optimistic UI: bump count locally if we have one
        setPlaylists((prev) =>
          prev.map((p) =>
            p.Id === playlistId
              ? { ...p, ChildCount: (p.ChildCount || 0) + 1 }
              : p
          )
        );
      }

      // If playlist is marked as downloaded, auto-download this track
      try {
        if (await isCollectionDownloaded(playlistId)) {
          const auth = JSON.parse(localStorage.getItem("authData") || "{}");
          const url = `${auth.serverAddress}/Audio/${trackId}/stream?static=true&api_key=${auth.accessToken}`;
          await downloadTrack({ trackId, name: trackName, url });
        }
      } catch {}

      // Notify other views to refresh (Playlists page listens for this)
      try {
        window.dispatchEvent(new CustomEvent("syncUpdate"));
      } catch {}

      // Close dialog
      onOpenChange(false);
    } catch (error) {
      logger.error("Failed to add track to playlist:", error);
      // Show error feedback (you could add a toast here)
    } finally {
      setAddingToPlaylist(null);
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
                  className={`transition-colors cursor-pointer hover:bg-gray-50 ${trackIsFavorite ? "opacity-70" : ""}`}
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
                        <div className="w-full h-full bg-gradient-to-br from-pink-200 to-rose-200 flex items-center justify-center">
                          <Heart className="w-6 h-6 text-pink-600 fill-pink-600" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-gray-900 truncate flex items-center gap-2">
                          Favourites
                          {trackIsFavorite && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-gray-200 text-gray-700">
                              Added
                            </span>
                          )}
                        </h4>
                        <p className="text-sm text-gray-500">
                          Mark this track as favourite
                        </p>
                      </div>
                      {addingToPlaylist === "__favorites__" && (
                        <Loader2 className="w-4 h-4 animate-spin text-pink-600" />
                      )}
                    </div>
                  </CardContent>
                </Card>
                {playlists.map((playlist) => {
                  const isAdding = addingToPlaylist === playlist.Id;
                  const contains = playlistContains[playlist.Id || ""];
                  const isFavList = favoritePlaylistId === playlist.Id;

                  return (
                    <Card
                      key={playlist.Id}
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() =>
                        !isAdding && handleAddToPlaylist(playlist.Id!)
                      }
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
                              <div className="w-full h-full bg-gradient-to-br from-pink-200 to-rose-200 flex items-center justify-center">
                                <ListMusic className="w-6 h-6 text-pink-600" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-medium text-gray-900 truncate flex items-center gap-2">
                              {playlist.Name}
                              {isFavList && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-pink-100 text-pink-700 border border-pink-200">
                                  Fav
                                </span>
                              )}
                              {contains && (
                                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-200 text-gray-700">
                                  Added
                                </span>
                              )}
                            </h4>
                            <p className="text-sm text-gray-500">
                              {playlist.ChildCount || 0} tracks
                            </p>
                          </div>
                          {isAdding && (
                            <Loader2 className="w-4 h-4 animate-spin text-pink-600" />
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
              <ListMusic className="w-12 h-12 text-pink-400 mx-auto mb-3" />
              <h3 className="text-lg font-medium text-gray-900 mb-1">
                No playlists
              </h3>
              <p className="text-gray-500 text-sm">
                Create a playlist first to add tracks to it.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button
            variant="destructive"
            className="bg-red-500 hover:bg-red-600"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
