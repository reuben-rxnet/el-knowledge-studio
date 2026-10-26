/**
 * The EssilorLuxottica corporate wordmark, from the approved asset pack shared with Knowzy
 * (Knowzy: design/approved/knowzy_design_elements_asset_pack/branding/essilorluxottica_logo.svg,
 * copied unchanged to public/brand/essilorluxottica_logo.svg).
 *
 * It is inlined, not an <img>, because the file is drawn in `currentColor`: as an image it would
 * render black and vanish on the navy navigation. Inlined, it takes its container's colour (white on
 * navy, navy on white) without recolouring the asset. Same viewBox, geometry and font as the file;
 * brand.test.ts checks that. `className` and `style` are for size only.
 *
 * EL Knowledge Studio keeps its own name and mark; this logo only endorses it ("an EssilorLuxottica
 * application"). Not yet confirmed against the corporate brand portal's guidelines.
 */
import Link from "next/link";

export const LOGO_VIEWBOX = "0 0 620 90";

export function EssilorLuxotticaLogo({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox={LOGO_VIEWBOX} role="img" aria-label="EssilorLuxottica" className={className} style={style} focusable="false">
      <text x="4" y="70" fontFamily="Arial,Helvetica,sans-serif" fontSize="62" fontWeight="600" fill="currentColor">EssilorLuxottica</text>
    </svg>
  );
}

/** The slim footer under the sign-in panel and every page. */
export function AppFooter() {
  return (
    <footer className="app-footer">
      <span>EL Knowledge Studio · Internal use only · An internal application by</span>
      <EssilorLuxotticaLogo className="app-footer-logo" />
      <span className="spacer" />
      <Link href="/help">Help</Link>
      <Link href="/feedback">Feedback</Link>
    </footer>
  );
}
