import { Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { fromFileUrl, isAbsolute, toFileUrl } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Location, LocationLink } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";
import { Encoding } from "./params.ts";

export async function bufNrToFileUri(
  denops: Denops,
  bufNr: number,
) {
  const filepath = await denops.eval(`fnamemodify(bufname(${bufNr}), ":p")`) as string;
  return isAbsolute(filepath) ? toFileUrl(filepath).href : filepath;
}

export function locationToItem(
  location: Location | LocationLink,
  context: ItemContext,
): Item<ActionData> {
  const uri = "uri" in location ? location.uri : location.targetUri;
  const range = "range" in location ? location.range : location.targetSelectionRange;
  const path = uriToPath(uri);
  const { line, character } = range.start;
  const [lineNr, col] = [line + 1, character + 1];
  return {
    word: path,
    display: `${path}:${lineNr}:${col}`,
    action: { path, range, context },
    data: location,
  };
}

export function uriToPath(uri: string) {
  if (uri.startsWith("file://")) {
    return fromFileUrl(uri);
  } else {
    return uri;
  }
}

export type SomeRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

export async function asyncFlatMap<Item, Res>(
  arr: Item[],
  callback: (value: Item, index: number, array: Item[]) => Promise<Res>,
) {
  const a = await Promise.all(arr.map(callback));
  return a.flat();
}

const Encoder = new TextEncoder();
function byteLength(str: string) {
  return Encoder.encode(str).length;
}

export function toUtfIndex(
  line: string,
  index: number,
  encodeing: Encoding = "utf-16",
): number {
  if (encodeing === "utf-8") {
    if (index) {
      return index;
    } else {
      return byteLength(line);
    }
  } else {
    const { utf32Index, utf16Index } = str_utfindex(line, index);
    if (encodeing === "utf-16") {
      return utf16Index;
    } else if (encodeing === "utf-32") {
      return utf32Index;
    } else {
      encodeing satisfies never;
      throw new Error(`Invalid encodeing: ${encodeing}`);
    }
  }
}

export function fromUtfIndex(
  line: string,
  index: number,
  encodeing: Encoding = "utf-16",
): number {
  if (encodeing === "utf-8") {
    if (index) {
      return index;
    } else {
      return byteLength(line);
    }
  } else {
    if (encodeing === "utf-16") {
      return str_byteindex(line, index, true);
    } else if (encodeing === "utf-32") {
      return str_byteindex(line, index);
    } else {
      encodeing satisfies never;
      throw new Error(`Invalid encodeing ${encodeing}`);
    }
  }
}

/**
 * Copy of vim.str_utfindex()
 */
function str_utfindex(
  str: string,
  index: number,
) {
  let utf32Index = 0;
  let utf16Index = 0;

  for (let i = 0; i < index; ++i) {
    const codePoint = str.codePointAt(i);
    if (codePoint !== undefined) {
      if (codePoint > 0xFFFF) {
        // surrogate pair
        utf16Index += 2;
        i += 1; // Skip next unit which is the second half of a surrogate pair
      } else {
        utf16Index += 1;
      }

      utf32Index += 1;
    } else {
      // Invalid byte or embedded null, count as one code point
      utf32Index += 1;
      utf16Index += 1;
    }
  }

  return { utf32Index, utf16Index };
}

/**
 * Copy of vim.str_byteindex()
 */
function str_byteindex(
  str: string,
  index: number,
  use_utf16 = false,
): number {
  let byteIndex = 0;
  let utfIndex = 0;

  for (let i = 0; i < str.length; ++i) {
    const codePoint = str.codePointAt(i);
    if (codePoint !== undefined) {
      if (codePoint > 0xFFFF) {
        // surrogate pair
        if (use_utf16) {
          utfIndex += 2;
        } else {
          utfIndex += 1;
        }
        i += 1; // Skip next unit which is the second half of a surrogate pair
      } else {
        utfIndex += 1;
      }

      if (utfIndex > index) {
        break;
      }

      byteIndex = i + 1;
    } else {
      // Invalid byte or embedded null, count as one code point
      if (utfIndex >= index) {
        break;
      }
      byteIndex += 1;
      utfIndex += 1;
    }
  }

  return byteIndex;
}
