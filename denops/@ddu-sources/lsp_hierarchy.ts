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
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isDenoUriWithFragment } from "../ddu_source_lsp/handler/denols.ts";
import { handler, ItemAction } from "../ddu_source_lsp/handler.ts";

type ItemHierarchy = Omit<ItemAction, "data"> & {
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
    const { clientName, method } = sourceParams;

    return new ReadableStream({
      start(controller) {
        handler(
          denops,
          ctx.bufNr,
          clientName,
          method,
          null,
          controller,
          async () => {
            const searchChildren = async (callHierarchyItem: CallHierarchyItem) => {
              const response = await lspRequest(denops, ctx.bufNr, clientName, method, { item: callHierarchyItem });
              if (response) {
                return callHierarchiesToItems(response, callHierarchyItem.uri);
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
                return resolvedChildren;
              }
            } else {
              const params = await makePositionParams(denops, ctx.bufNr, ctx.winId);
              const items = await prepareCallHierarchy(denops, ctx.bufNr, clientName, params);
              if (items && items.length > 0) {
                const resolvedItems = await Promise.all(items.map(peek));
                return resolvedItems;
              }
            }
          },
        );
      },
    });
  }

  params(): Params {
    return {
      clientName: "nvim-lsp",
      method: "callHierarchy/incomingCalls",
    };
  }
}

async function prepareCallHierarchy(
  denops: Denops,
  bufNr: number,
  clientName: ClientName,
  params: TextDocumentPositionParams,
): Promise<ItemHierarchy[] | undefined> {
  const response = await lspRequest(denops, bufNr, clientName, "textDocument/prepareCallHierarchy", params);
  if (response) {
    return response.flatMap((result) => {
      /**
       * Reference:
       * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_prepareCallHierarchy
       */
      const callHierarchyItems = result as CallHierarchyItem[];
      return callHierarchyItems
        .filter((item) => !isDenoUriWithFragment(item.uri));
    }).map((callHierarchyItem) => {
      return {
        word: callHierarchyItem.name,
        action: {
          path: uriToPath(callHierarchyItem.uri),
          range: callHierarchyItem.range,
        },
        treePath: `/${callHierarchyItem.name}`,
        data: callHierarchyItem,
      };
    });
  }
}

function callHierarchiesToItems(
  response: Results,
  parentUri: string,
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
          action: {
            path,
            range,
          },
          data: linkItem,
        };
      });
    });
  });
}
