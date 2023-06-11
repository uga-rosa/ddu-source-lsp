import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { CodeAction, Command } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams } from "../ddu_source_lsp/params.ts";
import { ActionData } from "../@ddu-kinds/lsp_codeAction.ts";

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
          await makePositionParams(denops, ctx.bufNr, ctx.winId),
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
