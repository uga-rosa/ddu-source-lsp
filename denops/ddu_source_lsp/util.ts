import { Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { fromFileUrl, isAbsolute, toFileUrl } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Location, LocationLink, Position } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";

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

export type SomePartial<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

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
  a: Position,
  b: Position,
): boolean {
  return a.line < b.line ||
    (a.line === b.line && a.character <= b.character);
}
