import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { Location, ReferenceContext } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { isFeatureSupported, lspRequest, Method, Results } from "../ddu_source_lsp/request.ts";
import { ClientName, isClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams, TextDocumentPositionParams } from "../ddu_source_lsp/params.ts";
import { locationToItem } from "../ddu_source_lsp/util.ts";
import { isDenoUriWithFragment } from "../ddu_source_lsp/deno.ts";

type ReferenceParams = TextDocumentPositionParams & {
  context: ReferenceContext;
};

type Params = {
  clientName: ClientName;
  includeDeclaration: boolean;
};

const METHOD = "textDocument/references" as const satisfies Method;

export class Source extends BaseSource<Params> {
  kind = "file";

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
        if (!isClientName(clientName)) {
          console.log(`Unknown client name: ${clientName}`);
          controller.close();
          return;
        }

        const isSupported = await isFeatureSupported(denops, ctx.bufNr, clientName, METHOD);
        if (!isSupported) {
          if (isSupported === false) {
            console.log(`${METHOD} is not supported by any of the servers`);
          } else {
            console.log("No server attached");
          }
          controller.close();
          return;
        }

        const params = await makePositionParams(denops, ctx.bufNr, ctx.winId) as ReferenceParams;
        params.context = { includeDeclaration };

        const response = await lspRequest(denops, ctx.bufNr, clientName, METHOD, params);
        if (response) {
          const items = referencesToItems(response);
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
): Item<ActionData>[] {
  return response.flatMap((result) => {
    /**
     * Reference:
     * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#textDocument_references
     */
    const locations = result as Location[];
    return locations;
  }).filter((location) => !isDenoUriWithFragment(location))
    .map(locationToItem);
}
