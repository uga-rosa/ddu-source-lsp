import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Location, ReferenceContext } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
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
    const method = "textDocument/references";

    return new ReadableStream({
      async start(controller) {
        const params = await makePositionParams(denops, ctx.bufNr, ctx.winId) as ReferenceParams;
        params.context = { includeDeclaration };
        const results = await lspRequest(
          clientName,
          denops,
          ctx.bufNr,
          method,
          params,
        );
        if (results) {
          const items = referencesToItems(results, clientName, ctx.bufNr, method);
          controller.enqueue(items);
        }
        controller.close();
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

function referencesToItems(
  response: Results,
  clientName: ClientName,
  bufNr: number,
  method: Method,
): Item<ActionData>[] {
  return response.flatMap(({ result, clientId }) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_references
     */
    const locations = result as Location[];

    const context = { clientName, bufNr, method, clientId };
    return locations.map((location) => locationToItem(location, context));
  }).filter(isValidItem);
}
