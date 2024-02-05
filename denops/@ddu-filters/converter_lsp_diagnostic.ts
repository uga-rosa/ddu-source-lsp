import {
  BaseFilter,
  DduItem,
  Denops,
  FilterArguments,
  fn,
  lu,
  relative,
} from "../ddu_source_lsp/deps.ts";
import { ItemDiagnostic, Severity } from "../@ddu-sources/lsp_diagnostic.ts";
import { byteLength, getCwd } from "../ddu_source_lsp/util.ts";

const SeverityName = {
  1: "Error",
  2: "Warning",
  3: "Info",
  4: "Hint",
} as const satisfies Record<Severity, string>;

type SeverityName = typeof SeverityName[Severity];

type Params = {
  iconMap: Record<SeverityName, string>;
  hlGroupMap: Record<SeverityName, string>;
  columnLength: number;
  separator: string;
};

export class Filter extends BaseFilter<Params> {
  override async filter({
    denops,
    context,
    filterParams: params,
    items,
  }: FilterArguments<Params>): Promise<DduItem[]> {
    const cwd = await getCwd(denops, context.winId);

    const bufferSet = new Set<number>();
    const lineSet = new Set<number>();
    const characterSet = new Set<number>();

    for (const item of items) {
      if (item.__sourceName !== "lsp_diagnostic") {
        continue;
      }
      const { action } = item as ItemDiagnostic;
      bufferSet.add(action.bufNr);
      lineSet.add(action.range.start.line);
      characterSet.add(action.range.start.character);
    }

    const bufnrToPath: Record<number, string> = {};
    for (const bufNr of bufferSet) {
      bufnrToPath[bufNr] = await lu.uriFromBufnr(denops, bufNr);
    }

    const iconLength = Math.max(
      ...Object.values(param.iconMap).map(byteLength),
    );
    const lineLength = (Math.max(...lineSet) + 1).toString().length;
    const characterLength = (Math.max(...characterSet) + 1).toString().length;

    for (const item of items) {
      if (item.__sourceName !== "lsp_diagnostic") {
        continue;
      }
      const { action, data } = item as ItemDiagnostic;
      const { bufNr, range } = action;
      const path = bufnrToPath[bufNr];
      const severityName = SeverityName[data.severity ?? 1];

      const relativePath = relative(cwd, path);
      const icon = await padding(
        denops,
        params.iconMap[severityName],
        iconLength,
      );
      // To prioritize speed, decodePosition() is not used.
      // So, row may not be correct.
      const lnum = await padding(denops, range.start.line + 1, lineLength);
      const row = await padding(denops, range.start.character + 1, characterLength);
      const prefix = `${icon} ${lnum}:${row}`;

      const hl_group = params.hlGroupMap[severityName];
      if (hl_group) {
        const offset = byteLength(prefix);
        const highlights = item.highlights?.map((hl) => ({
          ...hl,
          col: hl.col += offset,
        }));
        item.highlights = [
          ...highlights ?? [],
          {
            name: `ddu-filter-converter_lsp_diagnostic-${hl_group}`,
            hl_group,
            col: 1,
            width: iconLength,
          },
        ];
      }

      item.display = [
        prefix,
        await padding(denops, item.word, params.columnLength, false),
        relativePath,
      ].join(params.separator);
    }
    return items;
  }

  override params(): Params {
    return {
      iconMap: {
        Error: "E",
        Warning: "W",
        Info: "I",
        Hint: "H",
      },
      hlGroupMap: {
        Error: "ErrorMsg",
        Warning: "WarningMsg",
        Info: "",
        Hint: "",
      },
      columnLength: 50,
      separator: " | ",
    };
  }
}

async function padding(
  denops: Denops,
  expr: string | number,
  limitWidth: number,
  right = true,
) {
  const str = expr.toString();
  const strDisplayWidth = await fn.strdisplaywidth(denops, str);
  if (strDisplayWidth > limitWidth) {
    let i = limitWidth - 1;
    while (await fn.strdisplaywidth(denops, str.slice(0, i)) >= limitWidth) {
      i--;
    }
    return str.slice(0, i) + "…";
  } else if (right) {
    return " ".repeat(limitWidth - strDisplayWidth) + str;
  } else {
    return str + " ".repeat(limitWidth - strDisplayWidth);
  }
}
