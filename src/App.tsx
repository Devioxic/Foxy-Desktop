import React, { Suspense } from "react";
import {
  BrowserRouter,
  HashRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { MusicProvider } from "@/contexts/MusicContext";
import { useAuthData } from "@/hooks/useAuthData";
import { useSyncInitialization, useAutoSync } from "@/hooks/useSync";
import ErrorBoundary from "@/components/ErrorBoundary";
import LoadingSkeleton from "@/components/LoadingSkeleton";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import OfflineMode from "@/components/OfflineMode";
import { Toaster } from "sonner"; // Global toast renderer
import { ThemeProvider } from "next-themes";
import {
  OfflineModeProvider,
  useOfflineModeContext,
} from "@/contexts/OfflineModeContext";

// Lazy load components
const ServerAddressPage = React.lazy(() => import("@/pages/ServerAddressPage"));
const LoginPage = React.lazy(() => import("@/pages/LoginPage"));
const Home = React.lazy(() => import("@/pages/Home"));
const SearchPage = React.lazy(() => import("@/pages/SearchPage"));
const Library = React.lazy(() => import("@/pages/Library"));
const Artists = React.lazy(() => import("@/pages/Artists"));
const Albums = React.lazy(() => import("@/pages/Albums"));
const Playlists = React.lazy(() => import("@/pages/Playlists"));
const Downloads = React.lazy(() => import("./pages/Downloads"));
const DownloadedSongs = React.lazy(() => import("./pages/DownloadedSongs"));
const AlbumView = React.lazy(() => import("@/pages/AlbumView"));
const ArtistView = React.lazy(() => import("@/pages/ArtistView"));
const PlaylistView = React.lazy(() => import("@/pages/PlaylistView"));
const FavouritePlaylistView = React.lazy(
  () => import("@/pages/FavouritePlaylistView")
);
const Favourites = React.lazy(() => import("@/pages/Favourites"));
const SettingsPage = React.lazy(() => import("@/pages/SettingsPage"));
const NotFound = React.lazy(() => import("@/pages/NotFound"));

const LoadingFallback = () => (
  <div className="space-y-4">
    <div className="h-8 w-64 animate-shimmer rounded" />
    <div className="h-4 w-48 animate-shimmer rounded" />
  </div>
);

const LayoutFallback: React.FC<{ activeSection: string; type: any }> = ({
  activeSection,
  type,
}) => (
  <div className="min-h-screen bg-background">
    <Sidebar activeSection={activeSection} />
    <div className="ml-64 pb-28 p-6">
      <LoadingSkeleton type={type} />
    </div>
    <MusicPlayer />
  </div>
);

const OfflineGuard: React.FC<{
  allowOffline?: boolean;
  title?: string;
  message?: string;
  showDownloadsButton?: boolean;
  children: React.ReactNode;
}> = ({
  allowOffline = false,
  title,
  message,
  showDownloadsButton = true,
  children,
}) => {
  const { isOffline } = useOfflineModeContext();

  if (isOffline && !allowOffline) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar />
        <div className="ml-64 p-6 pb-28">
          <OfflineMode
            title={title ?? "Offline Mode Active"}
            message={
              message ??
              "This section isn't available while the server is offline. Check your downloads to enjoy your offline library."
            }
            showDownloadsButton={showDownloadsButton}
          />
        </div>
        <MusicPlayer />
      </div>
    );
  }

  return <>{children}</>;
};

const AppContent = () => {
  const { isAuthenticated } = useAuthData();

  // Initialize sync system when user is authenticated
  const { isInitializing, error: syncError } = useSyncInitialization();

  // Enable auto-sync for background updates
  useAutoSync();

  const shouldUseHash =
    typeof window !== "undefined" &&
    (window.location.protocol === "file:" || !!window.electronAPI);
  const RouterComponent = shouldUseHash ? HashRouter : BrowserRouter;

  return (
    <RouterComponent>
      <ErrorBoundary>
        <Routes>
          <Route
            path="/"
            element={
              isAuthenticated() ? (
                <Navigate to="/home" replace />
              ) : (
                <Navigate to="/server" replace />
              )
            }
          />
          <Route
            path="/server"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <ServerAddressPage />
              </Suspense>
            }
          />
          <Route
            path="/login"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <LoginPage />
              </Suspense>
            }
          />
          <Route
            path="/home"
            element={
              <OfflineGuard title="Home is unavailable offline">
                <Suspense
                  fallback={
                    <LayoutFallback activeSection="home" type="home" />
                  }
                >
                  <Home />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/search"
            element={
              <OfflineGuard title="Search is unavailable offline">
                <Suspense
                  fallback={
                    <LayoutFallback activeSection="search" type="home" />
                  }
                >
                  <SearchPage />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/library"
            element={
              <OfflineGuard title="Library is unavailable offline">
                <Suspense
                  fallback={
                    <LayoutFallback activeSection="library" type="library" />
                  }
                >
                  <Library />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/artists"
            element={
              <OfflineGuard title="Artists are unavailable offline">
                <Suspense
                  fallback={
                    <LayoutFallback activeSection="artists" type="artists" />
                  }
                >
                  <Artists />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/albums"
            element={
              <OfflineGuard title="Albums are unavailable offline">
                <Suspense
                  fallback={
                    <LayoutFallback activeSection="albums" type="albums" />
                  }
                >
                  <Albums />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/playlists"
            element={
              <OfflineGuard title="Playlists are unavailable offline">
                <Suspense
                  fallback={
                    <LayoutFallback activeSection="playlists" type="playlists" />
                  }
                >
                  <Playlists />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/downloads"
            element={
              <OfflineGuard allowOffline>
                <Suspense
                  fallback={
                    <LayoutFallback
                      activeSection="downloads"
                      type="library"
                    />
                  }
                >
                  <Downloads />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/downloads/songs"
            element={
              <OfflineGuard allowOffline>
                <Suspense
                  fallback={
                    <LayoutFallback
                      activeSection="downloads"
                      type="library"
                    />
                  }
                >
                  <DownloadedSongs />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/album/:albumId"
            element={
              <OfflineGuard
                title="Albums are unavailable offline"
                message="Connect to your Jellyfin server to view album details."
              >
                <Suspense
                  fallback={
                    <LayoutFallback
                      activeSection="albums"
                      type="albumDetail"
                    />
                  }
                >
                  <AlbumView />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/artist/:artistId"
            element={
              <OfflineGuard
                title="Artists are unavailable offline"
                message="Connect to your Jellyfin server to explore artist details."
              >
                <Suspense
                  fallback={
                    <LayoutFallback
                      activeSection="artists"
                      type="artist"
                    />
                  }
                >
                  <ArtistView />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/playlist/favourites"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="favourites" type="playlist" />
                }
              >
                <FavouritePlaylistView />
              </Suspense>
            }
          />
          <Route
            path="/playlist/:playlistId"
            element={
              <OfflineGuard
                title="Playlists are unavailable offline"
                message="Playlist details require a connection to your Jellyfin server."
              >
                <Suspense
                  fallback={
                    <LayoutFallback
                      activeSection="playlists"
                      type="playlist"
                    />
                  }
                >
                  <PlaylistView />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/favourites"
            element={
              <OfflineGuard title="Favourites are unavailable offline">
                <Suspense
                  fallback={
                    <LayoutFallback
                      activeSection="favourites"
                      type="albums"
                    />
                  }
                >
                  <Favourites />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="/settings"
            element={
              <OfflineGuard allowOffline showDownloadsButton={false}>
                <Suspense fallback={<LoadingFallback />}>
                  <SettingsPage />
                </Suspense>
              </OfflineGuard>
            }
          />
          <Route
            path="*"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <NotFound />
              </Suspense>
            }
          />
        </Routes>
      </ErrorBoundary>
    </RouterComponent>
  );
};

const App = () => {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <OfflineModeProvider>
        <MusicProvider>
          <AppContent />
          {/* Global Toaster for notifications */}
          <Toaster richColors closeButton />
        </MusicProvider>
      </OfflineModeProvider>
    </ThemeProvider>
  );
};

export default App;
