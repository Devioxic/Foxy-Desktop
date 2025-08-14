import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AddToPlaylistDialog from "@/components/AddToPlaylistDialog";
import LyricsComponent from "@/components/LyricsComponent";
import { useMusicPlayer } from "@/contexts/MusicContext";
import {
  Play,
  Star,
  MoreVertical,
  Plus,
  ListPlus,
  Loader2,
  FileText,
} from "lucide-react";
import { findArtistByName } from "@/lib/jellyfin";
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

              {/* Duration */}
              <div className="w-14 text-right">
                <span className="text-xs text-gray-500">
                  {formatDuration(track.RunTimeTicks)}
                </span>
              </div>

              {/* Track Options Menu */}
              <div className="w-8 flex justify-center opacity-0 group-hover:opacity-100">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="p-0.5 h-6"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="w-3 h-3" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-48"
                    sideOffset={5}
                  >
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
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
                      onClick={(e) => {
                        e.stopPropagation();
                      }}
                      className="cursor-pointer"
                    >
                      <Plus className="w-3 h-3 mr-2" />
                      <span className="text-xs">Add to Queue</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => e.preventDefault()}
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
                        onSelect={(e) => e.preventDefault()}
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
                  </DropdownMenuContent>
                </DropdownMenu>
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
