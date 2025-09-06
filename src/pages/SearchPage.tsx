import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
//
import { logger } from "@/lib/logger";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import SearchBar from "@/components/SearchBar";
import AlbumCard from "@/components/AlbumCard";
import PlaylistCard from "@/components/PlaylistCard";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import TrackList from "@/components/TrackList";
import BlurHashImage from "@/components/BlurHashImage";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { Music, User, Disc3, ListMusic } from "lucide-react";
import { searchWithRelatedContent, findArtistByName } from "@/lib/jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client";
import { formatDuration } from "@/utils/media";

const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { playQueue, currentTrack, isPlaying } = useMusicPlayer();
  const [results, setResults] = useState<{
    songs: BaseItemDto[];
    artists: BaseItemDto[];
    albums: BaseItemDto[];
    playlists: BaseItemDto[];
  }>({
    songs: [],
    artists: [],
    albums: [],
    playlists: [],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [authData] = useState(() =>
    JSON.parse(localStorage.getItem("authData") || "{}")
  );
  const [showAllSongs, setShowAllSongs] = useState(false);
  const [showAllArtists, setShowAllArtists] = useState(false);
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [showAllPlaylists, setShowAllPlaylists] = useState(false);

  const query = searchParams.get("q") || "";

  useEffect(() => {
    if (query) {
      handleSearch(query);
    }
  }, [query]);

  const handleSearch = async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setResults({ songs: [], artists: [], albums: [], playlists: [] });
      setHasSearched(false);
      return;
    }

    setIsLoading(true);
    setHasSearched(true);

    try {
      const searchResults = await searchWithRelatedContent(searchTerm);

      const categorized = {
        songs: searchResults.filter((item) => item.Type === "Audio"),
        artists: searchResults.filter((item) => item.Type === "MusicArtist"),
        albums: searchResults.filter((item) => item.Type === "MusicAlbum"),
        playlists: searchResults.filter((item) => item.Type === "Playlist"),
      };

      setResults(categorized);
    } catch (error) {
      logger.error("Search failed:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleArtistClick = async (artistName: string, artistId?: string) => {
    if (artistId) {
      navigate(`/artist/${artistId}?q=${encodeURIComponent(query)}`);
      return;
    }

    const artist = await findArtistByName(artistName);
    if (artist?.Id) {
      navigate(`/artist/${artist.Id}?q=${encodeURIComponent(query)}`);
    } else {
      navigate(
        `/artist/${encodeURIComponent(artistName)}?q=${encodeURIComponent(
          query
        )}`
      );
    }
  };

  const handleArtistByName = async (artistName: string) => {
    await handleArtistClick(artistName);
  };

  const handlePlaySongAtIndex = (index: number) => {
    // Play from the selected song within the current search results
    playQueue((results.songs as any[]) || [], index);
  };

  //

  const totalResults =
    results.songs.length +
    results.artists.length +
    results.albums.length +
    results.playlists.length;

  // Helpers for artist visuals (match Artists page style)
  const getArtistImage = (artist: BaseItemDto, size: number = 150) => {
    const item = artist as any;
    if (authData.serverAddress && item?.ImageTags?.Primary && artist.Id) {
      return `${authData.serverAddress}/Items/${artist.Id}/Images/Primary?maxWidth=${size}&quality=90`;
    }
    return null;
  };

  const getArtistBlurHash = (artist: BaseItemDto) => {
    const item = artist as any;
    const primaryTag = item?.ImageTags?.Primary;
    return primaryTag
      ? item?.ImageBlurHashes?.Primary?.[primaryTag]
      : undefined;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar activeSection="search" />

      {/* Main Content */}
      <div className="ml-64">
        {/* Top Bar */}
        <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-gray-200">
          <div className="max-w-none mx-auto flex items-center justify-center p-6">
            <div className="flex-1 max-w-2xl">
              <SearchBar placeholder="Search entire library..." />
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="max-w-none mx-auto p-6 pb-28">
          {!hasSearched && (
            <div className="text-center py-12">
              <Music className="w-16 h-16 text-gray-400 mx-auto mb-4" />
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Search for music
              </h2>
              <p className="text-gray-600">
                Find songs, artists, albums, and playlists
              </p>
            </div>
          )}

          {isLoading && <LoadingSkeleton type="library" />}

          {hasSearched && !isLoading && (
            <>
              {totalResults > 0 ? (
                <div className="space-y-8">
                  {/* Search Results Header */}
                  <div className="mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">
                      Search results for "{query}"
                    </h1>
                    <p className="text-gray-600 mt-1">
                      {totalResults} result{totalResults !== 1 ? "s" : ""} found
                    </p>
                  </div>
                  {/* Artists Section (first) */}
                  {results.artists.length > 0 && (
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900 flex items-center">
                          <User className="w-5 h-5 mr-2" />
                          Artists ({results.artists.length})
                        </h2>
                        {results.artists.length > 12 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-pink-600 hover:text-pink-700"
                            onClick={() => setShowAllArtists((v) => !v)}
                          >
                            {showAllArtists ? "See less" : "See all"}
                          </Button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {(showAllArtists
                          ? results.artists
                          : results.artists.slice(0, 12)
                        ).map((artist) => (
                          <div
                            key={artist.Id}
                            className="group cursor-pointer transition-all duration-200"
                            onClick={() =>
                              handleArtistClick(artist.Name || "", artist.Id)
                            }
                          >
                            <div className="aspect-square mb-3 rounded-full overflow-hidden bg-gradient-to-br from-pink-100 to-rose-200 shadow-sm hover:shadow-md transition-shadow">
                              {getArtistImage(artist) ? (
                                <BlurHashImage
                                  src={getArtistImage(artist)!}
                                  blurHash={getArtistBlurHash(artist)}
                                  alt={artist.Name || "Artist"}
                                  className="w-full h-full group-hover:scale-105 transition-transform duration-200"
                                  width={150}
                                  height={150}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-pink-200 to-rose-300">
                                  <User className="w-8 h-8 text-pink-600" />
                                </div>
                              )}
                            </div>
                            <div className="text-center">
                              <h3 className="text-sm font-medium text-gray-900 truncate mb-1 group-hover:text-pink-600 transition-colors">
                                {artist.Name}
                              </h3>
                              <p className="text-xs text-gray-500">Artist</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Albums Section (second) */}
                  {results.albums.length > 0 && (
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900 flex items-center">
                          <Disc3 className="w-5 h-5 mr-2" />
                          Albums ({results.albums.length})
                        </h2>
                        {results.albums.length > 12 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-pink-600 hover:text-pink-700"
                            onClick={() => setShowAllAlbums((v) => !v)}
                          >
                            {showAllAlbums ? "See less" : "See all"}
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap justify-start gap-6">
                        {(showAllAlbums
                          ? results.albums
                          : results.albums.slice(0, 12)
                        ).map((album) => (
                          <AlbumCard
                            key={album.Id}
                            item={album}
                            authData={authData}
                            appendQuery={`q=${encodeURIComponent(query)}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Songs Section (third) */}
                  {results.songs.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                        <Music className="w-5 h-5 mr-2" />
                        Songs ({results.songs.length})
                      </h2>
                      <TrackList
                        tracks={results.songs as any}
                        currentTrack={currentTrack as any}
                        isPlaying={isPlaying}
                        onTrackPlay={handlePlaySongAtIndex}
                        onArtistClick={handleArtistByName}
                        showMoreButton={results.songs.length > 10}
                        maxInitialTracks={10}
                        showAll={showAllSongs}
                        onShowMoreToggle={() => setShowAllSongs((v) => !v)}
                        showNumbers={true}
                        showArtistFromTrack={true}
                        formatDuration={formatDuration}
                        usePlaylistIndex={true}
                      />
                    </div>
                  )}

                  {/* Playlists Section */}
                  {results.playlists.length > 0 && (
                    <div>
                      <div className="mb-4 flex items-center justify-between">
                        <h2 className="text-xl font-bold text-gray-900 flex items-center">
                          <ListMusic className="w-5 h-5 mr-2" />
                          Playlists ({results.playlists.length})
                        </h2>
                        {results.playlists.length > 12 && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-pink-600 hover:text-pink-700"
                            onClick={() => setShowAllPlaylists((v) => !v)}
                          >
                            {showAllPlaylists ? "See less" : "See all"}
                          </Button>
                        )}
                      </div>
                      <div className="flex flex-wrap justify-start gap-6">
                        {(showAllPlaylists
                          ? results.playlists
                          : results.playlists.slice(0, 12)
                        ).map((playlist) => (
                          <PlaylistCard
                            key={playlist.Id}
                            item={playlist as any}
                            authData={authData}
                            appendQuery={`q=${encodeURIComponent(query)}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12">
                  <Music className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                  <h2 className="text-xl font-semibold text-gray-900 mb-2">
                    No results found
                  </h2>
                  <p className="text-gray-600">
                    Try searching for different terms or check your spelling
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <MusicPlayer />
    </div>
  );
};

export default SearchPage;
