import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { DocumentSymbol, SymbolInformation, SymbolKind } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { isFeatureSupported, lspRequest, Method, Response } from "../ddu_source_lsp/request.ts";
import { ClientName, isClientName } from "../ddu_source_lsp/client.ts";
import { makeTextDocumentIdentifier } from "../ddu_source_lsp/params.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";

type Params = {
  clientName: ClientName;
};

const METHOD = "textDocument/documentSymbol" as const satisfies Method;

export class Source extends BaseSource<Params> {
  kind = "file";

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
          textDocument: await makeTextDocumentIdentifier(denops, ctx.bufNr),
        };

        const response = await lspRequest(denops, ctx.bufNr, clientName, METHOD, params);
        if (response) {
          const items = documentSymbolsToItems(response, ctx.bufNr);
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
  response: Response,
  bufNr: number,
): Item<ActionData>[] {
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
    return (a.action?.range?.start.line as number) - (b.action?.range?.start.line as number);
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
