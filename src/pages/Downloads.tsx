import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import { localDb } from "@/lib/database";
import AlbumCard from "@/components/AlbumCard";
import PlaylistCard from "@/components/PlaylistCard";
import { useAuthData } from "@/hooks/useAuthData";
import type { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";

type DownloadedAlbum = BaseItemDto & { DownloadedTrackCount?: number };

const Downloads: React.FC = () => {
  const [albumItems, setAlbumItems] = useState<DownloadedAlbum[]>([]);
  const [playlistItems, setPlaylistItems] = useState<BaseItemDto[]>([]);
  const [showLyrics, setShowLyrics] = useState(false);
  const { authData } = useAuthData();

  useEffect(() => {
    const load = async () => {
      await localDb.initialize();
      const cols = await localDb.getDownloadedCollections();
      // Load album/playlist metadata for card components
      const albumCompletionMap = new Map<string, number>();
      try {
        const coverage = await localDb.getDownloadedTrackCountsByAlbum();
        coverage.forEach(({ albumId, downloaded }) => {
          if (albumId) {
            albumCompletionMap.set(albumId, Number(downloaded) || 0);
          }
        });
      } catch {}

      const explicitAlbumIds = cols
        .filter((c) => c.type === "album")
        .map((c) => c.id);
      const inferredAlbumIds: string[] = [];
      try {
        const inferred = await localDb.getAlbumIdsWithCachedTracks();
        inferredAlbumIds.push(...inferred);
      } catch {}
      const albumIds = Array.from(
        new Set<string>([...explicitAlbumIds, ...inferredAlbumIds])
      );
      const playlistIds = cols
        .filter((c) => c.type === "playlist")
        .map((c) => c.id);
      const albums: DownloadedAlbum[] = [];
      const playlists: BaseItemDto[] = [];
      for (const id of albumIds) {
        try {
          const a = await localDb.getAlbumById(id);
          if (!a) continue;
          const expectedRaw = Number((a as any).ChildCount ?? 0);
          const expected = Number.isFinite(expectedRaw) ? expectedRaw : 0;
          const downloadedCount = albumCompletionMap.get(id) ?? 0;
          const isExplicit = explicitAlbumIds.includes(id);
          const fullyDownloaded =
            expected > 0
              ? downloadedCount >= expected
              : isExplicit && downloadedCount > 0;
          if (fullyDownloaded) {
            albums.push({
              ...a,
              DownloadedTrackCount: downloadedCount,
            } as DownloadedAlbum);
          }
        } catch {}
      }
      for (const id of playlistIds) {
        try {
          const p = await localDb.getPlaylistById(id);
          if (p) playlists.push(p);
        } catch {}
      }
      // If favourites is downloaded, include a synthetic playlist card
      if (
        playlistIds.includes("favourites") &&
        !playlists.find((p) => p?.Id === "favourites")
      ) {
        playlists.push({ Id: "favourites", Name: "Favourites" } as BaseItemDto);
      }
      setAlbumItems(albums);
      setPlaylistItems(playlists);
    };

    load();
    const onUpdate = () => load();
    window.addEventListener("downloadsUpdate", onUpdate);
    window.addEventListener("playlistItemsUpdated", onUpdate as EventListener);
    window.addEventListener("playlistItemRemoved", onUpdate as EventListener);
    return () => {
      window.removeEventListener("downloadsUpdate", onUpdate);
      window.removeEventListener(
        "playlistItemsUpdated",
        onUpdate as EventListener
      );
      window.removeEventListener(
        "playlistItemRemoved",
        onUpdate as EventListener
      );
    };
  }, []);

  // No per-track list here: downloaded tracks live under
  // "/downloads/songs". This page focuses on downloaded collections.

  return (
    <div className="min-h-screen bg-background">
      <Sidebar activeSection="downloads" />
      <div className="ml-64 p-6 pb-28">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold text-foreground">Downloads</h1>
        </div>

        {/* Downloaded Albums */}
        {albumItems.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Downloaded Albums
            </h2>
            <div className="flex flex-wrap justify-start gap-4">
              {albumItems.map((album) => (
                <AlbumCard
                  key={album.Id}
                  item={album}
                  authData={authData}
                  showYear
                />
              ))}
            </div>
          </div>
        )}

        {/* Downloaded Playlists */}
        {playlistItems.length > 0 && (
          <div className="mb-10">
            <h2 className="text-xl font-semibold text-foreground mb-4">
              Downloaded Playlists
            </h2>
            <div className="flex flex-wrap justify-start gap-4">
              {playlistItems.map((pl) => (
                <PlaylistCard key={pl.Id} item={pl} authData={authData} />
              ))}
            </div>
          </div>
        )}

        {albumItems.length === 0 && playlistItems.length === 0 ? (
          <p className="text-muted-foreground">
            No downloaded albums or playlists yet.
          </p>
        ) : null}
      </div>
      <MusicPlayer showLyrics={showLyrics} onLyricsToggle={setShowLyrics} />
    </div>
  );
};

export default Downloads;
