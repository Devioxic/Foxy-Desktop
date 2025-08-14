import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import PageLayout from "@/components/PageLayout";
import { Library as LibraryIcon } from "lucide-react";

const Library = () => {
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState("library");

  return (
    <PageLayout
      activeSection={activeSection}
      onSectionChange={setActiveSection}
    >
      <h1 className="text-2xl font-bold text-gray-900 mb-8">Library</h1>
      <div className="text-center py-20">
        <LibraryIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-900 mb-2">
          Library is Under Construction
        </h2>
        <p className="text-gray-600">This page will be available soon.</p>
      </div>
    </PageLayout>
  );
};

export default Library;
