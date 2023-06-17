import {
  BaseSource,
  Context,
  DduItem,
  Denops,
  Item,
  Location,
  ReferenceContext,
} from "../ddu_source_lsp/deps.ts";
import { lspRequest, LspResult, Method } from "../ddu_source_lsp/request.ts";
import { Client, ClientName, getClients } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { locationToItem } from "../ddu_source_lsp/util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isValidItem } from "../ddu_source_lsp/handler.ts";

type ReferenceParams = TextDocumentPositionParams & {
  context: ReferenceContext;
};

type Params = {
  clientName: ClientName;
  includeDeclaration: boolean;
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
    const { clientName, includeDeclaration } = sourceParams;
    const method: Method = "textDocument/references";

    return new ReadableStream({
      async start(controller) {
        try {
          const clients = await getClients(denops, clientName, ctx.bufNr);

          await Promise.all(clients.map(async (client) => {
            const params = await makePositionParams(
              denops,
              ctx.bufNr,
              ctx.winId,
              client.offsetEncoding,
            ) as ReferenceParams;
            params.context = { includeDeclaration };
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
      includeDeclaration: true,
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
   * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_references
   */
  const locations = result as Location[] | null;
  if (!locations) {
    return [];
  }

  const context = { client, bufNr, method };

  return locations
    .map((location) => locationToItem(location, context))
    .filter(isValidItem);
}
