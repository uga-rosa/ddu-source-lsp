import { BaseSource, Context, Item } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v2.9.2/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.4.2/file.ts";
import { fromFileUrl, relative } from "https://deno.land/std@0.190.0/path/mod.ts";
import { Diagnostic, Location } from "npm:vscode-languageserver-types@3.17.4-next.0";

import { ClientName, isClientName } from "../ddu_source_lsp/client.ts";
import { asyncFlatMap, bufNrToFileUri, SomeRequired } from "../ddu_source_lsp/util.ts";

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

        const diagnostics = await asyncFlatMap(buffers, async (buffer) => {
          const bufNr = buffer === 0 ? context.bufNr : buffer;
          return await getDiagnostic(clientName, denops, bufNr) ?? [];
        });

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

type DduDiagnostic = Diagnostic & {
  bufNr?: number;
  path?: string;
};

async function getDiagnostic(
  clientName: ClientName,
  denops: Denops,
  bufNr: number | null,
): Promise<DduDiagnostic[] | undefined> {
  if (clientName === "nvim-lsp") {
    return await getNvimLspDiagnostics(denops, bufNr);
  } else if (clientName === "coc.nvim") {
    return await getCocDiagnostics(denops, bufNr);
  } else if (clientName === "vim-lsp") {
    return await getVimLspDiagnostics(denops, bufNr);
  } else {
    clientName satisfies never;
  }
}

type NvimLspDiagnostic = Pick<Diagnostic, "message" | "severity" | "source" | "code"> & {
  lnum: number;
  end_lnum: number;
  col: number;
  end_col: number;
  bufnr: number;
};

async function getNvimLspDiagnostics(
  denops: Denops,
  bufNr: number | null,
) {
  return (await denops.call(`luaeval`, `vim.diagnostic.get(${bufNr})`) as NvimLspDiagnostic[] | null)
    ?.map((diag) => {
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

type CocDiagnostic = Pick<Diagnostic, "message" | "source" | "code"> & {
  file: string;
  location: Location;
  severity: keyof typeof Severity;
};

async function getCocDiagnostics(
  denops: Denops,
  bufNr: number | null,
) {
  const uri = bufNr ? await bufNrToFileUri(denops, bufNr) : undefined;
  return (await denops.call("CocAction", "diagnosticList") as CocDiagnostic[] | null)
    ?.filter((diag) => !uri || diag.location.uri === uri)
    .map((diag) => {
      return {
        ...diag,
        path: diag.file,
        range: diag.location.range,
        severity: Severity[diag.severity],
      };
    });
}

type VimLspDiagnostic = {
  params: {
    uri: string;
    diagnostics: Diagnostic[];
  };
};

async function getVimLspDiagnostics(
  denops: Denops,
  bufNr: number | null,
) {
  if (bufNr) {
    const uri = await bufNrToFileUri(denops, bufNr);
    return Object.values(
      await denops.call(`lsp#internal#diagnostics#state#_get_all_diagnostics_grouped_by_server_for_uri`, uri) as Record<
        string,
        VimLspDiagnostic
      >,
    ).flatMap((diag) => {
      const path = fromFileUrl(diag.params.uri);
      return diag.params.diagnostics.map((diag) => {
        return {
          ...diag,
          path,
        };
      });
    });
  } else {
    return Object.values(
      await denops.call(
        `lsp#internal#diagnostics#state#_get_all_diagnostics_grouped_by_uri_and_server`,
      ) as Record<
        string,
        Record<string, VimLspDiagnostic>
      >,
    ).flatMap((subRecord) => Object.values(subRecord))
      .flatMap((vimDiagnostic) => {
        const path = fromFileUrl(vimDiagnostic.params.uri);
        return vimDiagnostic.params.diagnostics.map((diag) => {
          return {
            ...diag,
            path,
          };
        });
      });
  }
}

const Severity = {
  Error: 1,
  Warning: 2,
  Info: 3,
  Hint: 4,
} as const satisfies Record<string, number>;

type Severity = typeof Severity[keyof typeof Severity];

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
