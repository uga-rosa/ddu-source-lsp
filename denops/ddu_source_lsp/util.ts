import { Denops, fn, LSP, lu, relative } from "./deps.ts";
import { ItemContext } from "../@ddu-kinds/lsp.ts";

// On shared server, console.error is not output to vim's output area.
export async function printError(
  denops: Denops,
  e: unknown,
  name: string,
) {
  const message = e instanceof Error ? e.message : String(e);
  await denops.call("ddu#util#print_error", `[${name}] ${message}`);
}

export function uriToFname(uri: string) {
  try {
    return lu.uriToFname(uri);
  } catch {
    return uri;
  }
}

export async function bufnrToFname(
  denops: Denops,
  bufnr: number,
): Promise<string> {
  return await denops.eval(`fnamemodify(bufname(${bufnr}), ':p')`) as string;
}

export function locationToItem(
  location: LSP.Location | LSP.LocationLink,
  cwd: string,
  context: ItemContext,
) {
  const uri = "uri" in location ? location.uri : location.targetUri;
  const range = "range" in location ? location.range : location.targetSelectionRange;
  const path = uriToFname(uri);
  const relativePath = relative(cwd, path);
  const { line, character } = range.start;
  const [lineNr, col] = [line + 1, character + 1];
  return {
    word: relativePath,
    display: `${relativePath}:${lineNr}:${col}`,
    action: { path, range, context },
    data: location,
  };
}

export type SomeRequired<T, K extends keyof T> =
  & Omit<T, K>
  & Required<Pick<T, K>>;

export type SomePartial<T, K extends keyof T> =
  & Omit<T, K>
  & Partial<Pick<T, K>>;

export async function asyncFlatMap<Item, Res>(
  arr: Item[],
  callback: (value: Item, index: number, array: Item[]) => Promise<Res>,
) {
  const a = await Promise.all(arr.map(callback));
  return a.flat();
}

/**
 * Returns true if position 'a' is before or at the same position as 'b'.
 */
export function isPositionBefore(
  a: LSP.Position,
  b: LSP.Position,
): boolean {
  return a.line < b.line ||
    (a.line === b.line && a.character <= b.character);
}

export function hasProps<T extends string, K>(
  obj: Record<string, K | undefined>,
  ...keys: T[]
): obj is Record<T, K> {
  return keys.every((key) => obj[key] !== undefined);
}

export function pick<T, K extends keyof T>(
  obj: T,
  ...keys: K[]
): Pick<T, K> {
  return keys.filter((key) => obj[key] !== undefined)
    .reduce((acc, key) => {
      return {
        ...acc,
        [key]: obj[key],
      };
    }, {} as Pick<T, K>);
}

const ENCODER = new TextEncoder();
export function byteLength(
  str: string,
) {
  return ENCODER.encode(str).length;
}

const DECODER = new TextDecoder();
export function sliceByByteIndex(
  str: string,
  start?: number,
  end?: number,
) {
  const bytes = ENCODER.encode(str);
  const slicedBytes = bytes.slice(start, end);
  return DECODER.decode(slicedBytes);
}

export async function getCwd(
  denops: Denops,
  winId: number,
) {
  const winNr = await fn.win_id2win(denops, winId);
  return await fn.getcwd(denops, winNr);
}

export async function toRelative(
  denops: Denops,
  fullPath: string,
) {
  return relative(await fn.getcwd(denops), fullPath);
}
