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
  PreviewContext,
  Previewer,
} from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { existsSync } from "https://deno.land/std@0.191.0/fs/mod.ts";
import { Range, WorkspaceSymbol } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { asyncFlatMap } from "../ddu_source_lsp/util.ts";
import { Client } from "../ddu_source_lsp/client.ts";
import { Method } from "../ddu_source_lsp/request.ts";
import { resolvePath } from "../ddu_source_lsp/handler.ts";
import { resolveWorkspaceSymbol } from "../@ddu-sources/lsp_workspaceSymbol.ts";
import { decodeUtfIndex } from "../ddu_source_lsp/offset_encoding.ts";

export type ActionData =
  & (
    | { bufNr: number; path?: string }
    | { bufNr?: number; path: string }
  )
  & {
    range?: Range;
    context: ItemContext;
    // For cache. It will not exist until it is resolved.
    lnum?: number;
    col?: number;
  };

export type ItemContext = {
  client: Client;
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
  await resolvePath(denops, action);
  if (action.context.method === "workspace/symbol") {
    await resolveWorkspaceSymbol(denops, action, item.data as WorkspaceSymbol);
  }
  if (action.range && !action.lnum) {
    action.lnum = action.range.start.line + 1;
    const line = (await fn.getbufline(denops, action.context.bufNr, action.lnum))[0] ?? "";
    action.col = decodeUtfIndex(line, action.range.start.character, action.context.client.offsetEncoding) + 1;
  }
  return action;
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

      for (const item of items) {
        const action = await getAction(denops, item);
        if (!action) {
          continue;
        }

        const bufNr = action.bufNr ?? await fn.bufnr(denops, action.path);

        // bufnr() may return -1
        if (bufNr > 0) {
          if (openParams.command !== "edit") {
            await denops.call(
              "ddu#util#execute_path",
              openParams.command,
              action.path,
            );
          }
          // NOTE: bufNr may be hidden
          await fn.bufload(denops, bufNr);
          await denops.cmd(`buffer ${bufNr}`);
        } else {
          await denops.call(
            "ddu#util#execute_path",
            openParams.command,
            action.path,
          );
        }

        if (action.lnum && action.col) {
          const { lnum, col } = action;

          await fn.cursor(denops, lnum, col);
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
          const { lnum, col } = action;
          return {
            bufnr: action.bufNr,
            filename: action.path,
            lnum,
            col,
            text: item.word,
          };
        } else {
          return [];
        }
      });

      if (qfloclist.length > 0) {
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
    const action = await getAction(args.denops, args.item);
    if (!action) {
      return;
    }

    const param = args.actionParams as PreviewOption;

    if (param.previewCmds?.length && action.path && existsSync(action.path)) {
      const previewHeight = args.previewContext.height;
      let startLine = 0;
      let lineNr = 0;
      if (action.range) {
        lineNr = action.range.start.line + 1;
        startLine = Math.max(
          0,
          Math.ceil(lineNr - previewHeight / 2),
        );
      }

      const pairs: Record<string, string> = {
        s: action.path,
        l: String(lineNr),
        h: String(previewHeight),
        e: String(startLine + previewHeight),
        b: String(startLine),
        "%": "%",
      };
      const replacer = (
        match: string,
        p1: string,
      ) => {
        if (!p1.length || !(p1 in pairs)) {
          throw `invalid item ${match}`;
        }
        return pairs[p1];
      };
      const replaced: string[] = [];
      try {
        for (const cmd of param.previewCmds) {
          replaced.push(cmd.replace(/%(.?)/g, replacer));
        }
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

      return {
        kind: "terminal",
        cmds: replaced,
      };
    }

    return {
      kind: "buffer",
      expr: action.bufNr,
      path: action.path,
      lineNr: action.lnum,
    };
  }

  override params(): Params {
    return {};
  }
}
