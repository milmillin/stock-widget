// Font files are imported as raw bytes via the wrangler "Data" rule (see wrangler.jsonc).
declare module "*.ttf" {
  const data: ArrayBuffer;
  export default data;
}
