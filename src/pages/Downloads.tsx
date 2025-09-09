import React, { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import { localDb } from "@/lib/database";
import { useNavigate } from "react-router-dom";
import AlbumCard from "@/components/AlbumCard";
import PlaylistCard from "@/components/PlaylistCard";
import { useAuthData } from "@/hooks/useAuthData";

interface DownloadRow {
  track_id: string;
  file_rel_path: string;
  container?: string;
  bitrate?: number;
  size_bytes?: number;
}

const Downloads: React.FC = () => {
  const [rows, setRows] = useState<DownloadRow[]>([]);
  const [collections, setCollections] = useState<
    Array<{ id: string; type: string; name?: string }>
  >([]);
  const [albumItems, setAlbumItems] = useState<any[]>([]);
  const [playlistItems, setPlaylistItems] = useState<any[]>([]);
  const [showLyrics, setShowLyrics] = useState(false);
  const navigate = useNavigate();
  const { authData } = useAuthData();

  useEffect(() => {
    const load = async () => {
      await localDb.initialize();
      const all = await localDb.getAllDownloads();
      setRows(all as any);
      const cols = await localDb.getDownloadedCollections();
      setCollections(cols);
      // Load album/playlist metadata for card components
      const explicitAlbumIds = cols
        .filter((c) => c.type === "album")
        .map((c) => c.id);
      // Also infer albums from cached tracks if not explicitly marked
      let inferredAlbumIds: string[] = [];
      try {
        inferredAlbumIds = await localDb.getAlbumIdsWithCachedTracks();
      } catch {}
      const albumIds = Array.from(
        new Set([...(explicitAlbumIds as any), ...(inferredAlbumIds as any)])
      );
      const playlistIds = cols
        .filter((c) => c.type === "playlist")
        .map((c) => c.id);
      const albums: any[] = [];
      const playlists: any[] = [];
      for (const id of albumIds) {
        try {
          const a = await localDb.getAlbumById(id);
          if (a) albums.push(a);
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
        playlists.push({ Id: "favourites", Name: "Favourites" });
      }
      setAlbumItems(albums);
      setPlaylistItems(playlists);
    };

    load();
    const onUpdate = () => load();
    window.addEventListener("downloadsUpdate", onUpdate);
    return () => window.removeEventListener("downloadsUpdate", onUpdate);
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
