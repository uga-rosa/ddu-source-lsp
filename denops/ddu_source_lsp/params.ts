import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import {
  CodeActionContext,
  Position,
  Range,
  TextDocumentIdentifier,
} from "npm:vscode-languageserver-types@3.17.4-next.0";

import { getProperDiagnostics } from "../@ddu-sources/lsp_diagnostic.ts";
import { ClientName } from "./client.ts";
import { bufNrToFileUri, toUtfIndex } from "./util.ts";

export type Encoding = "utf-8" | "utf-16" | "utf-32";

export type TextDocumentPositionParams = {
  /** The text document. */
  textDocument: TextDocumentIdentifier;
  /** The position inside the text document. */
  position: Position;
};

export async function makePositionParams(
  denops: Denops,
  bufNr: number,
  winId: number,
  encodeing?: Encoding,
): Promise<TextDocumentPositionParams> {
  const [_, lnum, byteCol] = await fn.getcurpos(denops, winId) as number[];
  const line = (await fn.getbufline(denops, bufNr, lnum))[0] ?? "";
  const character = toUtfIndex(line, byteCol - 1, encodeing);
  const position: Position = {
    line: lnum - 1,
    character,
  };

  return {
    textDocument: await makeTextDocumentIdentifier(denops, bufNr),
    position,
  };
}

export async function makeTextDocumentIdentifier(
  denops: Denops,
  bufNr: number,
): Promise<TextDocumentIdentifier> {
  return {
    uri: await bufNrToFileUri(denops, bufNr),
  };
}

type CodeActionParams = {
  textDocument: TextDocumentIdentifier;
  range: Range;
  context: CodeActionContext;
};

export async function makeCodeActionParams(
  clilentName: ClientName,
  denops: Denops,
  bufNr: number,
  winId: number,
  encodeing?: Encoding,
): Promise<CodeActionParams> {
  const textDocument = await makeTextDocumentIdentifier(denops, bufNr);
  const range = await getSelectionRange(denops, bufNr, winId, encodeing);
  const diagnostics = await getProperDiagnostics(clilentName, denops, bufNr);

  return {
    textDocument,
    range,
    context: { diagnostics: diagnostics ?? [] },
  };
}

async function getSelectionRange(
  denops: Denops,
  bufNr: number,
  winId: number,
  encodeing?: Encoding,
): Promise<Range> {
  const mode = await fn.mode(denops);
  if (mode === "v" || mode === "V") {
    const pos1vim = await fn.getpos(denops, ".");
    const pos2vim = await fn.getpos(denops, "v");
    // 1-index, col is byte offset.
    const pos1 = { lnum: pos1vim[1], col: pos1vim[2] };
    const pos2 = { lnum: pos2vim[1], col: pos2vim[2] };
    const [startByte, endByte] = (pos1.lnum < pos2.lnum ||
        (pos1.lnum === pos2.lnum && pos1.col <= pos2.col))
      ? [pos1, pos2]
      : [pos2, pos1];

    const startLine = (await fn.getbufline(denops, bufNr, startByte.lnum))[0];
    const endLine = (await fn.getbufline(denops, bufNr, endByte.lnum))[0];

    return {
      start: {
        line: startByte.lnum - 1,
        character: mode === "V" ? 0 : toUtfIndex(startLine, startByte.col - 1, encodeing),
      },
      end: {
        line: endByte.lnum - 1,
        character: toUtfIndex(endLine, mode === "V" ? -1 : endByte.col - 1, encodeing),
      },
    };
  } else {
    const curpos = await fn.getcurpos(denops, winId);
    const position: Position = {
      line: curpos[1] - 1,
      character: curpos[2] - 1,
    };
    return {
      start: position,
      end: position,
    };
  }
}
