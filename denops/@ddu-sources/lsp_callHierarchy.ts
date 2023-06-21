import {
  BaseSource,
  CallHierarchyIncomingCall,
  CallHierarchyItem,
  CallHierarchyOutgoingCall,
  Context,
  DduItem,
  Denops,
  fn,
  isLike,
  Item,
  Range,
  relative,
} from "../ddu_source_lsp/deps.ts";
import { lspRequest, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { SomeRequired, uriToPath } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type ItemHierarchy = Omit<SomeRequired<Item<ActionData>, "treePath">, "action" | "data"> & {
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
        const peek = async (itemParent: ItemHierarchy) => {
          const children = await searchChildren(denops, method, itemParent, ctx.bufNr);
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
      .map((call) => {
        return {
          word: call.name,
          action: {
            path: uriToPath(call.uri),
            range: call.range,
            context,
          },
          treePath: [call.name],
          data: call,
        };
      })
      .filter(isValidItem);
  }
}

async function searchChildren(
  denops: Denops,
  method: Method,
  itemParent: ItemHierarchy,
  bufNr: number,
): Promise<ItemHierarchy[] | undefined> {
  const parent = itemParent.data;
  const client = itemParent.action.context.client;
  const result = await lspRequest(denops, client, method, { item: parent }, bufNr);
  if (result) {
    /**
     * References:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#callHierarchy_incomingCalls
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#callHierarchy_outgoingCalls
     *
     * Actually, it's CallHierarchyIncomingCall[] | CallHierarchyOutgoingCall[], but tsc is an idiot, so the inference must be this to make it work.
     */
    const calls = result as (CallHierarchyIncomingCall | CallHierarchyOutgoingCall)[] | null;
    if (!calls) {
      return;
    }

    const cwd = await fn.getcwd(denops);

    return calls.flatMap((call) => {
      const linkItem = isIncomingCall(call) ? call.from : call.to;
      const path = isIncomingCall(call) ? uriToPath(linkItem.uri) : itemParent.action.path;
      const relativePath = relative(cwd, path);

      const fromRanges = deduplicate(call.fromRanges, hashRange);
      return fromRanges.map((range) => {
        const lnum = range.start.line + 1;
        const col = range.start.character + 1;
        const display = `${linkItem.name} (${relativePath}:${lnum}:${col})`;
        return {
          word: linkItem.name,
          display,
          treePath: [...itemParent.treePath, display],
          action: { path, range, context: { client, bufNr, method } },
          data: linkItem,
        };
      });
    });
  }
}

function isIncomingCall(
  call: CallHierarchyIncomingCall | CallHierarchyOutgoingCall,
): call is CallHierarchyIncomingCall {
  return "from" in call;
}

function deduplicate<T>(
  array: T[],
  hashFunc: (t: T) => unknown,
) {
  const hashMap = new Map();
  const result: T[] = [];

  for (const elem of array) {
    const hash = hashFunc(elem);
    if (!hashMap.has(hash)) {
      hashMap.set(hash, true);
      result.push(elem);
    }
  }

  return result;
}

function hashRange(
  range: Range,
): string {
  return `${range.start.line}:${range.start.character}:${range.end.line}:${range.end.character}`;
}
