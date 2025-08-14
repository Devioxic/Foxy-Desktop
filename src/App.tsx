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
import "@/utils/performance"; // Import performance diagnostics
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";
import { Toaster } from "sonner"; // Global toast renderer

// Lazy load components
const ServerAddressPage = React.lazy(() => import("@/pages/ServerAddressPage"));
const LoginPage = React.lazy(() => import("@/pages/LoginPage"));
const Dashboard = React.lazy(() => import("@/pages/Dashboard"));
const SearchPage = React.lazy(() => import("@/pages/SearchPage"));
const Library = React.lazy(() => import("@/pages/Library"));
const Artists = React.lazy(() => import("@/pages/Artists"));
const Albums = React.lazy(() => import("@/pages/Albums"));
const Playlists = React.lazy(() => import("@/pages/Playlists"));
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
  <div className="min-h-screen bg-gray-50">
    <Sidebar activeSection={activeSection} />
    <div className="ml-64 pb-28 p-6">
      <LoadingSkeleton type={type} />
    </div>
    <MusicPlayer />
  </div>
);

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
              <Suspense
                fallback={
                  <LayoutFallback activeSection="home" type="dashboard" />
                }
              >
                <Dashboard />
              </Suspense>
            }
          />
          <Route
            path="/search"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="search" type="dashboard" />
                }
              >
                <SearchPage />
              </Suspense>
            }
          />
          <Route
            path="/library"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="library" type="library" />
                }
              >
                <Library />
              </Suspense>
            }
          />
          <Route
            path="/artists"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="artists" type="artists" />
                }
              >
                <Artists />
              </Suspense>
            }
          />
          <Route
            path="/albums"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="albums" type="albums" />
                }
              >
                <Albums />
              </Suspense>
            }
          />
          <Route
            path="/playlists"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="playlists" type="playlists" />
                }
              >
                <Playlists />
              </Suspense>
            }
          />
          <Route
            path="/album/:albumId"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="albums" type="albumDetail" />
                }
              >
                <AlbumView />
              </Suspense>
            }
          />
          <Route
            path="/artist/:artistId"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="artists" type="artist" />
                }
              >
                <ArtistView />
              </Suspense>
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
              <Suspense
                fallback={
                  <LayoutFallback activeSection="playlists" type="playlist" />
                }
              >
                <PlaylistView />
              </Suspense>
            }
          />
          <Route
            path="/favourites"
            element={
              <Suspense
                fallback={
                  <LayoutFallback activeSection="favourites" type="albums" />
                }
              >
                <Favourites />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={<LoadingFallback />}>
                <SettingsPage />
              </Suspense>
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
    <MusicProvider>
      <AppContent />
      {/* Global Toaster for notifications */}
      <Toaster richColors closeButton />
    </MusicProvider>
  );
};

export default App;
