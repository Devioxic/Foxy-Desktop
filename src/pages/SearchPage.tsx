import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";
import Sidebar from "@/components/Sidebar";
import SearchBar from "@/components/SearchBar";
import AlbumCard from "@/components/AlbumCard";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { Play, Plus, Music, User, Disc3, ListMusic } from "lucide-react";
import { searchWithRelatedContent, findArtistByName } from "@/lib/jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client";
import { formatDuration, getItemImageUrl } from "@/utils/media";

const SearchPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { playNow, addToQueue } = useMusicPlayer();
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

  const handleAlbumClick = (albumId: string) => {
    navigate(`/album/${albumId}?q=${encodeURIComponent(query)}`);
  };

  const handlePlayTrack = (track: BaseItemDto) => {
    const formattedTrack = {
      Id: track.Id || "",
      Name: track.Name || "",
      Artist: track.AlbumArtist,
      AlbumArtist: track.AlbumArtist,
      Album: track.Album,
      RunTimeTicks: track.RunTimeTicks,
    };
    playNow(formattedTrack);
  };

  const handleAddToQueue = (track: BaseItemDto) => {
    const formattedTrack = {
      Id: track.Id || "",
      Name: track.Name || "",
      Artist: track.AlbumArtist,
      AlbumArtist: track.AlbumArtist,
      Album: track.Album,
      RunTimeTicks: track.RunTimeTicks,
    };
    addToQueue(formattedTrack);
  };

  const getImageUrl = (itemId: string, type: string = "Primary") => {
    return getItemImageUrl(itemId, authData.serverAddress, 300, type);
  };

  const totalResults =
    results.songs.length +
    results.artists.length +
    results.albums.length +
    results.playlists.length;

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
              <SearchBar placeholder="Search for songs, artists, albums..." />
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

                  {/* Songs Section */}
                  {results.songs.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                        <Music className="w-5 h-5 mr-2" />
                        Songs ({results.songs.length})
                      </h2>
                      <div className="space-y-2">
                        {results.songs.slice(0, 10).map((song) => (
                          <Card
                            key={song.Id}
                            className="bg-white border-gray-200 hover:bg-gray-50 transition-colors"
                          >
                            <CardContent className="p-4">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center space-x-4 flex-1 min-w-0">
                                  <img
                                    src={getImageUrl(song.Id || "")}
                                    alt={song.Name}
                                    className="h-12 w-12 rounded object-cover"
                                  />
                                  <div className="flex-1 min-w-0">
                                    <h3 className="font-medium text-gray-900 truncate">
                                      {song.Name}
                                    </h3>
                                    <p className="text-sm text-gray-600 truncate">
                                      {song.AlbumArtist || "Unknown Artist"}
                                      {song.Album && ` • ${song.Album}`}
                                    </p>
                                  </div>
                                  <span className="text-sm text-gray-500">
                                    {formatDuration(song.RunTimeTicks)}
                                  </span>
                                </div>
                                <div className="flex items-center space-x-2 ml-4">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-8 w-8 p-0 border-gray-200 hover:bg-pink-50 hover:border-pink-200"
                                    onClick={() => handlePlayTrack(song)}
                                  >
                                    <Play className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0 hover:bg-gray-100"
                                    onClick={() => handleAddToQueue(song)}
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                        {results.songs.length > 10 && (
                          <p className="text-sm text-gray-500 text-center py-2">
                            Showing first 10 of {results.songs.length} songs
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Artists Section */}
                  {results.artists.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                        <User className="w-5 h-5 mr-2" />
                        Artists ({results.artists.length})
                      </h2>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {results.artists.slice(0, 12).map((artist) => (
                          <Card
                            key={artist.Id}
                            className="bg-white border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() =>
                              handleArtistClick(artist.Name || "", artist.Id)
                            }
                          >
                            <CardContent className="p-4 text-center">
                              <img
                                src={getImageUrl(artist.Id || "")}
                                alt={artist.Name}
                                className="h-24 w-24 mx-auto rounded-full object-cover mb-3"
                              />
                              <h3 className="font-medium text-gray-900 truncate">
                                {artist.Name}
                              </h3>
                              <Badge
                                variant="secondary"
                                className="mt-2 bg-gray-100 text-gray-700"
                              >
                                Artist
                              </Badge>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Albums Section */}
                  {results.albums.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                        <Disc3 className="w-5 h-5 mr-2" />
                        Albums ({results.albums.length})
                      </h2>
                      <div className="flex flex-wrap justify-start gap-6">
                        {results.albums.slice(0, 12).map((album) => (
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

                  {/* Playlists Section */}
                  {results.playlists.length > 0 && (
                    <div>
                      <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center">
                        <ListMusic className="w-5 h-5 mr-2" />
                        Playlists ({results.playlists.length})
                      </h2>
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                        {results.playlists.slice(0, 12).map((playlist) => (
                          <Card
                            key={playlist.Id}
                            className="bg-white border-gray-200 hover:bg-gray-50 cursor-pointer transition-colors"
                            onClick={() =>
                              navigate(
                                `/playlist/${
                                  playlist.Id
                                }?q=${encodeURIComponent(query)}`
                              )
                            }
                          >
                            <CardContent className="p-4">
                              <img
                                src={getImageUrl(playlist.Id || "")}
                                alt={playlist.Name}
                                className="w-full aspect-square rounded object-cover mb-3"
                              />
                              <h3 className="font-medium text-gray-900 truncate">
                                {playlist.Name}
                              </h3>
                              <p className="text-sm text-gray-600">Playlist</p>
                            </CardContent>
                          </Card>
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
    </div>
  );
};

export default SearchPage;
