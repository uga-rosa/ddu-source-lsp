import { Denops } from "./deps.ts";
import { ActionData } from "../@ddu-kinds/lsp.ts";
import { createVirtualBuffer, isDenoUriWithFragment } from "./handler/denols.ts";

export function isValidItem(item: { action: { path?: string } }) {
  if (item.action.path) {
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
    denops,
    action.path,
    action.context.client,
    action.context.bufNr,
  );
}
