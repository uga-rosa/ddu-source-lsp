import { BaseSource, Context, DduItem, Denops, Item, LSP } from "../ddu_source_lsp/deps.ts";
import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makeCodeActionParams } from "../ddu_source_lsp/params.ts";
import { ActionData } from "../@ddu-kinds/lsp_codeAction.ts";
import { pick, printError } from "../ddu_source_lsp/util.ts";

type Params = {
  clientName: ClientName | "";
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
    const method: Method = "textDocument/codeAction";

    return new ReadableStream({
      async start(controller) {
        try {
          const clientName = await getClientName(denops, sourceParams);
          const clients = await getClients(denops, clientName, ctx.bufNr);

          await Promise.all(clients.map(async (client) => {
            const params = await makeCodeActionParams(
              denops,
              ctx.bufNr,
              ctx.winId,
              client,
            );
            const result = await lspRequest(
              denops,
              client,
              method,
              params,
              ctx.bufNr,
            );
            const items = parseResult(result, client, ctx.bufNr, method);
            controller.enqueue(items);
          }));
        } catch (e) {
          printError(denops, e, "source-lsp_codeAction");
        } finally {
          controller.close();
        }
      },
    });
  }

  params(): Params {
    return {
      clientName: "",
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
  const codeActions = result as (LSP.Command | LSP.CodeAction)[] | null;
  if (!codeActions) {
    return [];
  }

  const context = { client, bufNr, method };

  return codeActions.map((codeAction) => ({
    word: codeAction.title,
    action: {
      ...isCodeAction(codeAction) ? pick(codeAction, "edit", "command") : { command: codeAction },
      context,
      codeAction: isCodeAction(codeAction) ? codeAction : undefined,
    },
  }));
}

function isCodeAction(
  codeAction: LSP.Command | LSP.CodeAction,
): codeAction is LSP.CodeAction {
  return typeof codeAction.command !== "string";
}
