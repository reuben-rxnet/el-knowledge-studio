/** Lens-styled thumbnail placeholder, tinted per project. Real thumbnails come from the render pipeline. */
export function Thumb({ hue, width = 64 }: { hue: number; width?: number }) {
  return (
    <span
      className="thumb"
      aria-hidden
      style={{ width, height: Math.round(width * 0.62), background: `linear-gradient(135deg,hsl(${hue} 70% 22%),hsl(${hue + 10} 85% 42%))` }}
    />
  );
}
