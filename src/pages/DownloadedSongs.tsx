import React, { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import { Button } from "@/components/ui/button";
import { Play, Shuffle, Plus, Music as MusicIcon } from "lucide-react";
import { localDb } from "@/lib/database";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { useAuthData } from "@/hooks/useAuthData";
import {
  addToFavorites,
  removeFromFavorites,
  checkIsFavorite,
} from "@/lib/jellyfin";
import { logger } from "@/lib/logger";
import TrackList from "@/components/TrackList";
import BackButton from "@/components/BackButton";
import { showError } from "@/utils/toast";
import { formatDuration } from "@/utils/media";
import { APP_EVENTS, FavoriteStateChangedDetail } from "@/constants/events";

const DownloadedSongs: React.FC = () => {
  const [items, setItems] = useState<any[]>([]);
  const [tracks, setTracks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const { playQueue, addToQueue, currentTrack, isPlaying } = useMusicPlayer();
  const { authData, isAuthenticated } = useAuthData();
  const [trackFavorites, setTrackFavorites] = useState<Record<string, boolean>>(
    {}
  );
  const [favoriteLoading, setFavoriteLoading] = useState<
    Record<string, boolean>
  >({});

  const initialLoadRef = useRef(false);
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

        // Load favorite status if authenticated
        if (isAuthenticated() && enriched.length > 0) {
          try {
            const favPairs = await Promise.all(
              enriched.map(async (t: any) => {
                if (!t.Id) return null;
                try {
                  const fav = await checkIsFavorite(
                    authData.serverAddress,
                    authData.accessToken,
                    t.Id
                  );
                  return [t.Id, fav] as const;
                } catch (err) {
                  return [t.Id, false] as const;
                }
              })
            );
            const map: Record<string, boolean> = {};
            for (const p of favPairs) if (p) map[p[0]] = p[1];
            setTrackFavorites(map);
          } catch (err) {
            logger.warn("Failed loading favorite statuses for downloads", err);
          }
        }
      } finally {
        setLoading(false);
      }
    };
    if (!initialLoadRef.current) {
      initialLoadRef.current = true;
      load();
    }
    const onUpdate = () => load();
    window.addEventListener("downloadsUpdate", onUpdate);
    return () => window.removeEventListener("downloadsUpdate", onUpdate);
  }, [authData.accessToken, authData.serverAddress, isAuthenticated]);

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

  const toggleTrackFavorite = async (trackId: string) => {
    if (!isAuthenticated()) return; // silently ignore offline
    setFavoriteLoading((m) => ({ ...m, [trackId]: true }));
    try {
      const isFav = trackFavorites[trackId];
      if (isFav) {
        await removeFromFavorites(
          authData.serverAddress,
          authData.accessToken,
          trackId
        );
      } else {
        await addToFavorites(
          authData.serverAddress,
          authData.accessToken,
          trackId
        );
      }
      setTrackFavorites((m) => ({ ...m, [trackId]: !isFav }));
    } catch (err) {
      showError("Failed to toggle favourite");
    } finally {
      setFavoriteLoading((m) => ({ ...m, [trackId]: false }));
    }
  };
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
      <div className="min-h-screen bg-background">
        <Sidebar activeSection="downloads" />
        <div className="ml-64 p-6">Loading downloads…</div>
        <MusicPlayer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar activeSection="downloads" />
      <div className="ml-64 p-6 pb-28">
        {/* Header */}
        <BackButton />
        <div className="flex gap-8 mb-8 mt-2">
          <div className="flex-shrink-0">
            <div className="w-40 h-40 md:w-64 md:h-64 rounded-lg shadow-lg overflow-hidden">
              <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-primary/20 to-primary/30">
                <MusicIcon className="w-16 h-16 text-primary" />
              </div>
            </div>
          </div>
          <div className="flex-1 space-y-4">
            <div>
              <h1 className="text-4xl font-bold text-foreground mb-2 leading-tight">
                Downloaded Songs
              </h1>
              <p className="text-muted-foreground text-sm">
                Your offline tracks, ready to play anytime
              </p>
            </div>
            <div className="flex items-center gap-4 text-sm text-muted-foreground">
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
          <p className="text-muted-foreground">No downloaded songs yet.</p>
        ) : (
          <div className="bg-card rounded-xl shadow-sm border border-border">
            <div className="p-4">
              <h3 className="text-base font-semibold text-card-foreground mb-3">
                Tracks
              </h3>
              <TrackList
                tracks={tracks}
                currentTrack={currentTrack as any}
                isPlaying={isPlaying}
                onTrackPlay={(index) => playQueue(tracks as any[], index)}
                showNumbers
                showArtistFromTrack
                albumArtist={undefined}
                trackFavorites={trackFavorites}
                favoriteLoading={favoriteLoading}
                onToggleTrackFavorite={toggleTrackFavorite}
                formatDuration={formatDuration}
                usePlaylistIndex
                assumeAllDownloaded
              />
            </div>
          </div>
        )}
      </div>
      <MusicPlayer />
    </div>
  );
};

export default DownloadedSongs;
