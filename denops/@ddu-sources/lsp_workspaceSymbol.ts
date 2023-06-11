import { BaseSource, Context, DduItem, Item, SourceOptions } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Location, SymbolInformation, WorkspaceSymbol } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClients } from "../ddu_source_lsp/client.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { KindName } from "./lsp_documentSymbol.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type Params = {
  clientName: ClientName;
  query: string;
};

export class Source extends BaseSource<Params> {
  kind = "lsp";

  gather(args: {
    denops: Denops;
    sourceOptions: SourceOptions;
    sourceParams: Params;
    context: Context;
    input: string;
    parent?: DduItem;
  }): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceOptions, sourceParams, context: ctx } = args;
    const { clientName, query } = sourceParams;
    const method = "workspace/symbol";

    return new ReadableStream({
      async start(controller) {
        try {
          const clients = await getClients(denops, clientName, ctx.bufNr);

          const params = {
            query: sourceOptions.volatile ? args.input : query,
          };
          await Promise.all(clients.map(async (client) => {
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
      query: "",
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
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbol
   */
  const symbols = result as SymbolInformation[] | WorkspaceSymbol[] | null;
  if (!symbols) {
    return [];
  }

  const context = { client, bufNr, method };

  return symbols
    .map((symbol) => {
      const kindName = KindName[symbol.kind];
      const kind = `[${kindName}]`.padEnd(15, " ");
      return {
        word: `${kind} ${symbol.name}`,
        action: {
          path: uriToPath(symbol.location.uri),
          range: "range" in symbol.location ? symbol.location.range : undefined,
          context,
        },
        data: symbol,
      };
    })
    .filter(isValidItem);
}

export async function resolveWorkspaceSymbol(
  denops: Denops,
  action: ActionData,
  symbol: WorkspaceSymbol,
) {
  if (action.range) {
    return;
  }

  const resolvedResult = await lspRequest(
    denops,
    action.context.client,
    "workspaceSymbol/resolve",
    symbol,
    action.context.bufNr,
  );
  if (resolvedResult) {
    /**
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbolResolve
     */
    const workspaceSymbol = resolvedResult as WorkspaceSymbol;
    action.range = (workspaceSymbol.location as Location).range;
  }
}
