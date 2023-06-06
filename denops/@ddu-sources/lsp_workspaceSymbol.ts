import { BaseSource, Context, DduItem, Item, SourceOptions } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { SymbolInformation, WorkspaceSymbol } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { KindName } from "./lsp_documentSymbol.ts";
import { handler, ItemAction } from "../ddu_source_lsp/handler.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";

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

    return new ReadableStream({
      start(controller) {
        const params = {
          query: sourceOptions.volatile ? args.input : query,
        };

        handler(
          async () => {
            const results = await lspRequest(denops, ctx.bufNr, clientName, "workspace/symbol", params);
            if (results) {
              return workspaceSymbolsToItems(results);
            }
          },
          controller,
          ctx.bufNr,
          clientName,
          "workspace/symbol",
          params,
        );

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
): ItemAction[] {
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
        },
        data: symbol,
      };
    });
  });
}
