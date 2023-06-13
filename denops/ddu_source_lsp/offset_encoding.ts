import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Position } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { vimGetBufLine } from "./vim.ts";

const OFFSET_ENCODING = [
  /**
   * Character offsets count UTF-8 code units (e.g bytes).
   */
  "utf-8",

  /**
   * Character offsets count UTF-16 code units.
   *
   * This is the default and must always be supported by servers
   */
  "utf-16",

  /**
   * Character offsets count UTF-32 code units.
   *
   * Implementation note: these are the same as Unicode code points,
   * so this `PositionEncodingKind` may also be used for an
   * encoding-agnostic representation of character offsets.
   */
  "utf-32",
] as const satisfies readonly string[];

export type OffsetEncoding = typeof OFFSET_ENCODING[number];

/**
 * bytePosition refers to the cursor position returned from vim,
 * which is calculated based on UTF-8 encoding.
 * (0, 0)-indexed.
 */
export async function encodeUtfPosition(
  denops: Denops,
  bufNr: number,
  bytePosition: Position,
  offsetEncoding: OffsetEncoding = "utf-16",
): Promise<Position> {
  if (offsetEncoding === "utf-8") {
    return bytePosition;
  } else {
    const byteIndex = bytePosition.character;
    const line = await vimGetBufLine(denops, bufNr, bytePosition.line);

    const { utf32Index, utf16Index } = toUtfIndex(line, byteIndex);
    return {
      ...bytePosition,
      character: (offsetEncoding === "utf-16") ? utf16Index : utf32Index,
    };
  }
}

function toUtfIndex(
  str: string,
  byteIndex: number,
) {
  let utf16Index = 0;
  let utf32Index = 0;

  let bytePoint = 0;
  let i = 0;
  while (i < str.length && bytePoint <= byteIndex) {
    const codePoint = str.codePointAt(i)!;
    if (codePoint > 0xFFFF) {
      // Surrogate pair
      utf16Index += 2;
      i += 2;
    } else {
      utf16Index++;
      i++;
    }
    utf32Index++;
    bytePoint += codePointToUtf8ByteSize(codePoint);
  }

  return { utf32Index, utf16Index };
}

function codePointToUtf8ByteSize(
  codepoint: number,
): number {
  if (codepoint <= 0x7F) {
    return 1;
  } else if (codepoint <= 0x7FF) {
    return 2;
  } else if (codepoint <= 0xFFFF) {
    return 3;
  } else if (codepoint <= 0x10FFFF) {
    return 4;
  } else {
    throw new Error("Invalid Unicode codepoint");
  }
}

export async function decodeUtfPosition(
  denops: Denops,
  bufNr: number,
  utfPosition: Position,
  offsetEncoding: OffsetEncoding = "utf-16",
): Promise<Position> {
  if (offsetEncoding === "utf-8") {
    return utfPosition;
  } else {
    const utfIndex = utfPosition.character;
    const line = await vimGetBufLine(denops, bufNr, utfPosition.line);

    return {
      ...utfPosition,
      character: toByteIndex(line, utfIndex, offsetEncoding === "utf-16"),
    };
  }
}

function toByteIndex(
  str: string,
  utfIndex: number,
  useUtf16: boolean,
): number {
  let byteIndex = 0;
  let charIndex = 0;

  while (charIndex < utfIndex && charIndex < str.length) {
    const codePoint = str.codePointAt(charIndex)!;
    if (useUtf16 && codePoint > 0xFFFF) {
      // Surrogate pair
      charIndex++;
    }
    charIndex++;

    byteIndex += codePointToUtf8ByteSize(codePoint);
  }

  return byteIndex;
}
