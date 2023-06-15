/**
 * All coordinates are (0, 0)-indexed
 */

import { batch, Denops, fn } from "https://deno.land/x/ddu_vim@v3.0.2/deps.ts";
import { MarkInformation } from "https://deno.land/x/denops_std@v5.0.0/function/types.ts";
import { Position, Range } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { isPositionBefore, sliceByByteIndex } from "./util.ts";

export async function getBufLine(
  denops: Denops,
  bufNr: number,
  line: number, // -1 means last line ("$")
): Promise<string> {
  const lines = await fn.getbufline(denops, bufNr, line === -1 ? "$" : line + 1);
  return lines[0];
}

export async function getCursor(
  denops: Denops,
  winId: number,
): Promise<Position> {
  const [, lnum, col] = await fn.getcurpos(denops, winId);
  return { line: lnum - 1, character: col - 1 };
}

export async function selectRange(
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

export async function setCursor(
  denops: Denops,
  winId: number,
  position: Position,
) {
  const { line, character } = position;

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

export async function winSetBuf(
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

export async function writeBuffers(
  denops: Denops,
  buffers: number[],
) {
  const currentBufNr = await fn.bufnr(denops);
  try {
    await batch(denops, async (denops) => {
      for (const bufNr of buffers) {
        await fn.bufload(denops, bufNr);
        await denops.cmd(`noautocmd buffer ${bufNr}`);
        await denops.cmd(`noautocmd write`);
      }
    });
  } finally {
    await denops.cmd(`noautocmd buffer ${currentBufNr}`);
  }
}

export async function bufDelete(
  denops: Denops,
  bufNr: number,
) {
  if (denops.meta.host === "nvim") {
    await denops.call("nvim_buf_delete", bufNr, { force: true });
  } else {
    await denops.cmd(`bw! ${bufNr}`);
  }
}

export async function bufLineCount(
  denops: Denops,
  bufNr: number,
) {
  if (denops.meta.host === "nvim") {
    return await denops.call("nvim_buf_line_count", bufNr) as number;
  } else {
    const info = await fn.getbufinfo(denops, bufNr);
    if (info.length === 1) {
      return info[0].linecount;
    } else {
      throw new Error(`Invalid bufNr: ${bufNr}`);
    }
  }
}

/** Only end.character is exclusive, all others are inclusive. */
export async function bufSetText(
  denops: Denops,
  bufNr: number,
  range: Range,
  texts: string[],
) {
  if (denops.meta.host === "nvim") {
    await denops.call(
      "nvim_buf_set_text",
      bufNr,
      range.start.line,
      range.start.character,
      range.end.line,
      range.end.character,
      texts,
    );
  } else {
    const startLine = await getBufLine(denops, bufNr, range.start.line);
    const before = sliceByByteIndex(startLine, 0, range.start.character);
    const endLine = await getBufLine(denops, bufNr, range.end.line);
    const after = sliceByByteIndex(endLine, range.end.character);
    texts[0] = before + texts[0];
    texts[texts.length - 1] += after;
    await fn.deletebufline(denops, bufNr, range.start.line + 1, range.end.line + 1);
    await fn.appendbufline(denops, bufNr, range.start.line, texts);
  }
}

export async function bufSetMarks(
  denops: Denops,
  bufNr: number,
  marks: Pick<MarkInformation, "mark" | "pos">[],
) {
  if (denops.meta.host === "nvim") {
    await batch(denops, async (denops) => {
      for (const info of marks) {
        const line = info.pos[1];
        const col = info.pos[2] - 1;
        await denops.call("nvim_buf_set_mark", bufNr, info.mark.slice(1), line, col, {});
      }
    });
  } else {
    const currentBufNr = await fn.bufnr(denops);
    await batch(denops, async (denops) => {
      await fn.setbufvar(denops, bufNr, "&bufhidden", "hide");
      await denops.cmd(`noautocmd buffer ${bufNr}`);
      for (const info of marks) {
        await fn.setpos(denops, info.mark, info.pos);
      }
      await denops.cmd(`noautocmd buffer ${currentBufNr}`);
    });
  }
}
