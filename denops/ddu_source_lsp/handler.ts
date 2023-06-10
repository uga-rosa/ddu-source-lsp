import { Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";

import { ActionData } from "../@ddu-kinds/lsp.ts";
import { createVirtualBuffer, isDenoUriWithFragment } from "./handler/denols.ts";

export function isValidItem(item: Item<ActionData>) {
  if (item.action?.path) {
    return !isDenoUriWithFragment(item.action.path);
  }
  return true;
}

export async function resolvePath(
  denops: Denops,
  action: ActionData,
) {
  if (!action.path) {
    return;
  }
  await createVirtualBuffer(
    action.path,
    action.context.clientName,
    denops,
    action.context.bufNr,
    action.context.clientId,
  );
}
