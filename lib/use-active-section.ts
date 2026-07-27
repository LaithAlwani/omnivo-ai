"use client";

import { useEffect, useState } from "react";

// Scroll-spy: returns the id of the section currently in view, for nav
// highlighting. Recomputed from *all* sections on each scroll (rAF-throttled),
// so it can never get stuck when scrolling into an untracked section — it always
// reflects the last section whose top has crossed the reading line.
export function useActiveSection(ids: string[]) {
  const [active, setActive] = useState<string>(ids[0] ?? "");

  useEffect(() => {
    if (ids.length === 0) return;

    let frame = 0;

    const update = () => {
      frame = 0;
      // The "reading line" — a bit above the viewport middle.
      const marker = window.innerHeight * 0.35;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        // Once a section's top has scrolled above the marker, it (or a later
        // one) is what the user is reading.
        if (el.getBoundingClientRect().top - marker <= 0) current = id;
      }
      setActive(current);
    };

    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ids]);

  return active;
}
