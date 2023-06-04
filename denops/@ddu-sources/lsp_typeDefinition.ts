import { BaseSource, Context, DduItem, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";

import { isFeatureSupported, lspRequest, Method } from "../ddu_source_lsp/request.ts";
import { ClientName, isClientName } from "../ddu_source_lsp/client.ts";
import { makePositionParams } from "../ddu_source_lsp/params.ts";
import { definitionsToItems } from "./lsp_definition.ts";

type Params = {
  clientName: ClientName;
};

const METHOD = "textDocument/typeDefinition" as const satisfies Method;

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
    const { clientName } = sourceParams;

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

        const params = await makePositionParams(denops, ctx.bufNr, ctx.winId);

        const response = await lspRequest(denops, ctx.bufNr, clientName, METHOD, params);
        if (response) {
          const items = definitionsToItems(response);
          controller.enqueue(items);
        }

        controller.close();
      },
    });
  }

  params(): Params {
    return {
      clientName: "nvim-lsp",
    };
  }
}
