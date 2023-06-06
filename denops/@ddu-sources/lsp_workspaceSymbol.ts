import { BaseSource, Context, DduItem, Item, SourceOptions } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { SymbolInformation, WorkspaceSymbol } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { KindName } from "./lsp_documentSymbol.ts";
import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";
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
        const params = {
          query: sourceOptions.volatile ? args.input : query,
        };

        const results = await lspRequest(
          clientName,
          denops,
          ctx.bufNr,
          method,
          params,
        );
        if (results) {
          const items = workspaceSymbolsToItems(results, { clientName, bufNr: ctx.bufNr, method });
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
  context: ItemContext,
): Item<ActionData>[] {
  return response.flatMap((result) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbol
     */
    const symbols = result as SymbolInformation[] | WorkspaceSymbol[];

    return symbols.map((symbol) => {
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
    });
  }).filter(isValidItem);
}
