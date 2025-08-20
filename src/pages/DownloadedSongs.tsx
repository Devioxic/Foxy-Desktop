import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import { Button } from "@/components/ui/button";
import { Play, Shuffle, Plus, Music as MusicIcon } from "lucide-react";
import { localDb } from "@/lib/database";
import { useMusicPlayer } from "@/contexts/MusicContext";
import TrackList from "@/components/TrackList";
import BackButton from "@/components/BackButton";
import { showError } from "@/utils/toast";
import { formatDuration } from "@/utils/media";

const DownloadedSongs: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { playQueue, addToQueue } = useMusicPlayer();

  useEffect(() => {
    const load = async () => {
      try {
        await localDb.initialize();
        const all = await localDb.getAllDownloads();
        setItems(all);
        // Enrich with local metadata when available
        const ids = all.map((d: any) => d.track_id);
        const meta = await localDb.getTracksByIds(ids);
        // Merge download info into track objects and map DirectStreamUrl to local file URL
        const byId: Record<string, any> = {};
        for (const t of meta) byId[t.Id] = t;
        const enriched = ids
          .map((id: string) => {
            const d = all.find((x: any) => x.track_id === id);
            const t = byId[id] || { Id: id, Name: d?.track_id };
            return {
              ...t,
              MediaSources: [
                {
                  Path: d?.file_rel_path,
                  DirectStreamUrl: d?.file_rel_path,
                  Container: d?.container,
                  Bitrate: d?.bitrate,
                  IsDirectStream: true,
                },
              ],
            };
          })
          .filter(Boolean);
        setTracks(enriched);
      } finally {
        setLoading(false);
      }
    };
    load();
    const onUpdate = () => load();
    window.addEventListener("downloadsUpdate", onUpdate);
    return () => window.removeEventListener("downloadsUpdate", onUpdate);
  }, []);
  const handlePlayAll = () => {
    if (tracks.length > 0) playQueue(tracks as any[], 0);
  };

  const handleShuffleAll = () => {
    if (tracks.length > 0) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5);
      playQueue(shuffled as any[], 0);
    }
  };

  const handleAddAll = () => {
    tracks.forEach((t) => addToQueue(t as any));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar activeSection="downloads" />
        <div className="ml-64 p-6">Loading downloads…</div>
        <MusicPlayer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar activeSection="downloads" />
      <div className="ml-64 p-6 pb-28">
        {/* Header */}
        <BackButton />
        <div className="flex gap-8 mb-8 mt-2">
          <div className="flex-shrink-0">
            <div className="w-40 h-40 md:w-64 md:h-64 rounded-lg shadow-lg overflow-hidden">
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-200 to-rose-200">
                <MusicIcon className="w-16 h-16 text-pink-600" />
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2 leading-tight">
                Downloaded Songs
              </h1>
              <p className="text-gray-600 text-sm">
                Your offline tracks, ready to play anytime
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm text-gray-600">
              <span>{tracks.length} tracks</span>
              <span>•</span>
              <span>
                {formatDuration(
                  tracks.reduce((sum, t) => sum + (t.RunTimeTicks || 0), 0)
                )}
              </span>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Button onClick={handlePlayAll} disabled={tracks.length === 0}>
                <Play className="w-4 h-4 mr-2" /> Play
              </Button>
              <Button
                variant="outline"
                onClick={handleShuffleAll}
                disabled={tracks.length === 0}
              >
                <Shuffle className="w-4 h-4 mr-2" /> Shuffle
              </Button>
              <Button
                variant="ghost"
                onClick={handleAddAll}
                disabled={tracks.length === 0}
              >
                <Plus className="w-4 h-4 mr-2" /> Add all to queue
              </Button>
            </div>
          </div>
        </div>

        {tracks.length === 0 ? (
          <p className="text-gray-600">No downloaded songs yet.</p>
        ) : (
          <TrackList
            tracks={tracks}
            currentTrack={null}
            isPlaying={false}
            onTrackPlay={(index) => playQueue(tracks as any[], index)}
            showNumbers
            showArtistFromTrack
            albumArtist={undefined}
            trackFavorites={{}}
            favoriteLoading={{}}
            onToggleTrackFavorite={() => {}}
            formatDuration={formatDuration}
            usePlaylistIndex
          />
        )}
      </div>
      <MusicPlayer />
    </div>
  );
};

export default DownloadedSongs;
