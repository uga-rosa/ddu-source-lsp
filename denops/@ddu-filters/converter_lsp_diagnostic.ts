import {
  BaseFilter,
  Context,
  DduItem,
  Denops,
  fn,
  fromA,
  relative,
  wrapA,
} from "../ddu_source_lsp/deps.ts";
import { ItemDiagnostic, Severity } from "../@ddu-sources/lsp_diagnostic.ts";
import { bufNrToPath, byteLength, getCwd } from "../ddu_source_lsp/util.ts";

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

    const iconLength = Math.max(
      ...Object.values(param.iconMap).map(byteLength),
    );
    const lineLength = (Math.max(...lineSet) + 1).toString().length;
    const characterLength = (Math.max(...characterSet) + 1).toString().length;

    return await wrapA(fromA(items)).map(async (item) => {
      if (item.__sourceName !== "lsp_diagnostic") {
        return item;
      }
      const { action, data } = item as ItemDiagnostic;
      const { bufNr, path = toPath[bufNr], range } = action;
      const severityName = SeverityName[data.severity ?? 1];

      const relativePath = relative(cwd, path);
      const icon = await padding(
        denops,
        param.iconMap[severityName],
        iconLength,
      );
      // To prioritize speed, decodePosition() is not used.
      // So, row may not be correct.
      const lnum = await padding(denops, range.start.line + 1, lineLength);
      const row = await padding(
        denops,
        range.start.character + 1,
        characterLength,
      );
      const prefix = `${icon} ${lnum}:${row}`;

      const hl_group = param.hlGroupMap[severityName];
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
        await padding(denops, item.word, param.columnLength, false),
        relativePath,
      ].join(param.separator);
      return item;
    }).toArray();
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
  start = true,
) {
  const str = expr.toString();
  const strDisplayWidth = await fn.strdisplaywidth(denops, str);
  if (strDisplayWidth > limitWidth) {
    let i = limitWidth - 1;
    while (await fn.strdisplaywidth(denops, str.slice(0, i)) >= limitWidth) {
      i--;
    }
    return str.slice(0, i) + "…";
  } else if (start) {
    return " ".repeat(limitWidth - strDisplayWidth) + str;
  } else {
    return str + " ".repeat(limitWidth - strDisplayWidth);
  }
}
