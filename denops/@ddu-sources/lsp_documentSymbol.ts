import { BaseSource, GatherArguments, Item, LSP } from "../ddu_source_lsp/deps.ts";
import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { ClientName, getClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makeTextDocumentIdentifier } from "../ddu_source_lsp/params.ts";
import { printError, SomeRequired, uriToFname } from "../ddu_source_lsp/util.ts";
import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";
import { KindName } from "../@ddu-filters/converter_lsp_symbol.ts";

type Params = {
  clientName: ClientName | "";
};

type ItemWithAction = SomeRequired<Item<ActionData>, "action">;

export class Source extends BaseSource<Params> {
  kind = "lsp";

  gather(args: GatherArguments<Params>): ReadableStream<Item<ActionData>[]> {
    const { denops, sourceParams, context: ctx } = args;
    const method: Method = "textDocument/documentSymbol";

    return new ReadableStream({
      async start(controller) {
        try {
          if (args.parent) {
            // Call from expandItem
            const parent = args.parent as ItemWithAction;
            // SymbolInformation doesn't have children, parent must be DocumentSymbol.
            const symbol = parent.data as LSP.DocumentSymbol;
            const children = symbol.children!
              .map((child) => symbolToItem(child, [...parent.treePath!], parent.action.context));
            controller.enqueue(children);
          } else {
            const clientName = await getClientName(denops, sourceParams);
            const clients = await getClients(denops, clientName, ctx.bufNr);

            const params = {
              textDocument: await makeTextDocumentIdentifier(denops, ctx.bufNr),
            };
            await Promise.all(clients.map(async (client) => {
              const result = await lspRequest(
                denops,
                client,
                method,
                params,
                ctx.bufNr,
              );
              const items = parseResult(result, { client, bufNr: ctx.bufNr, method });
              controller.enqueue(items);
            }));
          }
        } catch (e) {
          printError(denops, e, "source-lsp_documentSymbol");
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

function symbolToItem(
  symbol: LSP.DocumentSymbol | LSP.SymbolInformation,
  parentPath: string[],
  context: ItemContext,
): ItemWithAction {
  const kindName = KindName[symbol.kind];
  const kind = `[${kindName}]`.padEnd(15, " ");
  return {
    word: `${kind} ${symbol.name}`,
    action: {
      ...(isDucumentSymbol(symbol)
        ? {
          bufNr: context.bufNr,
          range: symbol.selectionRange,
        }
        : {
          path: uriToFname(symbol.location.uri),
          range: symbol.location.range,
        }),
      context,
    },
    isExpanded: true,
    level: parentPath.length,
    treePath: [...parentPath, symbol.name],
    isTree: "children" in symbol,
    data: symbol,
  };
}

function parseResult(
  result: LspResult,
  context: ItemContext,
): Item<ActionData>[] {
  /**
   * Reference:
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_documentSymbol
   */
  const symbols = result as
    | LSP.DocumentSymbol[]
    | LSP.SymbolInformation[]
    | null;
  if (!symbols) {
    return [];
  }

  const items: ItemWithAction[] = [];
  const setItems = (
    parentPath: string[],
    symbols: LSP.DocumentSymbol[] | LSP.SymbolInformation[],
  ) => {
    for (const symbol of symbols) {
      const item = symbolToItem(symbol, parentPath, context);
      if (isDucumentSymbol(symbol) && symbol.children) {
        setItems(item.treePath as string[], symbol.children);
      }
      if (isValidItem(item)) {
        items.push(item);
      }
    }
  };

  setItems([], symbols);

  items.sort((a, b) => {
    const aStart = a.action.range.start;
    const bStart = b.action.range.start;
    if (aStart.line !== bStart.line) {
      return aStart.line - bStart.line;
    }
    return aStart.character - bStart.character;
  });
  return items;
}

function isDucumentSymbol(
  symbol: LSP.SymbolInformation | LSP.DocumentSymbol,
): symbol is LSP.DocumentSymbol {
  return "range" in symbol;
}
