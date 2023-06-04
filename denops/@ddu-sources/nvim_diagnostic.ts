import { BaseSource, Context, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { relative } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Diagnostic } from "npm:vscode-languageserver-types@3.17.4-next.0";
import { ClientName, isClientName, VALID_CLIENT_NAME } from "./nvim_lsp.ts";

type DiagnosticVim = Diagnostic & {
  bufNr?: number;
  path?: string;
};

async function getDiagnostic(
  clientName: ClientName,
  denops: Denops,
  bufNr: number | null,
): Promise<DiagnosticVim[]> {
  switch (clientName) {
    case VALID_CLIENT_NAME["nvim-lsp"]: {
      return await denops.call(
        `luaeval`,
        `require('ddu_nvim_lsp').get_diagnostic(${bufNr})`,
      ) as DiagnosticVim[];
    }
    case VALID_CLIENT_NAME["coc.nvim"]: {
      return [];
    }
    default: {
      clientName satisfies never;
      return [];
    }
  }
}

/** @see :h vim.diagnostic.severity */
const Severity = {
  ERROR: 1,
  WARN: 2,
  INFO: 3,
  HINT: 4,
} as const satisfies Record<string, number>;

type Severity = typeof Severity[keyof typeof Severity];

type SomeRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

type ItemDiagnostic = SomeRequired<Item<SomeRequired<ActionData, "col" | "lineNr">>, "action"> & {
  data: DiagnosticVim;
};

function diagnosticToItem(diagnostic: DiagnosticVim): ItemDiagnostic {
  return {
    // Cut to first "\n"
    word: diagnostic.message.split("\n")[0],
    action: {
      path: diagnostic.path,
      bufNr: diagnostic.bufNr,
      lineNr: diagnostic.range.start.line + 1,
      col: diagnostic.range.start.character + 1,
    },
    data: diagnostic,
  };
}

/**
 * Copyright (c) 2020-2021 nvim-telescope
 * https://github.com/nvim-telescope/telescope.nvim/blob/6d3fbffe426794296a77bb0b37b6ae0f4f14f807/lua/telescope/builtin/__diagnostics.lua#L80-L98
 */
function sortItemDiagnostic(items: ItemDiagnostic[], curBufNr: number) {
  items.sort((a, b) => {
    if (a.action.bufNr === b.action.bufNr) {
      if (a.data.severity === b.data.severity) {
        return a.action.lineNr - b.action.lineNr;
      } else {
        return (a.data.severity ?? 1) - (b.data.severity ?? 1);
      }
    } else {
      if (a.action.bufNr === undefined || a.action.bufNr === curBufNr) {
        return -1;
      } else if (b.action.bufNr === undefined || b.action.bufNr === curBufNr) {
        return 1;
      } else {
        return a.action.bufNr - b.action.bufNr;
      }
    }
  });
}

const SeverityIconHlMap = {
  1: ["E", "ErrorMsg"],
  2: ["W", "WarningMsg"],
  3: ["I", ""],
  4: ["H", ""],
} as const satisfies Record<Severity, Readonly<[string, string]>>;

async function addIconAndHighlight(
  denops: Denops,
  item: ItemDiagnostic,
) {
  const { severity = 1 } = item.data;
  const { bufNr, path, col, lineNr } = item.action;

  const [icon, hl_group] = SeverityIconHlMap[severity];
  if (hl_group) {
    item.highlights = [{
      name: "nvim-lsp-sign",
      hl_group,
      col: 1,
      width: 1,
    }];
  }

  const fullPath = path ?? await fn.bufname(denops, bufNr);
  const relativePath = relative(Deno.cwd(), fullPath);

  item.word = `${relativePath}:${lineNr + 1}:${col + 1}: ${item.word}`;
  item.display = `${icon} ${item.word}`;
}

type Params = {
  clientName: ClientName;
  buffer: number | number[] | null;
};

export class Source extends BaseSource<Params> {
  kind = "file";

  gather(args: {
    denops: Denops;
    context: Context;
    sourceParams: Params;
  }): ReadableStream<ItemDiagnostic[]> {
    const { denops, sourceParams: { clientName, buffer }, context } = args;

    return new ReadableStream({
      async start(controller) {
        if (!isClientName(clientName)) {
          console.log(`Unknown client name: ${clientName}`);
          controller.close();
          return;
        }

        const buffers = Array.isArray(buffer) ? buffer : [buffer];

        const diagnostics = (await Promise.all(
          buffers.map(async (bufNr) => {
            return await getDiagnostic(clientName, denops, bufNr);
          }),
        )).flat();

        const items = await Promise.all(diagnostics.map(async (diagnostic) => {
          const item = diagnosticToItem(diagnostic);
          await addIconAndHighlight(denops, item);
          return item;
        }));
        sortItemDiagnostic(items, context.bufNr);

        controller.enqueue(items);
        controller.close();
      },
    });
  }

  params(): Params {
    return {
      clientName: "nvim-lsp",
      buffer: null,
    };
  }
}
