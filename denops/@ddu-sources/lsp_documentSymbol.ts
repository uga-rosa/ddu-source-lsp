import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { DocumentSymbol, SymbolInformation, SymbolKind } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makeTextDocumentIdentifier } from "../ddu_source_lsp/params.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

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
    const method = "textDocument/documentSymbol";

    return new ReadableStream({
      async start(controller) {
        const params = {
          textDocument: await makeTextDocumentIdentifier(denops, ctx.bufNr),
        };
        const results = await lspRequest(
          clientName,
          denops,
          ctx.bufNr,
          method,
          params,
        );
        if (results) {
          const items = documentSymbolsToItems(
            results,
            clientName,
            ctx.bufNr,
            method,
          );
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

function documentSymbolsToItems(
  response: Results,
  clientName: ClientName,
  bufNr: number,
  method: Method,
): Item<ActionData>[] {
  const items = response.flatMap(({ result, clientId }) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_documentSymbol
     */
    const symbols = result as DocumentSymbol[] | SymbolInformation[];

    const context = { clientName, bufNr, method, clientId };
    return symbols.map((symbol) => {
      const kindName = KindName[symbol.kind];
      const kind = `[${kindName}]`.padEnd(15, " ");
      const action = isSymbolInformation(symbol)
        ? {
          path: uriToPath(symbol.location.uri),
          range: symbol.location.range,
        }
        : {
          bufNr,
          range: symbol.selectionRange,
        };
      return {
        word: `${kind} ${symbol.name}`,
        action: {
          ...action,
          context,
        },
        data: symbol,
      };
    });
  }).filter(isValidItem);

  items.sort((a, b) => {
    return a.action.range.start.line - b.action.range.start.line;
  });

  return items;
}

function isSymbolInformation(
  symbol: SymbolInformation | DocumentSymbol,
): symbol is SymbolInformation {
  return "location" in symbol;
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
