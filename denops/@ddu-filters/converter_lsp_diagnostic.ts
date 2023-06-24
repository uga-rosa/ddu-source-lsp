import { BaseFilter, Context, DduItem, Denops, relative } from "../ddu_source_lsp/deps.ts";
import { ItemDiagnostic, Severity } from "../@ddu-sources/lsp_diagnostic.ts";
import { bufNrToPath, byteLength, getCwd } from "../ddu_source_lsp/util.ts";

function padding(
  expr: string | number,
  length: number,
  end = false,
) {
  const str = expr.toString();
  if (str.length > length) {
    return str.slice(0, length - 1) + "…";
  } else if (end) {
    return str.padEnd(length, " ");
  } else {
    return str.padStart(length, " ");
  }
}

type Params = {
  iconMap: Record<Severity, string>;
  hlGroupMap: Record<Severity, string>;
  columnLength: number;
  separator: string;
};

export class Filter extends BaseFilter<Params> {
  override async filter(args: {
    denops: Denops;
    context: Context;
    filterParams: Params;
    items: DduItem[];
  }): Promise<DduItem[]> {
    const { denops, filterParams: param, items } = args;
    const cwd = await getCwd(denops, args.context.winId);

    const bufferSet = new Set<number>();
    const lineSet = new Set<number>();
    const characterSet = new Set<number>();

    items.forEach((item) => {
      if (item.__sourceName !== "lsp_diagnostic") {
        return;
      }
      const { action } = item as ItemDiagnostic;
      bufferSet.add(action.bufNr);
      lineSet.add(action.range.start.line);
      characterSet.add(action.range.start.character);
    });

    const toPath: Record<number, string> = {};
    for (const bufNr of bufferSet) {
      toPath[bufNr] = await bufNrToPath(denops, bufNr);
    }

    const iconLength = Math.max(...Object.values(param.iconMap).map(byteLength));
    const lineLength = (Math.max(...lineSet) + 1).toString().length;
    const characterLength = (Math.max(...characterSet) + 1).toString().length;

    return items.map((item) => {
      if (item.__sourceName !== "lsp_diagnostic") {
        return item;
      }
      const { action, data } = item as ItemDiagnostic;
      const { bufNr, path = toPath[bufNr], range } = action;
      const { severity = 1 } = data;

      const relativePath = relative(cwd, path);
      const icon = padding(param.iconMap[severity], iconLength);
      // To prioritize speed, decodePosition() is not used.
      // So, row may not be correct.
      const lnum = padding(range.start.line + 1, lineLength);
      const row = padding(range.start.character + 1, characterLength);
      const prefix = `${icon} ${lnum}:${row}`;

      const hl_group = param.hlGroupMap[severity];
      if (hl_group) {
        const offset = byteLength(prefix);
        const highlights = item.highlights?.map((hl) => ({
          ...hl,
          col: hl.col += offset,
        }));
        item.highlights = [
          ...highlights ?? [],
          {
            name: "converter-lsp-diagnostic",
            hl_group,
            col: 1,
            width: iconLength,
          },
        ];
      }

      item.display = [
        prefix,
        padding(item.word, param.columnLength, true),
        relativePath,
      ].join(param.separator);
      return item;
    });
  }

  override params(): Params {
    return {
      iconMap: {
        1: "E",
        2: "W",
        3: "I",
        4: "H",
      },
      hlGroupMap: {
        1: "ErrorMsg",
        2: "WarningMsg",
        3: "",
        4: "",
      },
      columnLength: 50,
      separator: " | ",
    };
  }
}
