import React, { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import MusicPlayer from "@/components/MusicPlayer";
import Sidebar from "@/components/Sidebar";
import AlbumCard from "@/components/AlbumCard";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import { Input } from "@/components/ui/input";
import { Disc3, Search } from "lucide-react";
import { getFavoriteAlbums } from "@/lib/jellyfin";
import { BaseItemDto } from "@jellyfin/sdk/lib/generated-client/models";
import { useAuthData } from "@/hooks/useAuthData";
import { logger } from "@/lib/logger";

interface FavouriteAlbum extends BaseItemDto {
  AlbumArtist?: string;
  ProductionYear?: number;
}

const Favourites = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { authData, isAuthenticated } = useAuthData();

  const [loading, setLoading] = useState(true);
  const [favouriteAlbums, setFavouriteAlbums] = useState<FavouriteAlbum[]>([]);
  const [filteredAlbums, setFilteredAlbums] = useState<FavouriteAlbum[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    loadFavourites();
  }, []);

  useEffect(() => {
    const q = searchParams.get("q") || "";
    setSearchQuery(q);
  }, [searchParams]);

  useEffect(() => {
    if (!searchQuery) {
      setFilteredAlbums(favouriteAlbums);
      return;
    }
    const q = searchQuery.toLowerCase();
    const filtered = favouriteAlbums.filter((album) =>
      [
        album.Name?.toLowerCase() || "",
        album.AlbumArtist?.toLowerCase() || "",
        ...(album.AlbumArtists || []).map(
          (a: any) => a.Name?.toLowerCase() || ""
        ),
      ].some((val) => val.includes(q))
    );
    setFilteredAlbums(filtered);
  }, [searchQuery, favouriteAlbums]);

  const loadFavourites = async () => {
    setLoading(true);
    try {
      if (!isAuthenticated()) {
        navigate("/login");
        return;
      }

      const albums = await getFavoriteAlbums(
        authData.serverAddress,
        authData.accessToken
      );
      const items = albums.Items || [];
      setFavouriteAlbums(items);
      setFilteredAlbums(items);
    } catch (error) {
      logger.error("Failed to load favourite albums:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Sidebar activeSection="favourites" />
        <div className="ml-64 p-6">
          <div className="max-w-none mx-auto">
            <LoadingSkeleton type="albums" />
          </div>
        </div>
        <MusicPlayer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar activeSection="favourites" />
      <div className="ml-64 p-6 pb-28">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Favourite Albums
          </h1>
          <p className="text-gray-600 mb-6">
            {filteredAlbums.length}{" "}
            {filteredAlbums.length === 1 ? "album" : "albums"}
            {filteredAlbums.length !== favouriteAlbums.length &&
              searchQuery && <> • {favouriteAlbums.length} total</>}
          </p>
          {/* Search (inline like other pages) */}
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            <Input
              placeholder="Search favourite albums..."
              value={searchQuery}
              onChange={(e) => {
                const val = e.target.value;
                setSearchQuery(val);
                const params = new URLSearchParams(searchParams);
                if (val) params.set("q", val);
                else params.delete("q");
                setSearchParams(params, { replace: false });
              }}
              className="pl-10 bg-white border-gray-200"
            />
          </div>
        </div>

        {/* Content */}
        {filteredAlbums.length === 0 ? (
          searchQuery ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Disc3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  No favourite albums found
                </h2>
                <p className="text-gray-600">
                  Try adjusting your search to find more albums.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-64">
              <div className="text-center">
                <Disc3 className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                <h2 className="text-xl font-semibold text-gray-900 mb-2">
                  No favourite albums yet
                </h2>
                <p className="text-gray-600 mb-4">
                  Start adding your favourite albums by clicking the star icon.
                </p>
                <Button onClick={() => navigate("/home")}>Explore Music</Button>
              </div>
            </div>
          )
        ) : (
          <div className="flex flex-wrap justify-start gap-6 mb-8">
            {filteredAlbums.map((album) => (
              <AlbumCard
                key={album.Id}
                item={album}
                authData={authData}
                appendQuery={
                  searchParams.get("q")
                    ? `q=${encodeURIComponent(searchParams.get("q") || "")}`
                    : undefined
                }
              />
            ))}
          </div>
        )}
      </div>

      <MusicPlayer />
    </div>
  );
};

export default Favourites;
