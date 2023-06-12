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

const Encoder = new TextEncoder();
function byteLength(str: string) {
  return Encoder.encode(str).length;
}

export function encodeUtfIndex(
  line: string,
  byteIndex: number,
  offsetEncoding: OffsetEncoding = "utf-16",
): number {
  if (offsetEncoding === "utf-8") {
    if (byteIndex) {
      return byteIndex;
    } else {
      return byteLength(line);
    }
  } else {
    const { utf32Index, utf16Index } = str_utfindex(line, byteIndex);
    if (offsetEncoding === "utf-16") {
      return utf16Index;
    } else if (offsetEncoding === "utf-32") {
      return utf32Index;
    } else {
      offsetEncoding satisfies never;
      throw new Error(`Invalid encoding: ${offsetEncoding}`);
    }
  }
}

export function decodeUtfIndex(
  line: string,
  utfIndex: number,
  offsetEncoding: OffsetEncoding = "utf-16",
): number {
  if (offsetEncoding === "utf-8") {
    if (utfIndex) {
      return utfIndex;
    } else {
      return byteLength(line);
    }
  } else {
    if (offsetEncoding === "utf-16") {
      return str_byteindex(line, utfIndex, true);
    } else if (offsetEncoding === "utf-32") {
      return str_byteindex(line, utfIndex);
    } else {
      offsetEncoding satisfies never;
      throw new Error(`Invalid encoding ${offsetEncoding}`);
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
