import { BaseSource, Context, DduItem, Item, SourceOptions } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { Location, Range, SymbolInformation, WorkspaceSymbol } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { isFeatureSupported, lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName, isClientName } from "../ddu_source_lsp/client.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { KindName } from "./lsp_documentSymbol.ts";
import { createVirtualBuffer, isDenoUriWithFragment } from "../ddu_source_lsp/deno.ts";

type Params = {
  clientName: ClientName;
  query: string;
};

const METHOD = "workspace/symbol" as const satisfies Method;
const RESOLVE_METHOD = "workspaceSymbol/resolve" as const satisfies Method;

export class Source extends BaseSource<Params> {
  kind = "workspace_symbol";

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

    return new ReadableStream({
      async start(controller) {
        if (!isClientName(clientName)) {
          console.log(`Unknown client name: ${clientName}`);
          controller.close();
          return;
        }

        const isSupported = await isFeatureSupported(denops, ctx.bufNr, clientName, METHOD);
        if (!isSupported) {
          if (isSupported === false) {
            console.log(`${METHOD} is not supported by any of the servers`);
          } else {
            console.log("No server attached");
          }
          controller.close();
          return;
        }

        const params = {
          query: sourceOptions.volatile ? args.input : query,
        };

        const response = await lspRequest(denops, ctx.bufNr, clientName, METHOD, params);
        if (response) {
          const resolve = (symbol: WorkspaceSymbol) => {
            return (async () => {
              const resolvedResults = await lspRequest(denops, ctx.bufNr, clientName, RESOLVE_METHOD, symbol);
              if (resolvedResults) {
                /**
                 * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbolResolve
                 */
                const workspaceSymbol = resolvedResults[0] as WorkspaceSymbol;
                return (workspaceSymbol.location as Location).range;
              }
            });
          };

          const items = workspaceSymbolsToItems(response, resolve);
          await Promise.all(items.map(async (item) => {
            const symbol = item.data as SymbolInformation | WorkspaceSymbol;
            await createVirtualBuffer(denops, ctx.bufNr, clientName, symbol.location.uri);
          }));
          controller.enqueue(items);
        }

        controller.close();
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

function workspaceSymbolsToItems(
  response: Results,
  resolve: (symbol: WorkspaceSymbol) => () => Promise<Range | undefined>,
): Item<ActionData>[] {
  return response.flatMap((result) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbol
     */
    const symbols = result as SymbolInformation[] | WorkspaceSymbol[];

    return symbols.flatMap((symbol) => {
      if (isDenoUriWithFragment(symbol.location.uri)) {
        return [];
      }
      const kindName = KindName[symbol.kind];
      const kind = `[${kindName}]`.padEnd(15, " ");
      return {
        word: `${kind} ${symbol.name}`,
        action: {
          path: uriToPath(symbol.location.uri),
          range: "range" in symbol.location ? symbol.location.range : undefined,
          resolve: "range" in symbol.location ? undefined : resolve(symbol),
        },
        data: symbol,
      };
    });
  });
}
