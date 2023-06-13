import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { CodeAction, Command } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makeCodeActionParams } from "../ddu_source_lsp/params.ts";
import { ActionData, Kind } from "../@ddu-kinds/lsp_codeAction.ts";

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
    const method: Method = "textDocument/codeAction";

    return new ReadableStream({
      async start(controller) {
        try {
          const clients = await getClients(denops, clientName, ctx.bufNr);

          await Promise.all(clients.map(async (client) => {
            const params = await makeCodeActionParams(denops, ctx.bufNr, client);
            const result = await lspRequest(denops, client, method, params, ctx.bufNr);
            const items = parseResult(result, client, ctx.bufNr, method);
            controller.enqueue(items);
          }));
        } catch (e) {
          console.error(e);
        } finally {
          controller.close();
        }
      },
    });
  }

  params(): Params {
    return {
      clientName: "nvim-lsp",
    };
  }
}

function parseResult(
  result: LspResult,
  client: Client,
  bufNr: number,
  method: Method,
): Item<ActionData>[] {
  /**
   * Reference:
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_codeAction
   */
  const codeActions = result as (Command | CodeAction)[] | null;
  if (!codeActions) {
    return [];
  }

  const context = { client, bufNr, method };

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
}

function isCodeAction(
  codeAction: Command | CodeAction,
): codeAction is CodeAction {
  return typeof codeAction.command !== "string";
}
