import { BaseSource, Context, Item } from "https://deno.land/x/ddu_vim@v2.8.6/types.ts#^";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.8.6/deps.ts#^";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.1/file.ts#^";
import { relative } from "https://deno.land/std@0.190.0/path/mod.ts";

/** @see :h vim.diagnostic.severity */
const Severity = {
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  HINT: 4,
} as const satisfies Record<string, number>;

type Severity = typeof Severity[keyof typeof Severity];

/**
 * @see :h diagnostic-structure
 * 0-based rows and columns
 */
export type Diagnostic = {
  /** Buffer number */
  bufnr?: number;
  /** The starting line of the diagnostic */
  lnum: number;
  /** The final line of the diagnostic */
  end_lnum?: number;
  /** The starting column of the diagnostic */
  col: number;
  /** The final column of the diagnostic */
  end_col?: number;
  /** The severity of the diagnostic |vim.diagnostic.severity| */
  severity?: Severity;
  /** The diagnostic text */
  message: string;
  /** The source of the diagnostic */
  source?: string;
  /** The diagnostic code */
  code?: number | string;
  /** Arbitrary data plugins or users can add */
  user_data?: unknown;
};

interface ItemLsp extends Item<ActionData> {
  data: Diagnostic;
}

function diagnosticToItem(diagnostic: Diagnostic): ItemLsp {
  return {
    // Cut to first "\n"
    word: diagnostic.message.split("\n")[0],
    action: {
      bufNr: diagnostic.bufnr,
      lineNr: diagnostic.lnum + 1,
      col: diagnostic.col + 1,
    },
    data: diagnostic,
  };
}

/**
 * Copyright (c) 2020-2021 nvim-telescope
 * https://github.com/nvim-telescope/telescope.nvim/blob/6d3fbffe426794296a77bb0b37b6ae0f4f14f807/lua/telescope/builtin/__diagnostics.lua#L80-L98
 */
function sortItemLsp(items: ItemLsp[], curBufNr: number) {
  items.sort((a, b) => {
    if (a.data.bufnr === b.data.bufnr) {
      if (a.data.severity === b.data.severity) {
        return a.data.lnum - b.data.lnum;
      } else {
        return (a.data.severity ?? 1) - (b.data.severity ?? 1);
      }
    } else {
      if (a.data.bufnr === undefined || a.data.bufnr === curBufNr) {
        return -1;
      } else if (b.data.bufnr === undefined || b.data.bufnr === curBufNr) {
        return 1;
      } else {
        return a.data.bufnr - b.data.bufnr;
      }
    }
  });
}

const IconHlgroup = [
  ["E", "ErrorMsg"],
  ["W", "WarningMsg"],
  ["I", ""],
  ["H", ""],
] as const;

async function ugaStyle(
  denops: Denops,
  item: Item<ActionData>,
  diagnostic: Diagnostic,
) {
  const { severity = 1, bufnr = 0, col, lnum } = diagnostic;

  const [icon, hl_group] = IconHlgroup[severity - 1];
  if (hl_group) {
    item.highlights = [{
      name: "nvim-lsp-sign",
      hl_group,
      col: 1,
      width: 1,
    }];
  }

  const fullPath = await fn.bufname(denops, bufnr);
  const relativePath = relative(Deno.cwd(), fullPath);

  item.word = `${relativePath}:${lnum + 1}:${col + 1}: ${item.word}`;
  item.display = `${icon} ${item.word}`;
}

/**
 * @see :h vim.diagnostic.get()
 * The second argument {opts}.
 */
type Options = {
  /** Limit diagnostics to the given namespace. */
  namespace?: number;
  /** Limit diagnostics to the given line number. */
  lnum?: number;
  severity?: Severity;
};

type Params = {
  buffer: number | number[] | null;
  options: Options;
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    context: Context;
    sourceParams: Params;
  }): ReadableStream<ItemLsp[]> {
    const { denops, sourceParams: { buffer, options }, context } = args;
    const { getDiagnostic } = this;
    return new ReadableStream({
      async start(controller) {
        const buffers = Array.isArray(buffer) ? buffer : [buffer];
        const diagnostics = (await Promise.all(
          buffers.map(async (buf) => {
            return await getDiagnostic(denops, buf, options);
          }),
        )).flat();
        const items = await Promise.all(diagnostics.map(async (diagnostic) => {
          const item = diagnosticToItem(diagnostic);
          await ugaStyle(denops, item, diagnostic);
          return item;
        }));
        sortItemLsp(items, context.bufNr);

        controller.enqueue(items);
        controller.close();
      },
    });
  }

  async getDiagnostic(
    denops: Denops,
    buffer: number | null,
    options?: Options,
  ): Promise<Diagnostic[]> {
    return await denops.call(
      "luaeval",
      "vim.diagnostic.get(_A[1], _A[2])",
      [buffer, options],
    ) as Diagnostic[];
  }

  params(): Params {
    return {
      buffer: null,
      options: {},
    };
  }
}
