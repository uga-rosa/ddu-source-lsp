/**
 * All coordinates are (0, 0)-indexed
 */

import { Denops, fn } from "https://deno.land/x/ddu_vim@v3.0.2/deps.ts";
import { Position } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { isPositionBefore, sliceByByteIndex } from "./util.ts";

export async function vimGetBufLine(
  denops: Denops,
  bufNr: number,
  line: number,
): Promise<string> {
  const lines = await fn.getbufline(denops, bufNr, line + 1);
  return lines[0];
}

export async function vimGetCursor(
  denops: Denops,
  winId: number,
): Promise<Position> {
  const [, lnum, col] = await fn.getcurpos(denops, winId);
  return { line: lnum - 1, character: col - 1 };
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

export async function vimSelectRange(
  denops: Denops,
  winId: number,
): Promise<Range> {
  const curWinId = await fn.win_getid(denops);
  await denops.cmd(`noautocmd call win_gotoid(${winId})`);
  // In normal mode, both 'v' and '.' mark positions will be the cursor position.
  // In visual mode, 'v' will be the start of the visual area and '.' will be the cursor position (the end of the visual area).
  const [, lnum_s, col_s] = await fn.getpos(denops, "v");
  const [, lnum_e, col_e] = await fn.getpos(denops, ".");
  await denops.cmd(`noautocmd call win_gotoid(${curWinId})`);

  const pos1 = { line: lnum_s - 1, character: col_s - 1 };
  const pos2 = { line: lnum_e - 1, character: col_e - 1 };
  const [start, end] = isPositionBefore(pos1, pos2) ? [pos1, pos2] : [pos2, pos1];
  return { start, end };
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
