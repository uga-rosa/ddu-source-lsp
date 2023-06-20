/*
  The original code is here.
  https://github.com/Shougo/ddu-kind-file/blob/3eeb5cabfb818357df77f73c573ec377f0cb671a/denops/%40ddu-kinds/file.ts

  MIT license

  Copyright (c) Shougo Matsushita <Shougo.Matsu at gmail.com>

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  "Software"), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be included
  in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
  OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import {
  ActionFlags,
  Actions,
  BaseKind,
  Context,
  DduItem,
  Denops,
  existsSync,
  fn,
  fromA,
  op,
  PreviewContext,
  Previewer,
  Range,
  WorkspaceSymbol,
  wrapA,
} from "../ddu_source_lsp/deps.ts";

import { bufNrToPath, hasProps } from "../ddu_source_lsp/util.ts";
import { Client } from "../ddu_source_lsp/client.ts";
import { Method } from "../ddu_source_lsp/request.ts";
import { resolvePath } from "../ddu_source_lsp/handler.ts";
import { resolveWorkspaceSymbol } from "../@ddu-sources/lsp_workspaceSymbol.ts";
import { decodeUtfPosition } from "../ddu_source_lsp/offset_encoding.ts";

export type ActionData =
  & (
    | { bufNr: number; path?: string }
    | { bufNr?: number; path: string }
  )
  & {
    range: Range;
    context: ItemContext;
    lnum?: number; // 1-index
    col?: number; // 1-index
  };

export type ItemContext = {
  client: Client;
  bufNr: number;
  method: Method;
};

type EnsuredActionData = Required<ActionData>;

async function ensureAction(
  denops: Denops,
  item: DduItem,
): Promise<EnsuredActionData> {
  const action = item.action as ActionData;
  if (!action || (action.bufNr === undefined && action.path === undefined)) {
    throw new Error(`Invalid usage of kind-lsp`);
  }

  if (hasProps(action, "bufNr", "path", "lnum", "col")) {
    return action;
  }

  if (action.context.method === "workspace/symbol" && action.range === undefined) {
    await resolveWorkspaceSymbol(denops, action, item.data as WorkspaceSymbol);
  }
  await resolvePath(denops, action);

  // At least one of bufNr and path exists
  const bufNr = action.bufNr ?? await fn.bufadd(denops, action.path!);
  await fn.bufload(denops, bufNr);
  const path = action.path ?? await bufNrToPath(denops, action.bufNr!);
  const decodedPosition = await decodeUtfPosition(
    denops,
    bufNr,
    action.range.start,
    action.context.client.offsetEncoding,
  );

  const ensuredAction = {
    ...action,
    bufNr,
    path,
    lnum: decodedPosition.line + 1,
    col: decodedPosition.character + 1,
  };
  item.action = ensuredAction;
  return ensuredAction;
}

type OpenParams = {
  command: string;
  tagstack: boolean;
};

const defaultOpenParams = {
  command: "edit",
  tagstack: true,
} as const satisfies OpenParams;

type QuickFix = {
  bufnr?: number;
  filename?: string;
  lnum?: number;
  col?: number;
  text: string;
};

type PreviewOption = {
  previewCmds?: string[];
};

type Params = Record<never, never>;

export class Kind extends BaseKind<Params> {
  override actions: Actions<Params> = {
    open: async (args: {
      denops: Denops;
      context: Context;
      actionParams: unknown;
      items: DduItem[];
    }) => {
      const { denops, context: ctx, actionParams, items } = args;
      const openParams = {
        ...defaultOpenParams,
        ...actionParams as OpenParams,
      };

      // Add original location to jumplist
      await denops.cmd("normal! m`");

      if (openParams.tagstack) {
        // Push tagstack
        const from = await fn.getpos(denops, ".");
        const tagname = await fn.expand(denops, "<cword>");
        await fn.settagstack(denops, ctx.winId, { items: [{ from, tagname }] }, "t");
      }

      await wrapA(fromA(items)).forEach(async (item) => {
        const action = await ensureAction(denops, item);

        if (openParams.command !== "edit") {
          await denops.call(
            "ddu#util#execute_path",
            openParams.command,
            action.path,
          );
        }
        await op.buflisted.setBuffer(denops, action.bufNr, true);
        await denops.cmd(`buffer ${action.bufNr}`);

        await fn.cursor(denops, action.lnum, action.col);

        // Note: Open folds and centering
        await denops.cmd("normal! zvzz");
      }).catch((e) => {
        console.error(e);
      });

      return ActionFlags.None;
    },

    quickfix: async (args: {
      denops: Denops;
      items: DduItem[];
    }) => {
      const { denops, items } = args;

      await Promise.all(items
        .map(async (item) => {
          const action = await ensureAction(denops, item);
          const { lnum, col } = action;
          return {
            bufnr: action.bufNr,
            filename: action.path,
            lnum,
            col,
            text: item.word,
          };
        }))
        .then(async (qfloclists: QuickFix[]) => {
          await fn.setqflist(denops, qfloclists);
          await denops.cmd("copen");
        })
        .catch((e) => {
          console.error(e);
        });

      return ActionFlags.None;
    },
  };

  override async getPreviewer(args: {
    denops: Denops;
    item: DduItem;
    actionParams: unknown;
    previewContext: PreviewContext;
  }): Promise<Previewer | undefined> {
    const action = await ensureAction(args.denops, args.item);
    const param = args.actionParams as PreviewOption;

    if (param.previewCmds === undefined || !existsSync(action.path)) {
      return {
        kind: "buffer",
        expr: action.bufNr,
        lineNr: action.lnum,
      };
    } else {
      const ctx = args.previewContext;

      const lineNr = action.lnum;
      const startLine = Math.max(
        0,
        Math.ceil(lineNr - ctx.height / 2),
      );

      const pairs = {
        s: action.path,
        l: String(lineNr),
        h: String(ctx.height),
        e: String(startLine + ctx.height),
        b: String(startLine),
        "%": "%",
      } as const satisfies Record<string, string>;

      const replacer = (
        match: string,
        p1: string,
      ) => {
        if (!p1.length || !(p1 in pairs)) {
          throw `invalid item ${match}`;
        }
        return pairs[p1 as keyof typeof pairs];
      };

      try {
        const replaced = param.previewCmds.map((cmd) => cmd.replace(/%(.?)/g, replacer));
        return {
          kind: "terminal",
          cmds: replaced,
        };
      } catch (e) {
        return {
          kind: "nofile",
          contents: ["Error", e.toString()],
          highlights: [{
            name: "ddu-kind-lsp-error",
            hl_group: "Error",
            row: 1,
            col: 1,
            width: 5,
          }],
        };
      }
    }
  }

  override params(): Params {
    return {};
  }
}
