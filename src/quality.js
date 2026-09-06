// Choose once before WebGL is created, including phones in landscape.
export const compact = typeof window !== "undefined" &&
  (window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700);
