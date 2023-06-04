import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { isAbsolute, toFileUrl } from "https://deno.land/std@0.190.0/path/mod.ts";

export async function bufNrToFileUrl(
  denops: Denops,
  bufNr: number,
) {
  const filepath = await denops.eval(`fnamemodify(bufname(${bufNr}), ":p")`) as string;
  return isAbsolute(filepath) ? toFileUrl(filepath).href : filepath;
}
