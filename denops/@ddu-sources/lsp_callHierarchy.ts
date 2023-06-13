import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { isLike } from "https://deno.land/x/unknownutil@v2.1.1/is.ts";
import {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
} from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { SomeRequired, uriToPath } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type ItemHierarchy = Omit<Item<ActionData>, "action" | "data"> & {
  action: SomeRequired<ActionData, "path" | "range">;
  data: CallHierarchyItem & {
    children?: ItemHierarchy[];
  };
};

export type Params = {
  clientName: ClientName;
  method: Extract<
    Method,
    | "callHierarchy/incomingCalls"
    | "callHierarchy/outgoingCalls"
  >;
  autoExpandSingle: boolean;
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
    const { clientName, method, autoExpandSingle } = sourceParams;

    return new ReadableStream({
      async start(controller) {
        const searchChildren = async (parentItem: ItemHierarchy) => {
          const parent = parentItem.data;
          const client = parentItem.action.context.client;
          const result = await lspRequest(denops, client, method, { item: parent }, ctx.bufNr);
          if (result) {
            const parentPath = uriToPath(parent.uri);
            return callHierarchiesToItems(result, parentPath, client, ctx.bufNr, method);
          }
        };

        const peek = async (parentItem: ItemHierarchy) => {
          const children = await searchChildren(parentItem);
          if (children && children.length > 0) {
            children.forEach((child) => {
              child.treePath = `${parentItem.treePath}/${child.data.name}`;
            });
            parentItem.isTree = true;
            parentItem.data = {
              ...parentItem.data,
              children,
            };
          } else {
            parentItem.isTree = false;
          }
          return parentItem;
        };

        try {
          if (args.parent) {
            // called from expandItem
            if (isLike({ data: { children: [] } }, args.parent)) {
              const resolvedChildren = await Promise.all(args.parent.data.children.map(peek));
              controller.enqueue(resolvedChildren);
            }
          } else {
            const clients = await getClients(denops, clientName, ctx.bufNr);

            await Promise.all(clients.map(async (client) => {
              const params = await makePositionParams(
                denops,
                ctx.bufNr,
                ctx.winId,
                client.offsetEncoding,
              );
              const items = await prepareCallHierarchy(denops, client, method, params, ctx.bufNr);
              if (items && items.length > 0) {
                const resolvedItems = await Promise.all(items.map(peek));
                controller.enqueue(resolvedItems);

                if (autoExpandSingle && items.length === 1 && items[0].data.children) {
                  items[0].isExpanded = true;
                  const children = await Promise.all(items[0].data.children.map(peek));
                  children.forEach((child) => child.level = 1);
                  controller.enqueue(children);
                }
              }
            }));
          }
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
      method: "callHierarchy/incomingCalls",
      autoExpandSingle: true,
    };
  }
}

async function prepareCallHierarchy(
  denops: Denops,
  client: Client,
  method: Method,
  params: TextDocumentPositionParams,
  bufNr: number,
): Promise<ItemHierarchy[] | undefined> {
  const result = await lspRequest(
    denops,
    client,
    "textDocument/prepareCallHierarchy",
    params,
    bufNr,
  );
  if (result) {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_prepareCallHierarchy
     */
    const callHierarchyItems = result as CallHierarchyItem[] | null;
    if (!callHierarchyItems) {
      return;
    }

    const context = { bufNr, method, client };

    return callHierarchyItems
      .map((callHierarchyItem) => {
        return {
          word: callHierarchyItem.name,
          action: {
            path: uriToPath(callHierarchyItem.uri),
            range: callHierarchyItem.range,
            context,
          },
          treePath: `/${callHierarchyItem.name}`,
          data: callHierarchyItem,
        };
      })
      .filter(isValidItem);
  }
}

function callHierarchiesToItems(
  result: LspResult,
  parentPath: string,
  client: Client,
  bufNr: number,
  method: Method,
): ItemHierarchy[] {
  /**
   * References:
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#callHierarchy_incomingCalls
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#callHierarchy_outgoingCalls
   */
  const calls = result as CallHierarchyIncomingCall[] | CallHierarchyOutgoingCall[] | null;
  if (!calls) {
    return [];
  }

  const context = { client, bufNr, method };

  return calls.flatMap((call) => {
    const linkItem = "from" in call ? call.from : call.to;
    const path = "from" in call ? uriToPath(linkItem.uri) : parentPath;
    // const path = uriToPath(linkItem.uri);

    return call.fromRanges.map((range) => {
      return {
        word: linkItem.name,
        display: `${linkItem.name}:${range.start.line + 1}:${range.start.character + 1}`,
        action: { path, range, context },
        data: linkItem,
      };
    });
  });
}
