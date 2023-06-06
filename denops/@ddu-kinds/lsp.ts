import { ActionFlags, Actions, BaseKind, DduItem, Previewer } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Location, Range, WorkspaceSymbol } from "npm:vscode-languageserver-types@3.17.4-next.0";
import { asyncFlatMap } from "../ddu_source_lsp/util.ts";
import { ClientName } from "../ddu_source_lsp/client.ts";
import { lspRequest, Method } from "../ddu_source_lsp/request.ts";
import { createVirtualBuffer } from "../ddu_source_lsp/handler/denols.ts";

export type ActionData =
  & (
    | { bufNr: number; path?: string }
    | { bufNr?: number; path: string }
  )
  & {
    range?: Range;
    context: ItemContext;
  };

export type ItemContext = {
  clientName: ClientName;
  bufNr: number;
  method: Method;
};

async function getAction(
  denops: Denops,
  item: DduItem,
) {
  const action = item.action as ActionData;
  if (!action) {
    return;
  }
  if (action.range === undefined && action.context.method === "workspace/symbol") {
    const resolvedResults = await lspRequest(
      action.context.clientName,
      denops,
      action.context.bufNr,
      "workspaceSymbol/resolve",
      item.data,
    );
    if (resolvedResults) {
      /**
       * https://microsoft.github.io/language-server-protocol/specifications/specification-current/#workspace_symbolResolve
       */
      const workspaceSymbol = resolvedResults[0] as WorkspaceSymbol;
      action.range = (workspaceSymbol.location as Location).range;
    }
  }
  if (action.path) {
    await createVirtualBuffer(
      action.path,
      action.context.clientName,
      denops,
      action.context.bufNr,
    );
  }
  return action;
}

type OpenParams = {
  command: string;
};

type QuickFix = {
  bufnr?: number;
  filename?: string;
  lnum?: number;
  col?: number;
  text: string;
};

type Params = Record<never, never>;

export class Kind extends BaseKind<Params> {
  override actions: Actions<Params> = {
    open: async (args: {
      denops: Denops;
      actionParams: unknown;
      items: DduItem[];
    }) => {
      const { denops, actionParams, items } = args;

      const params = actionParams as OpenParams;
      const openCommand = params.command ?? "edit";

      // Add original location to jumplist
      await denops.cmd("normal! m`");

      for (const item of items) {
        const action = await getAction(denops, item);
        if (!action) {
          continue;
        }

        const bufNr = action.bufNr ?? await fn.bufnr(denops, action.path);

        // bufnr() may return -1
        if (bufNr > 0) {
          if (openCommand !== "edit") {
            await denops.call(
              "ddu#util#execute_path",
              openCommand,
              action.path,
            );
          }
          // NOTE: bufNr may be hidden
          await fn.bufload(denops, bufNr);
          await denops.cmd(`buffer ${bufNr}`);
        } else {
          await denops.call(
            "ddu#util#execute_path",
            openCommand,
            action.path,
          );
        }

        if (action.range) {
          const { line, character } = action.range.start;
          const [lineNr, col] = [line + 1, character + 1];

          await fn.cursor(denops, lineNr, col);
        }

        // Note: Open folds and centering
        await denops.cmd("normal! zvzz");
      }

      return ActionFlags.None;
    },

    quickfix: async (args: {
      denops: Denops;
      items: DduItem[];
    }) => {
      const { denops, items } = args;

      const qfloclist: QuickFix[] = await asyncFlatMap(items, async (item) => {
        const action = await getAction(denops, item);
        if (action) {
          return {
            bufnr: action.bufNr,
            filename: action.path,
            lnum: action.range ? action.range.start.line + 1 : undefined,
            col: action.range ? action.range.start.character + 1 : undefined,
            text: item.word,
          };
        } else {
          return [];
        }
      });

      if (qfloclist.length !== 0) {
        await fn.setqflist(denops, qfloclist);
        await denops.cmd("copen");
      }

      return ActionFlags.None;
    },
  };

  override async getPreviewer(args: {
    denops: Denops;
    item: DduItem;
  }): Promise<Previewer | undefined> {
    const action = await getAction(args.denops, args.item);
    if (!action) {
      return;
    }

    return {
      kind: "buffer",
      expr: action.bufNr,
      path: action.path,
      lineNr: action.range ? action.range.start.line + 1 : undefined,
    };
  }

  override params(): Params {
    return {};
  }
}
