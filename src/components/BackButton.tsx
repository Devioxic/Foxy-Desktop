import React from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";

interface BackButtonProps {
  className?: string;
  label?: string;
  onClick?: () => void;
}

// Reusable back button for page headers
const BackButton: React.FC<BackButtonProps> = ({
  className = "mb-6 text-gray-600 hover:text-gray-900",
  label = "Back",
  onClick,
}) => {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      onClick={onClick || (() => navigate(-1))}
      className={className}
    >
      <ArrowLeft className="w-4 h-4 mr-2" />
      {label}
    </Button>
  );
};

export default BackButton;
