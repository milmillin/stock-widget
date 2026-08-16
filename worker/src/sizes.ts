export type WidgetSize = "small" | "medium" | "large";

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * iOS home-screen widget render targets, in pixels, at @3x scale — crisp on
 * modern iPhones and downscales cleanly on @2x devices.
 *   small  169x169 pt  ->  507x507
 *   medium 364x169 pt  -> 1092x507
 *   large  364x382 pt  -> 1092x1146
 */
export const SIZES: Record<WidgetSize, Dimensions> = {
  small: { width: 507, height: 507 },
  medium: { width: 1092, height: 507 },
  large: { width: 1092, height: 1146 },
};

export function resolveSize(raw: string | undefined): {
  size: WidgetSize;
  dims: Dimensions;
} {
  const key = (raw ?? "medium").toLowerCase();
  const size = (key in SIZES ? key : "medium") as WidgetSize;
  return { size, dims: SIZES[size] };
}
