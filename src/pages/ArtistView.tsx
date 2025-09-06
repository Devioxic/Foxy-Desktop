import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import Sidebar from "@/components/Sidebar";
import TrackList from "@/components/TrackList";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import AlbumCard from "@/components/AlbumCard";
import MusicPlayer from "@/components/MusicPlayer";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { useAuthData } from "@/hooks/useAuthData";
import { formatDuration, getImageUrl } from "@/utils/media";
import { Play, Shuffle, User, Users } from "lucide-react";
import {
  getArtistInfo,
  getArtistAlbums,
  getArtistTracks,
  getAllTracksByArtist,
  findArtistByName,
} from "@/lib/jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import BackButton from "@/components/BackButton";
import { logger } from "@/lib/logger";

// Interfaces for artist data
interface ArtistInfo extends BaseItemDto {
  Overview?: string;
}

interface ArtistAlbum extends BaseItemDto {
  ProductionYear?: number;
}

interface ArtistTrack extends BaseItemDto {
  RunTimeTicks?: number;
}

const ArtistView = () => {
  const { artistId } = useParams<{ artistId: string }>();
  const navigate = useNavigate();
  const { playQueue, addToQueue, currentTrack, isPlaying } = useMusicPlayer();
  const { authData, isAuthenticated } = useAuthData();
  const [searchParams] = useSearchParams();

  const [artistInfo, setArtistInfo] = useState<ArtistInfo | null>(null);
  const [albums, setAlbums] = useState<ArtistAlbum[]>([]);
  const [tracks, setTracks] = useState<ArtistTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAllTracks, setShowAllTracks] = useState(false);
  const [showFullDescription, setShowFullDescription] = useState(false);
  const [showLyrics, setShowLyrics] = useState(false);

  // Generate a consistent color gradient based on artist name
  const getArtistGradient = (artistName?: string) => {
    if (!artistName) return "from-pink-200 to-rose-300";

    const gradients = [
      "from-pink-200 to-rose-300",
      "from-rose-200 to-pink-300",
      "from-pink-100 to-rose-200",
      "from-rose-100 to-pink-200",
      "from-pink-300 to-rose-400",
      "from-rose-300 to-pink-400",
      "from-pink-200 to-rose-400",
      "from-rose-200 to-pink-400",
    ];

    // Use character codes to get consistent gradient for same artist name
    const hash = artistName
      .split("")
      .reduce((acc, char) => acc + char.charCodeAt(0), 0);
    return gradients[hash % gradients.length];
  };

  const handleLyricsToggle = (show: boolean) => {
    setShowLyrics(show);
  };

  useEffect(() => {
    if (artistId) {
      loadArtistData();
    }
  }, [artistId]);

  const loadArtistData = async () => {
    setLoading(true);
    try {
      if (!isAuthenticated() || !artistId) {
        navigate("/login");
        return;
      }

      const [artistDetails, artistAlbums, artistTracks] = await Promise.all([
        getArtistInfo(artistId),
        getArtistAlbums(artistId),
        getArtistTracks(artistId),
      ]);

      setArtistInfo(artistDetails);
      setAlbums(artistAlbums);
      setTracks(artistTracks);
    } catch (error) {
      logger.error("Failed to load artist data", error);
    } finally {
      setLoading(false);
    }
  };

  const getArtistImage = (size: number = 300) => {
    return getImageUrl(artistInfo, authData.serverAddress!, size);
  };

  const getAlbumArt = (item: ArtistAlbum, size: number = 150) => {
    return getImageUrl(item, authData.serverAddress!, size, "/placeholder.svg");
  };

  const handlePlayAllTracks = async () => {
    if (!artistId) return;
    try {
      const all = await getAllTracksByArtist(artistId);
      if (all && all.length) {
        playQueue(all as any, 0);
      }
    } catch (e) {
      logger.error("Failed to play all tracks for artist", e);
    }
  };

  const handleShuffleAllTracks = async () => {
    if (!artistId) return;
    try {
      const all = await getAllTracksByArtist(artistId);
      if (all && all.length) {
        const shuffledTracks = [...all].sort(() => Math.random() - 0.5);
        playQueue(shuffledTracks as any, 0);
      }
    } catch (e) {
      logger.error("Failed to shuffle all tracks for artist", e);
    }
  };

  const handlePlayTrack = (index: number) => {
    playQueue(tracks as any, index);
  };

  const handleArtistClick = async (artistName: string) => {
    try {
      // Try to find the artist by name to get their ID
      const artist = await findArtistByName(artistName);
      if (artist?.Id) {
        navigate(`/artist/${artist.Id}`);
      } else {
        // Fallback: navigate with the name
        navigate(`/artist/${encodeURIComponent(artistName)}`);
      }
    } catch (error) {
      logger.error("Error finding artist:", error);
      // Fallback navigation
      navigate(`/artist/${encodeURIComponent(artistName)}`);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar activeSection="artists" />
        <div className="ml-64 p-6">
          <LoadingSkeleton type="artist" />
        </div>
        <MusicPlayer
          showLyrics={showLyrics}
          onLyricsToggle={handleLyricsToggle}
        />
      </div>
    );
  }

  if (!artistInfo) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar activeSection="artists" />
        <div className="ml-64 p-6">
          <div className="flex items-center justify-center h-96">
            <div className="text-center">
              <Users className="w-16 h-16 text-pink-400 mx-auto mb-4" />
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                Artist not found
              </h2>
              <p className="text-gray-600 mb-4">
                The artist you're looking for doesn't exist.
              </p>
              <Button onClick={() => navigate(-1)}>Go Back</Button>
            </div>
          </div>
        </div>
        <MusicPlayer
          showLyrics={showLyrics}
          onLyricsToggle={handleLyricsToggle}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar activeSection="artists" />
      <div className="ml-64 pb-28">
        <div className="max-w-none mx-auto p-6">
          {/* Back Button */}
          <BackButton />

          {/* Artist Info */}
          <div className="flex flex-col md:flex-row gap-8 mb-8">
            <div className="flex-shrink-0">
              <div className="w-64 h-64 rounded-full overflow-hidden bg-gradient-to-br from-pink-100 to-rose-200 shadow-lg">
                {getArtistImage() ? (
                  <img
                    src={getArtistImage()!}
                    alt={artistInfo.Name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div
                    className={`w-full h-full flex items-center justify-center bg-gradient-to-br ${getArtistGradient(
                      artistInfo.Name
                    )}`}
                  >
                    <User className="w-24 h-24 text-pink-600" />
                  </div>
                )}
              </div>
            </div>
            <div className="flex-1 space-y-4 self-center">
              <h2 className="text-5xl font-bold text-gray-900 mb-1">
                {artistInfo.Name}
              </h2>
              {artistInfo.Overview && (
                <div className="space-y-2">
                  <p className="text-gray-700 max-w-2xl">
                    {showFullDescription
                      ? artistInfo.Overview
                      : artistInfo.Overview.length > 200
                        ? artistInfo.Overview.substring(0, 200) + "..."
                        : artistInfo.Overview}
                  </p>
                  {artistInfo.Overview.length > 200 && (
                    <button
                      onClick={() =>
                        setShowFullDescription(!showFullDescription)
                      }
                      className="text-pink-600 hover:text-pink-700 text-sm font-medium transition-colors"
                    >
                      {showFullDescription ? "Show less" : "Show more"}
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center space-x-4 pt-4">
                <Button
                  onClick={handlePlayAllTracks}
                  className="bg-pink-600 hover:bg-pink-700 px-8"
                >
                  <Play className="w-5 h-5 mr-2" />
                  Play
                </Button>
                <Button
                  variant="outline"
                  onClick={handleShuffleAllTracks}
                  className="px-6"
                >
                  <Shuffle className="w-5 h-5 mr-2" />
                  Shuffle
                </Button>
              </div>
            </div>
          </div>

          {/* Top Tracks - Hidden when lyrics are open */}
          {!showLyrics && (
            <div className="mb-12">
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                Popular Tracks
              </h3>
              <TrackList
                tracks={tracks}
                currentTrack={currentTrack}
                isPlaying={isPlaying}
                onTrackPlay={handlePlayTrack}
                onArtistClick={handleArtistClick}
                showMoreButton={true}
                showAll={showAllTracks}
                onShowMoreToggle={() => setShowAllTracks(!showAllTracks)}
                maxInitialTracks={5}
                formatDuration={formatDuration}
                usePlaylistIndex={true}
              />
            </div>
          )}

          {/* Albums - Hidden when lyrics are open */}
          {!showLyrics && (
            <div>
              <h3 className="text-xl font-semibold text-gray-900 mb-4">
                Albums
              </h3>
              <div className="flex flex-wrap justify-start gap-6">
                {albums.map((album) => (
                  <AlbumCard
                    key={album.Id}
                    item={album}
                    authData={authData}
                    showYear
                    appendQuery={
                      searchParams.get("q")
                        ? `q=${encodeURIComponent(searchParams.get("q") || "")}`
                        : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <MusicPlayer
        showLyrics={showLyrics}
        onLyricsToggle={handleLyricsToggle}
      />
    </div>
  );
};

export default ArtistView;
