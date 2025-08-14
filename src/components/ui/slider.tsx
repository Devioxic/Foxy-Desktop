import * as React from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";

import { cn } from "@/lib/utils";

const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1 w-full grow overflow-hidden rounded-full bg-gray-200 group-hover:bg-gray-300 transition-colors">
      <SliderPrimitive.Range className="absolute h-full bg-gray-400 group-hover:bg-pink-500 transition-colors" />
    </SliderPrimitive.Track>
    <SliderPrimitive.Thumb className="block opacity-0 group-hover:opacity-100 h-3 w-3 rounded-full border border-gray-300 bg-white hover:border-pink-300 hover:bg-pink-50 transition-all focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50" />
  </SliderPrimitive.Root>
));
Slider.displayName = SliderPrimitive.Root.displayName;

export { Slider };
