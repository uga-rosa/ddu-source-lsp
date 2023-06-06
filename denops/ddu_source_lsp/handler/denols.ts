import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { lspRequest } from "../request.ts";
import { ClientName } from "../client.ts";

export function isDenoUriWithFragment(uri: string) {
  /**
   * Workaround. https://github.com/denoland/deno/issues/19304
   * filter deno virtual buffers with udd fragments
   * #(^|~|<|=)
   */
  return /^deno:.*%23(%5E|%7E|%3C|%3D)/.test(uri);
}

export async function createVirtualBuffer(
  uri: string,
  clientName: ClientName,
  denops: Denops,
  bufNr: number,
) {
  if (!uri.startsWith("deno:")) {
    return;
  }

  const newBufNr = await fn.bufadd(denops, uri);
  await fn.bufload(denops, newBufNr);
  if (!await isEmptyBuffer(denops, newBufNr)) {
    return;
  }

  const params = { textDocument: { uri } };
  const results = await lspRequest(
    clientName,
    denops,
    bufNr,
    "deno/virtualTextDocument",
    params,
  );
  if (results) {
    const lines = (results[0] as string).split("\n");
    await fn.setbufline(denops, newBufNr, 1, lines);
    await fn.setbufvar(denops, newBufNr, "&swapfile", 0);
    await fn.setbufvar(denops, newBufNr, "&buftype", "nofile");
    await fn.setbufvar(denops, newBufNr, "&modified", 0);
    await fn.setbufvar(denops, newBufNr, "&modifiable", 0);
  }
}

async function isEmptyBuffer(
  denops: Denops,
  bufNr: number,
): Promise<boolean> {
  const lines = await fn.getbufline(denops, bufNr, 1, "$");
  if (lines.length === 1 && lines[0] === "") {
    return true;
  } else {
    return false;
  }
}
