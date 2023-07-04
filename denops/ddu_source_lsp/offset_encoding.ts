import { Denops, LSP } from "./deps.ts";
import { sliceByByteIndex } from "./util.ts";
import * as vim from "./vim.ts";

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
  bytePosition: LSP.Position,
  offsetEncoding: OffsetEncoding = "utf-16",
): Promise<LSP.Position> {
  if (offsetEncoding === "utf-8") {
    return bytePosition;
  } else {
    const byteIndex = bytePosition.character;
    const line = await vim.getBufLine(denops, bufNr, bytePosition.line);

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
  while (i < str.length && bytePoint < byteIndex) {
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
  utfPosition: LSP.Position,
  offsetEncoding: OffsetEncoding = "utf-16",
): Promise<LSP.Position> {
  if (offsetEncoding === "utf-8") {
    return utfPosition;
  } else {
    const utfIndex = utfPosition.character;
    const line = await vim.getBufLine(denops, bufNr, utfPosition.line);

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

export async function toUtf16Position(
  denops: Denops,
  bufNr: number,
  utfPosition: LSP.Position,
  offsetEncoding: OffsetEncoding = "utf-16",
) {
  if (offsetEncoding === "utf-16") {
    return utfPosition;
  } else {
    const line = await vim.getBufLine(denops, bufNr, utfPosition.line);
    if (offsetEncoding === "utf-8") {
      return {
        ...utfPosition,
        character: sliceByByteIndex(line, 0, utfPosition.character).length,
      };
    } else if (offsetEncoding === "utf-32") {
      return {
        ...utfPosition,
        character: utf32ToUtf16(line, utfPosition.character),
      };
    } else {
      offsetEncoding satisfies never;
      throw new Error(`Invalid offset encoding ${offsetEncoding}`);
    }
  }
}

function utf32ToUtf16(
  str: string,
  utf32Index: number,
) {
  let utf16Index = 0;
  for (let i = 0; i < utf32Index && utf16Index < str.length; i++) {
    const codePoint = str.codePointAt(utf16Index)!;
    if (codePoint > 0xFFFF) {
      // Surrogate pair
      utf16Index++;
    }
    utf16Index++;
  }
  return utf16Index;
}
