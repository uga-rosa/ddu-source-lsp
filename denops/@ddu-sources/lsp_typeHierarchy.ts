import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { TypeHierarchyItem } from "npm:vscode-languageserver-types@3.17.4-next.0";
import { isLike } from "https://deno.land/x/unknownutil@v2.1.1/is.ts";

import { lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type ItemHierarchy = Omit<Item<ActionData>, "data"> & {
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
        const searchChildren = async (typeHierarchyItem: TypeHierarchyItem) => {
          const response = await lspRequest(
            clientName,
            denops,
            ctx.bufNr,
            method,
            { item: typeHierarchyItem },
          );
          if (response) {
            return typeHierarchiesToItems(
              response,
              clientName,
              ctx.bufNr,
              method,
            );
          }
        };

        const peek = async (parent: ItemHierarchy) => {
          const hierarchyParent = parent.data;
          const children = await searchChildren(hierarchyParent);
          if (children && children.length > 0) {
            children.forEach((child) => {
              child.treePath = `${parent.treePath}/${child.data.name}`;
            });
            parent.isTree = true;
            parent.data = {
              ...parent.data,
              children,
            };
          } else {
            parent.isTree = false;
          }
          return parent;
        };

        if (args.parent) {
          // called from expandItem
          if (isLike({ data: { children: [] } }, args.parent)) {
            const resolvedChildren = await Promise.all(args.parent.data.children.map(peek));
            controller.enqueue(resolvedChildren);
          }
        } else {
          const params = await makePositionParams(denops, ctx.bufNr, ctx.winId);
          const items = await prepareTypeHierarchy(
            clientName,
            denops,
            ctx.bufNr,
            params,
            method,
          );
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
        }

        controller.close();
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
  clientName: ClientName,
  denops: Denops,
  bufNr: number,
  params: TextDocumentPositionParams,
  method: Method,
): Promise<ItemHierarchy[] | undefined> {
  const response = await lspRequest(
    clientName,
    denops,
    bufNr,
    "textDocument/prepareTypeHierarchy",
    params,
  );
  if (response) {
    return response.flatMap(({ result, clientId }) => {
      /**
       * Reference:
       * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_prepareTypeHierarchy
       */
      const typeHierarchyItems = result as TypeHierarchyItem[];

      const context = { clientName, bufNr, method, clientId };
      return typeHierarchyItems.map((typeHierarchyItem) => typeHierarchyToItem(typeHierarchyItem, context));
    }).filter(isValidItem);
  }
}

function typeHierarchiesToItems(
  response: Results,
  clientName: ClientName,
  bufNr: number,
  method: Method,
): ItemHierarchy[] {
  return response.flatMap(({ result, clientId }) => {
    /**
     * References:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#typeHierarchy_supertypes
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#typeHierarchy_subtypes
     */
    const typeHierarchyItems = result as TypeHierarchyItem[];

    const context = { clientName, bufNr, method, clientId };
    return typeHierarchyItems.map((typeHierarchyItem) => typeHierarchyToItem(typeHierarchyItem, context));
  });
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
