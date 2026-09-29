type Props = { size?: number; className?: string };

/** Raster app icon reused throughout the UI. The SVG source remains in public/ for editing. */
export default function BusGarrafIcon({ size = 40, className }: Props) {
  return (
    <img
      className={className}
      width={size}
      height={size}
      src="/icon-512.png"
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
