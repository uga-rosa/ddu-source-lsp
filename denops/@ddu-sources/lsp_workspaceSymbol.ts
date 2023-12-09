import {
  BaseSource,
  Context,
  DduItem,
  Denops,
  Item,
  LSP,
  SourceOptions,
} from "../ddu_source_lsp/deps.ts";
import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClientName, getClients } from "../ddu_source_lsp/client.ts";
import { printError, SomePartial, uriToFname } from "../ddu_source_lsp/util.ts";
import { KindName } from "../@ddu-filters/converter_lsp_symbol.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

export type ActionWorkspaceSymbol = SomePartial<ActionData, "range">;

type Params = {
  clientName: ClientName | "";
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
  }): ReadableStream<Item<ActionWorkspaceSymbol>[]> {
    const { denops, sourceOptions, sourceParams, context: ctx } = args;
    const { query } = sourceParams;
    const method: Method = "workspace/symbol";

    return new ReadableStream({
      async start(controller) {
        try {
          const clientName = await getClientName(denops, sourceParams);
          const clients = await getClients(denops, clientName, ctx.bufNr);

          const params = {
            query: sourceOptions.volatile ? args.input : query,
          };
          await Promise.all(clients.map(async (client) => {
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
          printError(denops, e, "source-lsp_workspaceSymbol");
        } finally {
          controller.close();
        }
      },
    });
  }

  params(): Params {
    return {
      clientName: "",
      query: "",
    };
  }
}

function parseResult(
  result: LspResult,
  client: Client,
  bufNr: number,
  method: Method,
): Item<ActionWorkspaceSymbol>[] {
  /**
   * Reference:
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbol
   */
  const symbols = result as
    | LSP.SymbolInformation[]
    | LSP.WorkspaceSymbol[]
    | null;
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
          path: uriToFname(symbol.location.uri),
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
  action: ActionWorkspaceSymbol,
  symbol: LSP.WorkspaceSymbol,
) {
  const resolvedSymbol = await lspRequest(
    denops,
    action.context.client,
    "workspaceSymbol/resolve",
    symbol,
    action.context.bufNr,
  );
  if (resolvedSymbol === null) {
    throw new Error(`Fail to workspaceSymbol/resolve`);
  } else {
    /**
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbolResolve
     */
    const workspaceSymbol = resolvedSymbol as LSP.WorkspaceSymbol;
    action.range = (workspaceSymbol.location as LSP.Location).range;
  }
}
