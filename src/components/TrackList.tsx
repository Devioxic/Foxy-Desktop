import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import IconDropdown from "@/components/IconDropdown";
import AddToPlaylistDialog from "@/components/AddToPlaylistDialog";
import LyricsComponent from "@/components/LyricsComponent";
import { useMusicPlayer } from "@/contexts/MusicContext";
import {
  Play,
  Star,
  Plus,
  ListPlus,
  Loader2,
  FileText,
  Download,
} from "lucide-react";
import { findArtistByName } from "@/lib/jellyfin";
import {
  downloadTrack,
  removeDownload,
  getLocalUrlForTrack,
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
  }) => {
    const navigate = useNavigate();
    const { queue, playNow, addToQueue } = useMusicPlayer();
    const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
    const [showLyrics, setShowLyrics] = useState(false);
    const [selectedTrackForPlaylist, setSelectedTrackForPlaylist] = useState<{
      id: string;
      name: string;
    } | null>(null);
    const [downloadedMap, setDownloadedMap] = useState<Record<string, boolean>>(
      {}
    );
    const [dlLoading, setDlLoading] = useState<Record<string, boolean>>({});

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
      MediaSources: track.MediaSources || [],
    });

    const displayTracks = useMemo(() => {
      return showMoreButton && !showAll
        ? tracks.slice(0, maxInitialTracks)
        : tracks;
    }, [tracks, showMoreButton, showAll, maxInitialTracks]);

    // Probe which tracks are downloaded
    useEffect(() => {
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
          const map: Record<string, boolean> = {};
          for (const p of pairs) {
            if (p && p[0]) map[p[0]] = p[1];
          }
          if (!cancelled) setDownloadedMap(map);
        } catch {}
      })();
      return () => {
        cancelled = true;
      };
    }, [tracks]);

    return (
      <>
        <div className="space-y-1">
          {displayTracks.map((track, index) => (
            <div
              key={track.Id}
              className={`group flex items-center px-3 py-2 rounded-md hover:bg-gray-100 cursor-pointer transition-colors ${
                isCurrentTrack(track.Id) ? "bg-pink-50" : ""
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
                      <span className="text-xs text-gray-500 group-hover:hidden">
                        {usePlaylistIndex
                          ? index + 1
                          : track.IndexNumber || index + 1}
                      </span>
                    )}
                    <Play className="w-3 h-3 text-gray-600 hidden group-hover:block" />
                  </>
                )}
              </div>

              {/* Track Info */}
              <div className="flex-1 min-w-0 px-3">
                <div className="flex items-center gap-2">
                  <h4
                    className={`text-sm font-medium truncate ${
                      isCurrentTrack(track.Id)
                        ? "text-pink-600"
                        : "text-gray-900"
                    }`}
                  >
                    {track.Name}
                  </h4>
                  {trackFavorites[track.Id || ""] && (
                    <Star className="w-3 h-3 text-pink-600 fill-pink-600 flex-shrink-0" />
                  )}
                </div>
                <p className="text-xs text-gray-600 truncate">
                  <button
                    className="hover:text-pink-600 hover:underline transition-colors"
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

              {/* Inline actions: favourite + download (left of duration) */}
              <div className="w-16 flex items-center justify-end gap-1 pr-1">
                {onToggleTrackFavorite && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="p-1 h-6 w-6 text-gray-500 hover:text-pink-600 hover:bg-gray-100"
                    title={
                      trackFavorites[track.Id || ""]
                        ? "Remove from favourites"
                        : "Add to favourites"
                    }
                    onClick={(e) => {
                      e.stopPropagation();
                      if (track.Id) onToggleTrackFavorite(track.Id);
                    }}
                    disabled={!!favoriteLoading[track.Id || ""]}
                  >
                    {favoriteLoading[track.Id || ""] ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                    ) : (
                      <Star
                        className={`w-3.5 h-3.5 ${
                          trackFavorites[track.Id || ""]
                            ? "text-pink-600 fill-pink-600"
                            : "text-gray-500"
                        }`}
                      />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="p-1 h-6 w-6 text-gray-500 hover:text-pink-600 hover:bg-gray-100"
                  title={
                    downloadedMap[track.Id || ""]
                      ? "Remove download"
                      : "Download"
                  }
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!track.Id) return;
                    setDlLoading((m) => ({ ...m, [track.Id!]: true }));
                    try {
                      const has =
                        downloadedMap[track.Id] ||
                        !!(await getLocalUrlForTrack(track.Id));
                      if (has) {
                        await removeDownload(track.Id);
                        setDownloadedMap((m) => ({ ...m, [track.Id!]: false }));
                      } else {
                        const ms = (track as any).MediaSources?.[0];
                        let url: string | undefined =
                          ms?.DirectStreamUrl || ms?.TranscodingUrl;
                        // Ensure absolute URL with api_key
                        try {
                          const auth = JSON.parse(
                            localStorage.getItem("authData") || "{}"
                          );
                          const server = auth?.serverAddress;
                          const token = auth?.accessToken;
                          if (!url) {
                            if (server && token) {
                              url = `${server}/Audio/${track.Id}/stream?static=true&api_key=${token}`;
                            }
                          } else if (
                            url &&
                            server &&
                            token &&
                            url.startsWith("/")
                          ) {
                            url = `${server}${url}${url.includes("?") ? `&api_key=${token}` : `?api_key=${token}`}`;
                          }
                        } catch {}
                        if (!url) return;
                        await downloadTrack({
                          trackId: track.Id,
                          name: track.Name,
                          url,
                          container: ms?.Container,
                          bitrate: ms?.Bitrate,
                        });
                        setDownloadedMap((m) => ({ ...m, [track.Id!]: true }));
                      }
                    } finally {
                      setDlLoading((m) => ({ ...m, [track.Id!]: false }));
                      // Notify others UI might want to refresh
                      try {
                        window.dispatchEvent(
                          new CustomEvent("downloadsUpdate")
                        );
                      } catch {}
                    }
                  }}
                >
                  {dlLoading[track.Id || ""] ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />
                  ) : (
                    <Download
                      className={`w-3.5 h-3.5 ${
                        downloadedMap[track.Id || ""]
                          ? "text-pink-600"
                          : "text-gray-500"
                      }`}
                    />
                  )}
                </Button>
              </div>

              {/* Duration */}
              <div className="w-14 text-right">
                <span className="text-xs text-gray-500">
                  {formatDuration(track.RunTimeTicks)}
                </span>
              </div>

              {/* Track Options Menu */}
              <div className="w-8 flex justify-center opacity-0 group-hover:opacity-100">
                <IconDropdown
                  size="xs"
                  align="end"
                  tooltip="More actions"
                  menuWidthClass="w-52"
                >
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      if (track.Id) {
                        if (queue.length === 0) {
                          // If queue is empty, start playing this track
                          playNow(convertToMusicTrack(track));
                        } else {
                          // If queue has items, just add this track to the end
                          addToQueue(convertToMusicTrack(track));
                        }
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <Plus className="w-3 h-3 mr-2" />
                    <span className="text-xs">Add to Queue</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      if (track.Id && track.Name) {
                        setSelectedTrackForPlaylist({
                          id: track.Id,
                          name: track.Name,
                        });
                        setShowAddToPlaylist(true);
                      }
                    }}
                    className="cursor-pointer"
                  >
                    <ListPlus className="w-3 h-3 mr-2" />
                    <span className="text-xs">Add to Playlist</span>
                  </DropdownMenuItem>
                  {onToggleTrackFavorite && (
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        if (track.Id) {
                          onToggleTrackFavorite(track.Id);
                        }
                      }}
                      className="cursor-pointer"
                    >
                      {favoriteLoading[track.Id || ""] ? (
                        <Loader2 className="w-3 h-3 mr-2 animate-spin text-gray-400" />
                      ) : (
                        <Star
                          className={`w-3 h-3 mr-2 ${
                            trackFavorites[track.Id || ""]
                              ? "text-pink-600 fill-pink-600"
                              : "text-gray-400"
                          }`}
                        />
                      )}
                      <span className="text-xs">
                        {trackFavorites[track.Id || ""]
                          ? "Remove from Favourites"
                          : "Add to Favourites"}
                      </span>
                    </DropdownMenuItem>
                  )}
                </IconDropdown>
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
