import { BaseFilter, DduItem } from "https://deno.land/x/ddu_vim@v2.9.2/types.ts";
import { KindName } from "../@ddu-sources/nvim_lsp.ts";
import { SymbolKind } from "npm:vscode-languageserver-types@3.17.4-next.0";

const KindIcon = {
  File: "",
  Module: "",
  Namespace: "",
  Package: "",
  Class: "",
  Method: "",
  Property: "",
  Field: "",
  Constructor: "",
  Enum: "",
  Interface: "",
  Function: "",
  Variable: "",
  Constant: "",
  String: "",
  Number: "",
  Boolean: "",
  Array: "",
  Object: "",
  Key: "",
  Null: "",
  EnumMember: "",
  Struct: "",
  Event: "",
  Operator: "",
  TypeParameter: "",
} as const satisfies Record<KindName, string>;

const KindHl = {
  File: "Structure",
  Module: "Structure",
  Namespace: "Structure",
  Package: "Structure",
  Class: "Structure",
  Method: "Function",
  Property: "Identifier",
  Field: "Identifier",
  Constructor: "Structure",
  Enum: "Type",
  Interface: "Type",
  Function: "Function",
  Variable: "Identifier",
  Constant: "Constant",
  String: "String",
  Number: "Number",
  Boolean: "Boolean",
  Array: "Structure",
  Object: "Structure",
  Key: "Identifier",
  Null: "Special",
  EnumMember: "Identifier",
  Struct: "Structure",
  Event: "Type",
  Operator: "Operator",
  TypeParameter: "Type",
} as const satisfies Record<KindName, string>;

export class Filter extends BaseFilter<Record<never, never>> {
  filter(args: {
    items: DduItem[];
  }): Promise<DduItem[]> {
    return Promise.resolve(args.items.map((item) => {
      if (
        typeof item.data === "object" &&
        item.data !== null &&
        "kind" in item.data &&
        typeof item.data.kind === "number" &&
        item.data.kind >= 1 && item.data.kind <= 26
      ) {
        const kind = item.data.kind as SymbolKind;
        const kindName = KindName[kind];
        const kindIcon = KindIcon[kindName];
        const kindHl = KindHl[kindName];
        const { word, display = word, highlights = [] } = item;
        if (!display.startsWith(kindIcon)) {
          item.display = `${kindIcon} ${display}`;
          highlights.forEach((hl) => hl.col += 4)
          item.highlights = [
            ...highlights,
            {
              name: "lsp-symbol",
              hl_group: kindHl,
              col: 1,
              width: 19, // 3 (icon) + 1 (space) + 15 ([kindName])
            },
          ];
        }
      }
      return item;
    }));
  }

  params() {
    return {};
  }
}
