/**
 * All coordinates are (0, 0)-indexed
 */

import { Denops, fn } from "https://deno.land/x/ddu_vim@v3.0.2/deps.ts";
import { Position } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { decodeUtfPosition, encodeUtfPosition, OffsetEncoding } from "./offset_encoding.ts";

export async function vimGetBufLine(
  denops: Denops,
  bufNr: number,
  line: number,
): Promise<string> {
  const lines = await fn.getbufline(denops, bufNr, line + 1);
  return lines[0];
}

export async function vimGetPos(
  denops: Denops,
  expr: string,
  bufNr: number,
  offsetEncoding?: OffsetEncoding,
): Promise<Position> {
  const [, lnum, col] = await fn.getpos(denops, expr);
  return await encodeUtfPosition(
    denops,
    bufNr,
    { line: lnum - 1, character: col - 1 },
    offsetEncoding,
  );
}

export async function vimGetCursor(
  denops: Denops,
  winId: number,
  bufNr: number,
  offsetEncoding?: OffsetEncoding,
): Promise<Position> {
  const [, lnum, col] = await fn.getcurpos(denops, winId);
  return await encodeUtfPosition(
    denops,
    bufNr,
    { line: lnum - 1, character: col - 1 },
    offsetEncoding,
  );
}

export async function vimSetCursor(
  denops: Denops,
  winId: number,
  bufNr: number,
  position: Position,
  offsetEncoding?: OffsetEncoding,
) {
  const { line, character } = await decodeUtfPosition(denops, bufNr, position, offsetEncoding);

  if (denops.meta.host === "nvim") {
    const row = line + 1;
    const col = character;
    await denops.call("nvim_win_set_cursor", winId, [row, col]);
  } else {
    const lnum = line + 1;
    const col = character + 1;
    if (winId === 0 || winId === (await fn.win_getid(denops))) {
      await fn.cursor(denops, lnum, col);
    } else {
      await denops.cmd(
        `noautocmd call win_execute(${winId}, 'call cursor(${lnum}, ${col})')`,
      );
    }
  }
}

export async function vimWinSetBuf(
  denops: Denops,
  winId: number,
  bufNr: number,
) {
  if (denops.meta.host === "nvim") {
    await denops.call("nvim_win_set_buf", winId, bufNr);
  } else {
    await denops.cmd(`noautocmd call win_execute(${winId}, 'buffer ${bufNr}')`);
  }
}

export async function vimBufExecute(
  denops: Denops,
  bufNr: number,
  cmd: string,
) {
  const currentBufNr = await fn.bufnr(denops);
  try {
    await denops.cmd(`noautocmd buffer ${bufNr}`);
    await denops.cmd(cmd);
  } finally {
    await denops.cmd(`noautocmd buffer ${currentBufNr}`);
  }
}

export async function vimBufDelete(
  denops: Denops,
  bufNr: number,
) {
  if (denops.meta.host === "nvim") {
    await denops.call("nvim_buf_delete", bufNr, { force: true });
  } else {
    await denops.cmd(`bw! ${bufNr}`);
  }
}
