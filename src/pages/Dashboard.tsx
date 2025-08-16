import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import MusicPlayer from "@/components/MusicPlayer";
import Sidebar from "@/components/Sidebar";
import { useMusicPlayer } from "@/contexts/MusicContext";
import { Play, Music } from "lucide-react";
import {
  getMusicLibraryItems,
  getRecentlyPlayed,
  getRecentlyAdded,
  getFavorites,
  getRecentlyPlayedAlbums,
} from "@/lib/jellyfin";
import { getAlbumItems } from "@/lib/jellyfin";
import AlbumCard from "@/components/AlbumCard";
import LoadingSkeleton from "@/components/LoadingSkeleton";

const Dashboard = () => {
  const navigate = useNavigate();
  const { playNow, addToQueue, playQueue } = useMusicPlayer();
  const [recentlyPlayed, setRecentlyPlayed] = useState<any[]>([]);
  const [recentlyAdded, setRecentlyAdded] = useState<any[]>([]);
  const [favorites, setFavorites] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [authData] = useState(() =>
    JSON.parse(localStorage.getItem("authData") || "{}")
  );

  useEffect(() => {
    loadMusicData();
  }, []);

  const loadMusicData = async () => {
    try {
      if (!authData.accessToken || !authData.serverAddress) {
        navigate("/login");
        return;
      }

      const [playedAlbums, added, favs] = await Promise.all([
        getRecentlyPlayedAlbums(
          authData.serverAddress,
          authData.accessToken,
          6
        ),
        getRecentlyAdded(authData.serverAddress, authData.accessToken),
        getFavorites(authData.serverAddress, authData.accessToken),
      ]);

      setRecentlyPlayed(playedAlbums || []);
      setRecentlyAdded(added.Items?.slice(0, 12) || []);
      setFavorites(favs.Items?.slice(0, 6) || []);
    } catch (error) {
      console.error("Failed to load music data", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("authData");
    navigate("/server");
  };

  const renderSection = (
    title: string,
    items: any[],
    showAll: boolean = false
  ) => (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      </div>
      <div className="flex flex-wrap justify-start gap-6">
        {(showAll ? items : items.slice(0, 25)).map((item) => (
          <AlbumCard key={item.Id} item={item} authData={authData} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar activeSection="home" />

      {/* Main Content */}
      <div className="ml-64">
        {/* Content */}
        <div className="max-w-none mx-auto p-6 pb-28">
          {loading ? (
            <LoadingSkeleton type="dashboard" />
          ) : (
            <div className="space-y-8">
              {/* Quick Access Grid */}
              {recentlyPlayed.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-8">
                  {recentlyPlayed.slice(0, 6).map((item) => (
                    <Card
                      key={item.Id}
                      className="group cursor-pointer hover:shadow-md transition-shadow overflow-hidden"
                      style={{ boxSizing: "content-box" }}
                      onClick={() => navigate(`/album/${item.Id}`)}
                    >
                      <CardContent className="h-full w-full p-0">
                        <div className="flex items-center h-full w-full">
                          <div className="flex-shrink-0 relative rounded-l-lg flex items-center justify-center p-2.5">
                            {item.ImageTags?.Primary ? (
                              <img
                                src={`${authData.serverAddress}/Items/${item.Id}/Images/Primary?maxWidth=96&quality=90`}
                                alt={item.Name}
                                className="w-20 h-20 object-cover rounded-md flex-shrink-0"
                              />
                            ) : (
                              <div className="w-20 h-20 flex items-center justify-center bg-gradient-to-br from-pink-200 to-rose-200 rounded-md flex-shrink-0">
                                <Music className="w-8 h-8 text-pink-400" />
                              </div>
                            )}
                          </div>
                          <div className="flex-1 p-4 min-w-0">
                            <h3
                              className="font-medium text-gray-900 text-sm leading-tight mb-1 overflow-hidden"
                              style={{
                                display: "-webkit-box",
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: "vertical",
                              }}
                            >
                              {item.Name}
                            </h3>
                            <p className="text-sm text-gray-600 truncate">
                              {item.AlbumArtist || "Unknown Artist"}
                            </p>
                          </div>
                          <div className="px-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <Button
                              size="sm"
                              onClick={async (e) => {
                                e.stopPropagation();
                                try {
                                  const res = await getAlbumItems(
                                    authData.serverAddress,
                                    authData.accessToken,
                                    item.Id
                                  );
                                  const tracks = res?.Items || [];
                                  if (tracks.length) {
                                    playQueue(tracks as any[], 0);
                                  }
                                } catch (err) {
                                  console.error("Failed to play album", err);
                                }
                              }}
                              className="rounded-full w-10 h-10 bg-pink-600 hover:bg-pink-700"
                            >
                              <Play className="w-4 h-4 ml-0.5" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}

              {/* Sections */}
              {recentlyAdded.length > 0 &&
                renderSection("Recently Added", recentlyAdded)}
              {favorites.length > 0 &&
                renderSection("Your Favourites", favorites)}
            </div>
          )}
        </div>
      </div>

      {/* Music Player */}
      <MusicPlayer />
    </div>
  );
};

export default Dashboard;
