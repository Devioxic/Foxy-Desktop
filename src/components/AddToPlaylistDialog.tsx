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
import { addTrackToPlaylist, getPlaylistInfo } from "@/lib/jellyfin";
import { localDb } from "@/lib/database";
import { hybridData } from "@/lib/sync";
import { ListMusic, Plus, Loader2 } from "lucide-react";
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
    } catch (error) {
      console.error("Failed to load playlists:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    if (!playlistId) return;

    setAddingToPlaylist(playlistId);
    try {
      await addTrackToPlaylist(playlistId, trackId);
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
          } catch (cacheErr) {
            console.warn("Failed to update local cache for playlist", cacheErr);
          }
        }
      } catch (infoErr) {
        console.warn("Failed to fetch updated playlist info", infoErr);
        // Optimistic UI: bump count locally if we have one
        setPlaylists((prev) =>
          prev.map((p) =>
            p.Id === playlistId
              ? { ...p, ChildCount: (p.ChildCount || 0) + 1 }
              : p
          )
        );
      }

      // Notify other views to refresh (Playlists page listens for this)
      try {
        window.dispatchEvent(new CustomEvent("syncUpdate"));
      } catch {}

      // Close dialog
      onOpenChange(false);
    } catch (error) {
      console.error("Failed to add track to playlist:", error);
      // Show error feedback (you could add a toast here)
    } finally {
      setAddingToPlaylist(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add to Playlist</DialogTitle>
          <DialogDescription>
            {trackName
              ? `Add "${trackName}" to a playlist`
              : "Add track to a playlist"}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
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
                {playlists.map((playlist) => {
                  const isAdding = addingToPlaylist === playlist.Id;

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
                            <h4 className="font-medium text-gray-900 truncate">
                              {playlist.Name}
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

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
