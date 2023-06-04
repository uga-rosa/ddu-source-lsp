import { Location } from "npm:vscode-languageserver-types@3.17.4-next.0";

export function isDenoUriWithFragment(location: Location) {
  const { uri } = location;
  /**
   * Workaround. https://github.com/denoland/deno/issues/19304
   * filter deno virtual buffers with udd fragments
   * #(^|~|<|=)
   */
  return /^deno:.*%23(%5E|%7E|%3C|%3D)/.test(uri);
}
