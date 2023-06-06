import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Location, ReferenceContext } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { lspRequest, Results } from "../ddu_source_lsp/request.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { locationToItem } from "../ddu_source_lsp/util.ts";
import { handler } from "../ddu_source_lsp/handler.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";

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

    return new ReadableStream({
      async start(controller) {
        const params = await makePositionParams(denops, ctx.bufNr, ctx.winId) as ReferenceParams;
        params.context = { includeDeclaration };

        handler(
          denops,
          ctx.bufNr,
          clientName,
          "textDocument/references",
          params,
          controller,
          async () => {
            const results = await lspRequest(denops, ctx.bufNr, clientName, "textDocument/references", params);
            if (results) {
              return referencesToItems(results);
            }
          },
        );
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
) {
  return response.flatMap((result) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_references
     */
    const locations = result as Location[];
    return locations;
  }).map(locationToItem);
}
