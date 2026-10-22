import { useEffect, useState } from "react";

/** Same breakpoint as mobile.css: phones get lists instead of canvases and a drawer for the sidebar. */
export const MOBILE_QUERY = "(max-width: 760px)";

export function useIsMobile() {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return mobile;
}
