import { Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";

import { isMethod, Method } from "./request.ts";
import { ClientName, isClientName } from "./client.ts";
import { isDenoUriWithFragment } from "./handler/denols.ts";
import { SomeRequired } from "./util.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";

export type ItemAction = SomeRequired<Item<Omit<ActionData, "context">>, "action">;

export async function handler(
  gatherItems: () => Promise<ItemAction[] | undefined>,
  controller: ReadableStreamDefaultController<unknown>,
  bufNr: number,
  clientName: ClientName,
  method: Method,
  _params: unknown,
) {
  if (!isClientName(clientName)) {
    console.log(`Unknown client name: ${clientName}`);
  } else if (!isMethod(method)) {
    console.log(`Unknown method: ${method}`);
  } else {
    const items = (await gatherItems())
      ?.filter((item) => !(item.action.path && isDenoUriWithFragment(item.action.path)))
      .map((item) => {
        return {
          ...item,
          action: {
            ...item.action,
            context: { bufNr, clientName, method },
          },
        };
      });
    if (items) {
      controller.enqueue(items);
    }
  }
  controller.close();
}
