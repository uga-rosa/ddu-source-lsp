import { Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { fromFileUrl, isAbsolute, toFileUrl } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Location } from "npm:vscode-languageserver-types@3.17.4-next.0";

export async function bufNrToFileUrl(
  denops: Denops,
  bufNr: number,
) {
  const filepath = await denops.eval(`fnamemodify(bufname(${bufNr}), ":p")`) as string;
  return isAbsolute(filepath) ? toFileUrl(filepath).href : filepath;
}

export function locationToItem(
  location: Location,
): Item<ActionData> {
  const { uri, range } = location;
  const path = uriToPath(uri);
  const { line, character } = range.start;
  const [lineNr, col] = [line + 1, character + 1];
  return {
    word: path,
    display: `${path}:${lineNr}:${col}`,
    action: {
      path,
      lineNr: location.range.start.line + 1,
      col: location.range.start.character + 1,
    },
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
