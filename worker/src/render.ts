import { Resvg } from "@cf-wasm/resvg/workerd";
import fontRegular from "./assets/LiberationSans-Regular.subset.ttf";
import fontBold from "./assets/LiberationSans-Bold.subset.ttf";

// Subset Liberation Sans (Regular + Bold) bundled as raw bytes. resvg only draws
// <text> when given font data, so we pass these buffers explicitly and disable
// system-font loading for deterministic, fast rendering.
const FONTS = [new Uint8Array(fontRegular), new Uint8Array(fontBold)];

/** Rasterize an SVG string to PNG bytes at the SVG's intrinsic pixel size. */
export async function svgToPng(svg: string): Promise<Uint8Array> {
  const resvg = await Resvg.async(svg, {
    fitTo: { mode: "original" },
    background: "rgba(0,0,0,0)",
    font: { fontBuffers: FONTS, defaultFontFamily: "Liberation Sans" },
  });
  return resvg.render().asPng();
}
