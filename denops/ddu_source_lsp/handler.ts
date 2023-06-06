import { Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";

import { isMethod, Method } from "./request.ts";
import { ClientName, isClientName } from "./client.ts";
import { createVirtualBuffer, isDenoUriWithFragment } from "./handler/denols.ts";
import { SomeRequired } from "./util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";

export type ItemAction = SomeRequired<Item<ActionData>, "action">;

export async function handler(
  denops: Denops,
  bufNr: number,
  clientName: ClientName,
  method: Method,
  _params: unknown,
  controller: ReadableStreamDefaultController<unknown>,
  gatherItems: () => Promise<ItemAction[] | undefined>,
) {
  if (!isClientName(clientName)) {
    console.log(`Unknown client name: ${clientName}`);
  } else if (!isMethod(method)) {
    console.log(`Unknown method: ${method}`);
  } else {
    const items = (await gatherItems())
      ?.filter((item) => !(item.action.path && isDenoUriWithFragment(item.action.path)))
      .map((item) => {
        item.action.resolvePath = async (path: string) => {
          await createVirtualBuffer(denops, bufNr, clientName, path);
        };
        return item;
      });
    if (items) {
      controller.enqueue(items);
    }
  }
  controller.close();
}
