import {
  BaseSource,
  Context,
  Denops,
  Diagnostic,
  fn,
  Item,
  Location,
} from "../ddu_source_lsp/deps.ts";
import { ActionData, ItemContext } from "../@ddu-kinds/lsp.ts";
import { assertClientName, ClientName } from "../ddu_source_lsp/client.ts";
import {
  bufNrToFileUri,
  pick,
  printError,
  SomeRequired,
  uriToBufNr,
  uriToPath,
} from "../ddu_source_lsp/util.ts";

export type ItemDiagnostic =
  & Omit<Item, "action" | "data">
  & {
    action: SomeRequired<ActionData, "bufNr">;
    data: DduDiagnostic;
  };

export type DduDiagnostic = Diagnostic & {
  bufNr: number;
  path?: string;
};

const Severity = {
  Error: 1,
  Warning: 2,
  Info: 3,
  Hint: 4,
} as const satisfies Record<string, number>;

export type Severity = typeof Severity[keyof typeof Severity];

type Params = {
  clientName: ClientName;
  buffer: number | number[] | null;
};

export class Source extends BaseSource<Params> {
  kind = "lsp";

  gather(args: {
    denops: Denops;
    context: Context;
    sourceParams: Params;
  }): ReadableStream<ItemDiagnostic[]> {
    const { denops, sourceParams: { clientName, buffer }, context: ctx } = args;

    return new ReadableStream({
      async start(controller) {
        try {
          assertClientName(clientName);

          const itemContext: ItemContext = {
            client: {
              name: clientName,
              offsetEncoding: clientName === "nvim-lsp" ? "utf-8" : "utf-16",
            },
            bufNr: ctx.bufNr,
          };
          const normalizedBuffer = Array.isArray(buffer)
            ? buffer.map((b) => b === 0 ? ctx.bufNr : b)
            : buffer === 0
            ? ctx.bufNr
            : buffer;

          const diagnostics = await getDiagnostic(denops, clientName, normalizedBuffer) ?? [];
          const items = diagnostics.map((diag) => diagnosticToItem(diag, itemContext));
          sortItemDiagnostic(items);
          controller.enqueue(items);
        } catch (e) {
          printError(denops, e, "source-lsp_diagnostic");
        } finally {
          controller.close();
        }
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

/**
 * Each client may be adding invalid fields on its own, so filter them out.
 */
export async function getProperDiagnostics(
  clientName: ClientName,
  denops: Denops,
  bufNr: number | null,
): Promise<Diagnostic[]> {
  const dduDiagnostics = await getDiagnostic(denops, clientName, bufNr);
  return dduDiagnostics?.map((diag) => {
    return pick(
      diag,
      "range",
      "severity",
      "code",
      "codeDescription",
      "source",
      "message",
      "tags",
      "relatedInformation",
      "data",
    );
  }) ?? [];
}

async function getDiagnostic(
  denops: Denops,
  clientName: ClientName,
  buffer: number | number[] | null,
): Promise<DduDiagnostic[] | undefined> {
  if (clientName === "nvim-lsp") {
    return await getNvimLspDiagnostics(denops, buffer);
  } else if (clientName === "coc.nvim") {
    return await getCocDiagnostics(denops, buffer);
  } else if (clientName === "vim-lsp") {
    return await getVimLspDiagnostics(denops, buffer);
  } else {
    clientName satisfies never;
  }
}

type NvimLspDiagnostic = Pick<Diagnostic, "message" | "severity" | "source" | "code"> & {
  bufnr: number;
  lnum: number;
  end_lnum: number;
  col: number;
  end_col: number;
};

async function getNvimLspDiagnostics(
  denops: Denops,
  buffer: number | number[] | null,
): Promise<DduDiagnostic[] | undefined> {
  if (denops.meta.host === "vim") {
    throw new Error("Client 'nvim-lsp' is not available in vim");
  }

  const nvimLspDiagnostics = await denops.call(
    `luaeval`,
    `vim.diagnostic.get(${typeof buffer === "number" ? buffer : ""})`,
  ) as NvimLspDiagnostic[] | null;

  return nvimLspDiagnostics
    ?.filter((diag) => Array.isArray(buffer) ? buffer.includes(diag.bufnr) : true)
    .map((diag) => ({
      ...diag,
      bufNr: diag.bufnr,
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
    }));
}

type CocDiagnostic = Pick<Diagnostic, "message" | "source" | "code"> & {
  file: string;
  location: Location;
  severity: keyof typeof Severity;
};

async function getCocDiagnostics(
  denops: Denops,
  buffer: number | number[] | null,
): Promise<DduDiagnostic[] | undefined> {
  const cocDiagnostics = (await denops.call(
    "CocAction",
    "diagnosticList",
  )) as CocDiagnostic[] | null;
  if (cocDiagnostics === null) {
    return;
  }

  const files = deduplicate(cocDiagnostics.map((diag) => diag.file));
  const toBufNr: Record<string, number> = {};
  for (const file of files) {
    toBufNr[file] = await fn.bufnr(denops, file);
  }

  return cocDiagnostics.filter((diag) =>
    buffer === null || toArray(buffer).includes(toBufNr[diag.file])
  ).map((diag) => ({
    ...diag,
    bufNr: toBufNr[diag.file],
    path: diag.file,
    range: diag.location.range,
    severity: Severity[diag.severity],
  }));
}

function deduplicate<T>(x: T[]): T[] {
  return Array.from(new Set(x));
}

function toArray<T>(x: T | T[]): T[] {
  return Array.isArray(x) ? x : [x];
}

type VimLspDiagnostic = {
  params: {
    uri: string;
    diagnostics: Diagnostic[];
  };
};

async function getVimLspDiagnostics(
  denops: Denops,
  buffer: number | number[] | null,
): Promise<DduDiagnostic[] | undefined> {
  const dduDiagnostics: DduDiagnostic[] = [];
  if (buffer !== null) {
    for (const bufNr of toArray(buffer)) {
      const uri = await bufNrToFileUri(denops, bufNr);
      const path = uriToPath(uri);
      // {[servername]: VimLspDiagnostic}
      const diagMap = await denops.call(
        `lsp#internal#diagnostics#state#_get_all_diagnostics_grouped_by_server_for_uri`,
        uri,
      ) as Record<string, VimLspDiagnostic>;

      for (const vimLspDiag of Object.values(diagMap)) {
        dduDiagnostics.push(...vimLspDiag.params.diagnostics.map((d) => ({ ...d, bufNr, path })));
      }
    }
  } else {
    // {[normalized_uri]: {[servername]: VimLspDiagnostic}}
    const diagMapMap = await denops.call(
      `lsp#internal#diagnostics#state#_get_all_diagnostics_grouped_by_uri_and_server`,
    ) as Record<string, Record<string, VimLspDiagnostic>>;

    for (const [normalized_uri, diagMap] of Object.entries(diagMapMap)) {
      const bufNr = await uriToBufNr(denops, normalized_uri);
      const path = uriToPath(normalized_uri);
      for (const vimLspDiag of Object.values(diagMap)) {
        dduDiagnostics.push(...vimLspDiag.params.diagnostics.map((d) => ({ ...d, bufNr, path })));
      }
    }
  }
  return dduDiagnostics;
}

function diagnosticToItem(
  diag: DduDiagnostic,
  context: ItemContext,
): ItemDiagnostic {
  return {
    // Cut to first "\n"
    word: diag.message.split("\n")[0],
    action: {
      bufNr: diag.bufNr,
      range: diag.range,
      context,
    },
    data: diag,
  };
}

/**
 * Copyright (c) 2020-2021 nvim-telescope
 * https://github.com/nvim-telescope/telescope.nvim/blob/6d3fbffe426794296a77bb0b37b6ae0f4f14f807/lua/telescope/builtin/__diagnostics.lua#L80-L98
 */
function sortItemDiagnostic(items: ItemDiagnostic[]) {
  items.sort((a, b) => {
    return [
      a.action.bufNr - b.action.bufNr,
      (a.data.severity ?? 1) - (b.data.severity ?? 1),
      a.action.range.start.line - b.action.range.start.line,
      a.action.range.start.character - b.action.range.start.character,
    ].find((x) => x !== 0) ?? 0;
  });
}
