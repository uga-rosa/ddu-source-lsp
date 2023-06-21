import {
  BaseSource,
  Context,
  DduItem,
  Denops,
  isLike,
  Item,
  TypeHierarchyItem,
} from "../ddu_source_lsp/deps.ts";
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
        const searchChildren = async (itemParent: ItemHierarchy) => {
          const parent = itemParent.data;
          const client = itemParent.action.context.client;
          const result = await lspRequest(denops, client, method, { item: parent }, ctx.bufNr);
          if (result) {
            return typeHierarchiesToItems(result, client, ctx.bufNr, method, itemParent);
          }
        };

        const peek = async (itemParent: ItemHierarchy) => {
          if (typeof itemParent.isTree === "boolean") {
            return itemParent;
          }
          const children = await searchChildren(itemParent);
          if (children && children.length > 0) {
            itemParent.isTree = true;
            itemParent.data = {
              ...itemParent.data,
              children,
            };
          } else {
            itemParent.isTree = false;
          }
          return itemParent;
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
  const result = await lspRequest(
    denops,
    client,
    "textDocument/prepareTypeHierarchy",
    params,
    bufNr,
  );
  if (result) {
    return typeHierarchiesToItems(result, client, bufNr, method);
  }
}

function typeHierarchiesToItems(
  result: LspResult,
  client: Client,
  bufNr: number,
  method: Method,
  itemParent?: ItemHierarchy,
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
    .map((typeHierarchyItem) => typeHierarchyToItem(typeHierarchyItem, context, itemParent))
    .filter(isValidItem);
}

function typeHierarchyToItem(
  typeHierarchyItem: TypeHierarchyItem,
  context: ItemContext,
  itemParent?: ItemHierarchy,
): ItemHierarchy {
  return {
    word: typeHierarchyItem.name,
    treePath: [...itemParent?.treePath ?? [], typeHierarchyItem.name],
    action: {
      path: uriToPath(typeHierarchyItem.uri),
      range: typeHierarchyItem.range,
      context,
    },
    data: typeHierarchyItem,
  };
}
