import { BaseSource, Context, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { relative } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Diagnostic, Location } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { CLIENT_NAME, ClientName, isClientName } from "../ddu_source_lsp/client.ts";
import { bufNrToFileUrl } from "../ddu_source_lsp/util.ts";

type DduDiagnostic = Diagnostic & {
  bufNr?: number;
  path?: string;
};

type NvimDiagnostic = Pick<Diagnostic, "message" | "severity" | "source" | "code"> & {
  lnum: number;
  end_lnum: number;
  col: number;
  end_col: number;
  bufnr: number;
};

type CocDiagnostic = Pick<Diagnostic, "message" | "source" | "code"> & {
  file: string;
  location: Location;
  severity: keyof typeof Severity;
};

async function getDiagnostic(
  clientName: ClientName,
  denops: Denops,
  bufNr: number | null,
): Promise<DduDiagnostic[]> {
  switch (clientName) {
    case CLIENT_NAME["nvim-lsp"]: {
      const diagnostics = await denops.call(
        `luaeval`,
        `require('ddu_nvim_lsp').get_diagnostic(${bufNr})`,
      ) as NvimDiagnostic[] | null;
      if (diagnostics) {
        return parseNvimDiagnostics(diagnostics);
      }
      break;
    }
    case CLIENT_NAME["coc.nvim"]: {
      const cocDiagnostics = await denops.call(
        `ddu#source#lsp#coc#diagnostics`,
      ) as CocDiagnostic[] | null;
      if (cocDiagnostics) {
        const uri = bufNr ? await bufNrToFileUrl(denops, bufNr) : undefined;
        return parseCocDiagnostics(cocDiagnostics, uri);
      }
      break;
    }
    case CLIENT_NAME["vim-lsp"]: {
      // TODO
      break;
    }
    default: {
      clientName satisfies never;
    }
  }
  return [];
}

function parseNvimDiagnostics(
  nvimDiagnostics: NvimDiagnostic[],
): DduDiagnostic[] {
  return nvimDiagnostics.map((diag) => {
    return {
      ...diag,
      range: {
        start: {
          line: diag.lnum,
          character: diag.col,
        },
        end: {
          line: diag.end_lnum,
          character: diag.end_col,
        },
      },
      bufNr: diag.bufnr,
    };
  });
}

function parseCocDiagnostics(
  cocDiagnostics: CocDiagnostic[],
  uri?: string,
): DduDiagnostic[] {
  if (uri) {
    cocDiagnostics = cocDiagnostics.filter((diag) => diag.location.uri === uri);
  }
  return cocDiagnostics.map((diag) => {
    return {
      ...diag,
      path: diag.file,
      range: diag.location.range,
      severity: Severity[diag.severity],
    };
  });
}

const Severity = {
  Error: 1,
  Warning: 2,
  Info: 3,
  Hint: 4,
} as const satisfies Record<string, number>;

type Severity = typeof Severity[keyof typeof Severity];

type SomeRequired<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

type ItemDiagnostic = SomeRequired<Item<SomeRequired<ActionData, "col" | "lineNr">>, "action"> & {
  data: DduDiagnostic;
};

function diagnosticToItem(diagnostic: DduDiagnostic): ItemDiagnostic {
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
    if (a.action.bufNr && a.action.bufNr === b.action.bufNr) {
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
            return await getDiagnostic(clientName, denops, bufNr === 0 ? context.bufNr : bufNr);
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
