import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import {
  CodeActionContext,
  Position,
  Range,
  TextDocumentIdentifier,
} from "npm:vscode-languageserver-types@3.17.4-next.0";

import { getProperDiagnostics } from "../@ddu-sources/lsp_diagnostic.ts";
import { Client } from "./client.ts";
import { bufNrToFileUri, isPositionBefore } from "./util.ts";
import { vimGetCursor, vimGetPos } from "./vim.ts";
import { OffsetEncoding } from "./offset_encoding.ts";

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
  offsetEncoding?: OffsetEncoding,
): Promise<TextDocumentPositionParams> {
  return {
    textDocument: await makeTextDocumentIdentifier(denops, bufNr),
    position: await vimGetCursor(denops, winId, bufNr, offsetEncoding),
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
  denops: Denops,
  bufNr: number,
  clilent: Client,
): Promise<CodeActionParams> {
  const textDocument = await makeTextDocumentIdentifier(denops, bufNr);
  const range = await getSelectionRange(denops, bufNr, clilent.offsetEncoding);
  const diagnostics = await getProperDiagnostics(clilent.name, denops, bufNr);

  return {
    textDocument,
    range,
    context: { diagnostics: diagnostics ?? [] },
  };
}

async function getSelectionRange(
  denops: Denops,
  bufNr: number,
  offsetEncoding?: OffsetEncoding,
): Promise<Range> {
  // In normal mode, both 'v' and '.' mark positions will be the cursor position.
  // In visual mode, 'v' will be the start of the visual area and '.' will be the cursor position (the end of the visual area).
  const pos1 = await vimGetPos(denops, "v", bufNr, offsetEncoding);
  const pos2 = await vimGetPos(denops, ".", bufNr, offsetEncoding);
  const [start, end] = isPositionBefore(pos1, pos2) ? [pos1, pos2] : [pos2, pos1];

  const mode = await fn.mode(denops);
  if (mode === "V") {
    start.character = 0;
    end.character = Number.MAX_SAFE_INTEGER;
  }

  return { start, end };
}
