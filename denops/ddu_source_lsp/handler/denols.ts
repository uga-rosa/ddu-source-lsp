import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";

import { lspRequest } from "../request.ts";
import { Client } from "../client.ts";

export function isDenoUriWithFragment(uri: string) {
  /**
   * Workaround. https://github.com/denoland/deno/issues/19304
   * filter deno virtual buffers with udd fragments
   * #(^|~|<|=)
   */
  return /^deno:.*%23(%5E|%7E|%3C|%3D)/.test(uri);
}

export async function createVirtualBuffer(
  denops: Denops,
  path: string,
  client: Client,
  bufNr: number,
) {
  if (!path.startsWith("deno:")) {
    return;
  }

  const newBufNr = await fn.bufadd(denops, path);
  await fn.bufload(denops, newBufNr);
  if (!await isEmptyBuffer(denops, newBufNr)) {
    return;
  }

  const params = { textDocument: { uri: path } };
  const result = await lspRequest(
    denops,
    client,
    "deno/virtualTextDocument",
    params,
    bufNr,
  );
  if (result) {
    const lines = (result as string).split("\n");
    await fn.setbufline(denops, newBufNr, 1, lines);
    await fn.setbufvar(denops, newBufNr, "&swapfile", 0);
    await fn.setbufvar(denops, newBufNr, "&buftype", "nofile");
    await fn.setbufvar(denops, newBufNr, "&modified", 0);
    await fn.setbufvar(denops, newBufNr, "&modifiable", 0);
    if (client.name === "nvim-lsp") {
      await denops.call(
        `luaeval`,
        `vim.lsp.buf_attach_client(${newBufNr}, ${client.id})`,
      );
    }
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
