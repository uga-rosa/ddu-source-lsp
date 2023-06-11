import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Position, TextDocumentIdentifier } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { bufNrToFileUri } from "./util.ts";

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
): Promise<TextDocumentPositionParams> {
  const [_, lnum, col] = await fn.getcursorcharpos(denops, winId) as number[];
  const position: Position = {
    // 1-index to 0-index
    line: lnum - 1,
    character: col - 1,
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
