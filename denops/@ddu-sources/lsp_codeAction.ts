import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import {
  CodeAction,
  CodeActionContext,
  Command,
  Position,
  Range,
  TextDocumentIdentifier,
} from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makeTextDocumentIdentifier } from "../ddu_source_lsp/params.ts";
import { ActionData } from "../@ddu-kinds/lsp_codeAction.ts";
import { getProperDiagnostics } from "./lsp_diagnostic.ts";

type Params = {
  clientName: ClientName;
};

export class Source extends BaseSource<Params> {
  kind = "lsp_codeAction";

  gather(args: {
    denops: Denops;
    sourceParams: Params;
    context: Context;
    input: string;
    parent?: DduItem;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams, context: ctx } = args;
    const { clientName } = sourceParams;

    return new ReadableStream({
      async start(controller) {
        const results = await lspRequest(
          clientName,
          denops,
          ctx.bufNr,
          "textDocument/codeAction",
          await makeCodeActionParams(clientName, denops, ctx.bufNr, ctx.winId),
        );
        if (results) {
          const items = codeActionsToItems(results, clientName, ctx.bufNr);
          controller.enqueue(items);
        }
        controller.close();
      },
    });
  }

  params(): Params {
    return {
      clientName: "nvim-lsp",
    };
  }
}

type CodeActionParams = {
  textDocument: TextDocumentIdentifier;
  range: Range;
  context: CodeActionContext;
};

async function makeCodeActionParams(
  clilentName: ClientName,
  denops: Denops,
  bufNr: number,
  winId: number,
): Promise<CodeActionParams> {
  const textDocument = await makeTextDocumentIdentifier(denops, bufNr);
  const range = await getSelectionRange(denops, bufNr, winId);
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
): Promise<Range> {
  const mode = await fn.mode(denops);
  if (mode === "v" || mode === "V") {
    const pos1vim = await fn.getpos(denops, ".");
    const pos2vim = await fn.getpos(denops, "v");
    const pos1 = { line: pos1vim[1] - 1, character: pos1vim[2] - 1 };
    const pos2 = { line: pos2vim[1] - 1, character: pos2vim[2] - 1 };
    const [start, end] = (pos1.line < pos2.line ||
        (pos1.line === pos2.line && pos1.character <= pos2.character))
      ? [pos1, pos2]
      : [pos2, pos1];
    if (mode === "V") {
      start.character = 0;
      const endLine = (await fn.getbufline(denops, bufNr, end.line + 1))[0];
      end.character = endLine.length - 1;
    }
    return { start, end };
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

function codeActionsToItems(
  results: Results,
  clientName: ClientName,
  bufNr: number,
): Item<ActionData>[] {
  return results.flatMap(({ result, clientId }) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_codeAction
     */
    const codeActions = result as (Command | CodeAction)[];

    const context = { clientName, bufNr, clientId };
    return codeActions.map((codeAction) => {
      return {
        word: codeAction.title,
        action: {
          edit: isCodeAction(codeAction) ? codeAction.edit : undefined,
          command: isCodeAction(codeAction) ? codeAction.command : codeAction,
          context,
        },
        data: codeAction,
      };
    });
  });
}

function isCodeAction(
  codeAction: Command | CodeAction,
): codeAction is CodeAction {
  return typeof codeAction.command !== "string";
}
