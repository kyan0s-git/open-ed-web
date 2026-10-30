import { useMemo } from "react";
import qrcode from "qrcode-generator";

/** A QR code drawn as one SVG path, in the current text colour so it follows the theme. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    let d = "";
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + 4} ${row + 4}h1v1h-1z`;
      }
    }
    return { size: count + 8, path: d };
  }, [text]);

  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} className="qr__bg" />
      <path d={path} className="qr__ink" />
    </svg>
  );
}
