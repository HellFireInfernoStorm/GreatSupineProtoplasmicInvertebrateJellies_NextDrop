import dispatcher2x from "../assets/logo/nextdrop-dispatcher@2x.png";
import dispatcher3x from "../assets/logo/nextdrop-dispatcher@3x.png";
import field2x from "../assets/logo/nextdrop-field@2x.png";
import field3x from "../assets/logo/nextdrop-field@3x.png";
import store2x from "../assets/logo/nextdrop-store@2x.png";
import store3x from "../assets/logo/nextdrop-store@3x.png";

// The NextDrop wordmark exists only as raster images with the navy background baked in (Style Guide Logos
// 652:46054, ADR 0015). There is one export per background, so each must sit on its matching token:
// store on `panel` of the store theme, dispatcher on `panel` of the dispatcher theme, field on `bg` of the dark themes.
const SOURCES = {
  store: [store2x, store3x],
  dispatcher: [dispatcher2x, dispatcher3x],
  field: [field2x, field3x],
} as const;

interface LogoProps {
  /** The background the logo sits on. */
  panel: keyof typeof SOURCES;
  /** Set the height here, for example `h-8 w-auto`. */
  className?: string;
}

export function Logo({ panel, className }: LogoProps) {
  const [x2, x3] = SOURCES[panel];
  return <img src={x2} srcSet={`${x2} 2x, ${x3} 3x`} width={333} height={72} alt="NextDrop" className={className} />;
}
