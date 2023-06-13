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
import { exists } from "https://deno.land/std@0.191.0/fs/mod.ts";
import { Range, WorkspaceSymbol } from "npm:vscode-languageserver-types@3.17.4-next.0";
import { dedent } from "npm:ts-dedent";

import { asyncFlatMap } from "../ddu_source_lsp/util.ts";
import { Client } from "../ddu_source_lsp/client.ts";
import { Method } from "../ddu_source_lsp/request.ts";
import { resolvePath } from "../ddu_source_lsp/handler.ts";
import { resolveWorkspaceSymbol } from "../@ddu-sources/lsp_workspaceSymbol.ts";
import { decodeUtfPosition } from "../ddu_source_lsp/offset_encoding.ts";

export type ActionData = {
  bufNr?: number;
  path: string;
  range: Range;
  context: ItemContext;
  lnum?: number;
  col?: number;
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
  if (!action) {
    throw new Error(`Invalid usage of kind-lsp`);
  }

  // Section to resolve
  if (action.context.method === "workspace/symbol") {
    await resolveWorkspaceSymbol(denops, action, item.data as WorkspaceSymbol);
    if (action.range === undefined) {
      action.range satisfies never;
      throw new Error(dedent`
                      Internal error: could not resolve range (workspaceSymbol/resolve).
                      Please report to https://github.com/uga-rosa/ddu-source-lsp/issues
                      `);
    }
  }
  await resolvePath(denops, action);

  const bufNr = action.bufNr ?? await fn.bufadd(denops, action.path);
  await fn.bufload(denops, bufNr);
  const decodedPosition = await decodeUtfPosition(
    denops,
    bufNr,
    action.range.start,
    action.context.client.offsetEncoding,
  );

  return {
    ...action,
    bufNr,
    lnum: decodedPosition.line + 1,
    col: decodedPosition.character + 1,
  };
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
        const action = await ensureAction(denops, item);

        if (openParams.command !== "edit") {
          await denops.call(
            "ddu#util#execute_path",
            openParams.command,
            action.path,
          );
        }
        await fn.bufload(denops, action.bufNr);
        await denops.cmd(`buffer ${action.bufNr}`);

        await fn.cursor(denops, action.lnum, action.col);

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
        const action = await ensureAction(denops, item);
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
    const action = await ensureAction(args.denops, args.item);
    const param = args.actionParams as PreviewOption;

    if (param.previewCmds === undefined || !await exists(action.path)) {
      return {
        kind: "buffer",
        expr: action.bufNr,
        path: action.path,
        lineNr: action.lnum,
      };
    } else {
      const ctx = args.previewContext;

      const lineNr = action.lnum;
      const startLine = Math.max(
        0,
        Math.ceil(lineNr - ctx.height / 2),
      );

      const pairs: Record<string, string> = {
        s: action.path,
        l: String(lineNr),
        h: String(ctx.height),
        e: String(startLine + ctx.height),
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
          highlights: errorHighlights,
        };
      }
    }
  }

  override params(): Params {
    return {};
  }
}

const errorHighlights = [{
  name: "ddu-kind-lsp-error",
  hl_group: "Error",
  row: 1,
  col: 1,
  width: 5,
}];
