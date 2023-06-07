import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import {
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
} from "npm:vscode-languageserver-types@3.17.4-next.0";
import { isLike } from "https://deno.land/x/unknownutil@v2.1.1/is.ts";

import { lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { uriToPath } from "../ddu_source_lsp/util.ts";
import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type ItemHierarchy = Omit<Item<ActionData>, "data"> & {
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
        const searchChildren = async (callHierarchyItem: CallHierarchyItem) => {
          const response = await lspRequest(
            clientName,
            denops,
            ctx.bufNr,
            method,
            { item: callHierarchyItem },
          );
          if (response) {
            return callHierarchiesToItems(
              response,
              callHierarchyItem.uri,
              { clientName, bufNr: ctx.bufNr, method },
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
              ...hierarchyParent,
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
          const items = await prepareCallHierarchy(
            clientName,
            denops,
            ctx.bufNr,
            params,
            { clientName, bufNr: ctx.bufNr, method },
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
      method: "callHierarchy/incomingCalls",
      autoExpandSingle: true,
    };
  }
}

async function prepareCallHierarchy(
  clientName: ClientName,
  denops: Denops,
  bufNr: number,
  params: TextDocumentPositionParams,
  context: ItemContext,
): Promise<ItemHierarchy[] | undefined> {
  const response = await lspRequest(
    clientName,
    denops,
    bufNr,
    "textDocument/prepareCallHierarchy",
    params,
  );
  if (response) {
    return response.flatMap((result) => {
      /**
       * Reference:
       * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_prepareCallHierarchy
       */
      const callHierarchyItems = result as CallHierarchyItem[];
      return callHierarchyItems;
    }).map((callHierarchyItem) => {
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
    }).filter(isValidItem);
  }
}

function callHierarchiesToItems(
  response: Results,
  parentUri: string,
  context: ItemContext,
): ItemHierarchy[] {
  return response.flatMap((result) => {
    /**
     * References:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#callHierarchy_incomingCalls
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#callHierarchy_outgoingCalls
     */
    const calls = result as CallHierarchyIncomingCall[] | CallHierarchyOutgoingCall[];

    return calls.flatMap((call) => {
      const linkItem = "from" in call ? call.from : call.to;
      const path = uriToPath("from" in call ? linkItem.uri : parentUri);

      return call.fromRanges.map((range) => {
        return {
          word: linkItem.name,
          display: `${linkItem.name}:${range.start.line + 1}:${range.start.character + 1}`,
          action: { path, range, context },
          data: linkItem,
        };
      });
    });
  });
}
