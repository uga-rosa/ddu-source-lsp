import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { DocumentSymbol, SymbolInformation, SymbolKind } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makeTextDocumentIdentifier } from "../ddu_source_lsp/params.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { handler } from "../ddu_source_lsp/handler.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";

type Params = {
  clientName: ClientName;
};

export class Source extends BaseSource<Params> {
  kind = "lsp";

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
        const params = {
          textDocument: await makeTextDocumentIdentifier(denops, ctx.bufNr),
        };

        handler(
          async () => {
            const results = await lspRequest(denops, ctx.bufNr, clientName, "textDocument/documentSymbol", params);
            if (results) {
              return documentSymbolsToItems(results, ctx.bufNr);
            }
          },
          controller,
          ctx.bufNr,
          clientName,
          "textDocument/documentSymbol",
          params,
        );
      },
    });
  }

  params(): Params {
    return {
      clientName: "nvim-lsp",
    };
  }
}

function documentSymbolsToItems(
  response: Results,
  bufNr: number,
) {
  const items = response.flatMap((result) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_documentSymbol
     */
    const symbols = result as DocumentSymbol[] | SymbolInformation[];

    return symbols.map((symbol) => {
      const kindName = KindName[symbol.kind];
      const kind = `[${kindName}]`.padEnd(15, " ");
      if ("location" in symbol) {
        // symbol is SymbolInformation
        return {
          word: `${kind} ${symbol.name}`,
          action: {
            path: uriToPath(symbol.location.uri),
            range: symbol.location.range,
          },
          data: symbol,
        };
      } else {
        // symbol is DocumentSymbol
        return {
          word: `${kind} ${symbol.name}`,
          action: {
            bufNr,
            range: symbol.selectionRange,
          },
          data: symbol,
        };
      }
    });
  });

  items.sort((a, b) => {
    return a.action.range.start.line - b.action.range.start.line;
  });

  return items;
}

export const KindName = {
  1: "File",
  2: "Module",
  3: "Namespace",
  4: "Package",
  5: "Class",
  6: "Method",
  7: "Property",
  8: "Field",
  9: "Constructor",
  10: "Enum",
  11: "Interface",
  12: "Function",
  13: "Variable",
  14: "Constant",
  15: "String",
  16: "Number",
  17: "Boolean",
  18: "Array",
  19: "Object",
  20: "Key",
  21: "Null",
  22: "EnumMember",
  23: "Struct",
  24: "Event",
  25: "Operator",
  26: "TypeParameter",
} as const satisfies Record<SymbolKind, string>;

export type KindName = typeof KindName[keyof typeof KindName];
