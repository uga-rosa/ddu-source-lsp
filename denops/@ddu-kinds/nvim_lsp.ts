import {
  ActionFlags,
  Actions,
  BaseKind,
  DduItem,
  PreviewContext,
  Previewer,
} from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { Range } from "npm:vscode-languageserver-types@3.17.4-next.0";

export type ActionData =
  & (
    | { bufNr: number; path?: string }
    | { bufNr?: number; path: string }
  )
  & (
    | { range: Range }
    | { range?: undefined; resolve: () => Promise<Range | undefined> }
  );

async function getRange(action: ActionData) {
  if (action.range) {
    return action.range;
  } else {
    return await action.resolve();
  }
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

      for (const item of items) {
        const action = item?.action as ActionData;
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

        const range = await getRange(action);
        if (range) {
          const { line, character } = range.start;
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

      const qfloclist: QuickFix[] = await Promise.all(items.map(async (item) => {
        const action = item.action as ActionData;
        const range = await getRange(action);

        return {
          bufnr: action.bufNr,
          filename: action.path,
          lnum: range ? range.start.line + 1 : undefined,
          col: range ? range.start.character + 1 : undefined,
          text: item.word,
        };
      }));

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
    actionParams: unknown;
    previewContext: PreviewContext;
  }): Promise<Previewer | undefined> {
    const action = args.item.action as ActionData;
    if (!action) {
      return;
    }
    const range = await getRange(action);
    return {
      kind: "buffer",
      expr: action.bufNr,
      path: action.path,
      lineNr: range ? range.start.line + 1 : undefined,
    };
  }

  override params(): Params {
    return {
      trashCommand: ["gio", "trash"],
    };
  }
}
