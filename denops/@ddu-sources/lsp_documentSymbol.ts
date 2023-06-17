import {
  BaseSource,
  Context,
  DduItem,
  Denops,
  DocumentSymbol,
  Item,
  SymbolInformation,
} from "../ddu_source_lsp/deps.ts";
import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makeTextDocumentIdentifier } from "../ddu_source_lsp/params.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";
import { KindName } from "../@ddu-filters/converter_lsp_symbol.ts";

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
    const method: Method = "textDocument/documentSymbol";

    return new ReadableStream({
      async start(controller) {
        try {
          const clients = await getClients(denops, clientName, ctx.bufNr);

          const params = {
            textDocument: await makeTextDocumentIdentifier(denops, ctx.bufNr),
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
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_documentSymbol
   */
  const symbols = result as DocumentSymbol[] | SymbolInformation[] | null;
  if (!symbols) {
    return [];
  }

  const context = { client, bufNr, method };

  return symbols
    .map((symbol) => {
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
    })
    .filter(isValidItem)
    .sort((a, b) => {
      return a.action.range.start.line - b.action.range.start.line;
    });
}

function isSymbolInformation(
  symbol: SymbolInformation | DocumentSymbol,
): symbol is SymbolInformation {
  return "location" in symbol;
}
