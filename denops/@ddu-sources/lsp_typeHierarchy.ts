import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { TypeHierarchyItem } from "npm:vscode-languageserver-types@3.17.4-next.0";
import { isLike } from "https://deno.land/x/unknownutil@v2.1.1/is.ts";

import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { SomeRequired, uriToPath } from "../ddu_source_lsp/util.ts";
import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type ItemHierarchy = Omit<Item<ActionData>, "action" | "data"> & {
  action: SomeRequired<ActionData, "path" | "range">;
  data: TypeHierarchyItem & {
    children?: ItemHierarchy[];
  };
};

export type Params = {
  clientName: ClientName;
  method: Extract<
    Method,
    | "typeHierarchy/supertypes"
    | "typeHierarchy/subtypes"
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
            return typeHierarchiesToItems(result, client, ctx.bufNr, method);
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
              const params = await makePositionParams(denops, ctx.bufNr, ctx.winId, client.encoding);
              const items = await prepareTypeHierarchy(denops, client, method, params, ctx.bufNr);
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
      method: "typeHierarchy/supertypes",
      autoExpandSingle: true,
    };
  }
}

async function prepareTypeHierarchy(
  denops: Denops,
  client: Client,
  method: Method,
  params: TextDocumentPositionParams,
  bufNr: number,
): Promise<ItemHierarchy[] | undefined> {
  const result = await lspRequest(denops, client, "textDocument/prepareTypeHierarchy", params, bufNr);
  if (result) {
    return typeHierarchiesToItems(result, client, bufNr, method);
  }
}

function typeHierarchiesToItems(
  result: LspResult,
  client: Client,
  bufNr: number,
  method: Method,
): ItemHierarchy[] {
  /**
   * References:
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_prepareTypeHierarchy
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#typeHierarchy_supertypes
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#typeHierarchy_subtypes
   */
  const typeHierarchyItems = result as TypeHierarchyItem[] | null;
  if (!typeHierarchyItems) {
    return [];
  }

  const context = { bufNr, method, client };

  return typeHierarchyItems
    .map((typeHierarchyItem) => typeHierarchyToItem(typeHierarchyItem, context))
    .filter(isValidItem);
}

function typeHierarchyToItem(
  typeHierarchyItem: TypeHierarchyItem,
  context: ItemContext,
): ItemHierarchy {
  return {
    word: typeHierarchyItem.name,
    action: {
      path: uriToPath(typeHierarchyItem.uri),
      range: typeHierarchyItem.range,
      context,
    },
    treePath: `/${typeHierarchyItem.name}`,
    data: typeHierarchyItem,
  };
}
