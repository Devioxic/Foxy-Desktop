import React from "react";
import Sidebar from "@/components/Sidebar";
import MusicPlayer from "@/components/MusicPlayer";

interface PageLayoutProps {
  children: React.ReactNode;
  activeSection?: string;
  onSectionChange?: (section: string) => void;
  loading?: boolean;
  loadingContent?: React.ReactNode;
}

const PageLayout: React.FC<PageLayoutProps> = ({
  children,
  activeSection,
  onSectionChange,
  loading = false,
  loadingContent,
}) => {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <Sidebar
        activeSection={activeSection}
        onSectionChange={onSectionChange}
      />

      {/* Main Content */}
      <div className="ml-64">
        <div className="px-6 py-8 pb-32">
          {loading ? loadingContent : children}
        </div>
      </div>

      {/* Music Player */}
      <MusicPlayer />
    </div>
  );
};

export default PageLayout;
