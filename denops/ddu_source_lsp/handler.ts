import { Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";

import { ActionData } from "../@ddu-kinds/lsp.ts";
import { isDenoUriWithFragment } from "./handler/denols.ts";

export function isValidItem(item: Item<ActionData>) {
  if (item.action?.path) {
    return !isDenoUriWithFragment(item.action.path);
  }
  return true;
}
